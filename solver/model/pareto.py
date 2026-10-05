"""ε-constraint cost–fairness frontier. docs/model.md §8."""

from __future__ import annotations

from dataclasses import dataclass

from mital_solver.model.solve import fairness_measure_value, solve
from mital_solver.schemas import FairnessMode, Instance, Solution


@dataclass
class ParetoPoint:
    epsilon: float
    cost: float  # wages + overtime
    understaffing: float  # C1 + supervisor + min_hours penalties
    fairness: float
    solution: Solution


def _cost(sol: Solution) -> float:
    return sol.objective.wages + sol.objective.overtime


def _understaffing(sol: Solution) -> float:
    o = sol.objective
    return o.understaffing + o.supervisor_penalty + o.min_hours_penalty


def _shift_shortfall(inst: Instance, sol: Solution) -> int:
    minimum = inst.rules.min_people_per_shift
    return sum(max(0, minimum - sum(a.day == day and a.shift == shift.id for a in sol.assignments))
        for day in range(inst.horizon_days) for shift in inst.shifts
        if any(d.day == day and d.required > 0 and shift.start_period <= d.period < shift.end_period for d in inst.demand))


def _drop_dominated(points: list[ParetoPoint]) -> list[ParetoPoint]:
    """Keep non-dominated points in the (cost+understaffing, fairness) plane.

    Lower is better on both axes. Sorted by cost ascending.
    """
    scored = sorted(
        points,
        key=lambda p: (_cost(p.solution) + _understaffing(p.solution), p.fairness),
    )
    kept: list[ParetoPoint] = []
    best_fair = float("inf")
    for p in scored:
        if p.fairness < best_fair - 1e-9:
            kept.append(p)
            best_fair = p.fairness
    return sorted(kept, key=lambda p: _cost(p.solution) + _understaffing(p.solution))


def _eps_min_cov(
    inst: Instance,
    *,
    fairness: FairnessMode,
    eps_max: float,
    warm_start: Solution,
    time_limit_s: float,
    mip_gap: float,
    understaffing_limit: float = 0.0,
    probes: int = 16,
) -> tuple[float, Solution]:
    """Smallest fairness level that still keeps understaffing ≈ 0.

    Pure-fairness ε_min often sits on the understaffing cliff (same thin
    roster, huge u penalty). The dial band is [ε_min_cov, ε_max].
    """
    if eps_max <= 0:
        return 0.0, warm_start

    # Probe descending from ε_max; first failure marks the cliff.
    step = eps_max / max(probes - 1, 1)
    epsilons = [eps_max - i * step for i in range(probes)]
    prev = warm_start
    last_good_eps = eps_max
    last_good_sol = warm_start
    for eps in epsilons[1:]:
        sol = solve(
            inst,
            fairness=fairness,
            fairness_epsilon=eps,
            objective_mode="cost_understaffing",
            warm_start=prev,
            time_limit_s=time_limit_s,
            mip_gap=mip_gap,
        )
        prev = sol
        if sol.status.value in ("optimal", "feasible") and _understaffing(sol) <= understaffing_limit + 1e-5:
            last_good_eps = fairness_measure_value(sol, fairness)
            last_good_sol = sol
        else:
            break
    return last_good_eps, last_good_sol


def pareto_frontier(
    inst: Instance,
    *,
    n_points: int = 12,
    fairness: FairnessMode = FairnessMode.MINMAX_HOURS,
    time_limit_s: float = 5.0,
    mip_gap: float = 0.01,
) -> list[ParetoPoint]:
    """Trace the cost–fairness frontier per docs/model.md §8.

    Sweep objective is COST + UNDERSTAFFING only — never λ_f.
    ε is spaced on the understaffing-free band [ε_min_cov, ε_max]; cliff
    points are dropped, never padded with dominated solutions.
    """
    if n_points < 2:
        raise ValueError("n_points must be >= 2")

    if inst.rules.modern_staffing:
        candidates: list[ParetoPoint] = []
        for multiplier in (0, 0.5, 1, 1.5, 2, 3, 5, 8, 12, 20)[:n_points]:
            sol = solve(inst, fairness=fairness, fairness_weight=inst.weights.fairness * multiplier,
                time_limit_s=time_limit_s, mip_gap=mip_gap)
            if sol.status.value in ("optimal", "feasible"):
                candidates.append(ParetoPoint(fairness_measure_value(sol, fairness), _cost(sol), _understaffing(sol),
                    fairness_measure_value(sol, fairness), sol))
        if not candidates:
            return []
        best_coverage = min(_shift_shortfall(inst, p.solution) for p in candidates)
        ordered = sorted((p for p in candidates if _shift_shortfall(inst, p.solution) == best_coverage), key=lambda p: (p.cost, p.fairness))
        distinct: list[ParetoPoint] = []
        seen: set[tuple[tuple[str, int, str], ...]] = set()
        seen_measures: set[tuple[float, float, float, float]] = set()
        for point in ordered:
            roster = tuple(sorted((a.employee, a.day, a.shift) for a in point.solution.assignments))
            signature = (round(point.cost, 2), round(point.fairness, 2),
                         round(point.solution.shortfall_person_periods, 2), point.solution.objective.supervisor_gap)
            if roster in seen or signature in seen_measures:
                continue
            seen.add(roster)
            seen_measures.add(signature)
            distinct.append(point)

        def measures(p: ParetoPoint) -> tuple[float, ...]:
            return (p.cost, p.fairness, p.solution.shortfall_person_periods, p.solution.objective.supervisor_gap)

        return [p for p in distinct if not any(
            all(a <= b + 1e-6 for a, b in zip(measures(q), measures(p)))
            and any(a < b - 1e-6 for a, b in zip(measures(q), measures(p)))
            for q in distinct if q is not p
        )]

    # 1. Cost-optimal (λ_f = 0) → ε_max
    cost_opt = solve(
        inst,
        fairness=fairness,
        fairness_weight=0.0,
        objective_mode="cost_understaffing",
        time_limit_s=time_limit_s,
        mip_gap=mip_gap,
    )
    eps_max = fairness_measure_value(cost_opt, fairness)
    baseline_understaffing = _understaffing(cost_opt)

    # 2. Understaffing-free lower end (not pure-fairness z=0)
    eps_min, band_start = _eps_min_cov(
        inst,
        fairness=fairness,
        eps_max=eps_max,
        warm_start=cost_opt,
        time_limit_s=time_limit_s,
        mip_gap=mip_gap,
        understaffing_limit=baseline_understaffing,
        probes=5 if inst.rules.modern_staffing else 16,
    )

    if eps_max < eps_min - 1e-6:
        eps_min, eps_max = eps_max, eps_min

    if abs(eps_max - eps_min) < 1e-9:
        epsilons = [eps_min]
    else:
        step = (eps_max - eps_min) / (n_points - 1)
        epsilons = [eps_min + i * step for i in range(n_points)]

    points: list[ParetoPoint] = []
    prev: Solution | None = band_start
    for eps in epsilons:
        sol = solve(
            inst,
            fairness=fairness,
            fairness_epsilon=eps,
            objective_mode="cost_understaffing",
            warm_start=prev,
            time_limit_s=time_limit_s,
            mip_gap=mip_gap,
        )
        prev = sol
        points.append(
            ParetoPoint(
                epsilon=eps,
                cost=_cost(sol),
                understaffing=_understaffing(sol),
                fairness=fairness_measure_value(sol, fairness),
                solution=sol,
            )
        )

    # Keep understaffing-free non-dominated points only (no cliff padding).
    kept = [
        p
        for p in _drop_dominated(points)
        if p.solution.status.value in ("optimal", "feasible") and p.understaffing <= baseline_understaffing + 1e-5
    ]
    if not kept:
        kept = [ParetoPoint(epsilon=eps_max, cost=_cost(cost_opt), understaffing=baseline_understaffing, fairness=eps_max, solution=cost_opt)]
    return kept
