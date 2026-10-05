"""Sensitivity analysis. docs/model.md §7.

Fix integer assignments, re-solve as an LP, extract duals. Every dual is
tagged with provenance — FIXED_LP, RELAXATION, or DEGENERATE. Relaxation
prices are attached for ranking but never silently copied into shadow_price.
"""

from __future__ import annotations

import pulp

from mital_solver.model.base import (
    ModelVars,
    is_feasible_triple,
    open_periods,
    shift_covers,
)
from mital_solver.model.constraints import add_all_constraints
from mital_solver.model.objectives import build_objective
from mital_solver.schemas import (
    CoverageDual,
    DualProvenance,
    Duals,
    FairnessMode,
    Instance,
    ReducedCost,
    Solution,
)

DUALS_NOTE = (
    "LP duals at the fixed integer solution; locally valid guidance, "
    "not MILP-exact. Each dual carries a provenance tag "
    "(fixed_lp | relaxation | degenerate) — never substitute one for "
    "another silently. Supervisor duals are from a soft constraint "
    "(u_sup): a fully saturated unsupervised period prices at λ_sup "
    "rather than the true hard marginal cost of finding a keyholder."
)


def compute_duals(
    inst: Instance,
    solution: Solution,
    *,
    fairness: FairnessMode = FairnessMode.MINMAX_HOURS,
) -> Duals:
    """Fix x to the MILP solution, re-solve the LP, return tagged duals. §7."""
    equity = fairness == FairnessMode.EQUITY_UNDESIRABLE

    fixed_mv, c1_names, c6_names = _build_lp(
        inst, equity=equity, fixed=solution
    )
    build_objective(fixed_mv, inst, equity_undesirable=equity)
    fixed_mv.prob.solve(pulp.HiGHS(msg=False))

    relax_mv, relax_c1, relax_c6 = _build_lp(inst, equity=equity, fixed=None)
    build_objective(relax_mv, inst, equity_undesirable=equity)
    relax_mv.prob.solve(pulp.HiGHS(msg=False))

    lam_u = inst.weights.understaffing
    lam_sup = inst.weights.supervisor
    crit = {
        (d.period, d.skill, d.day): float(d.criticality) for d in inst.demand
    }

    coverage: list[CoverageDual] = []
    for (period, skill, day), name in c1_names.items():
        cons = fixed_mv.prob.constraints.get(name)
        if cons is None:
            continue
        pi_fixed = float(cons.pi) if cons.pi is not None else 0.0
        u_val = float(pulp.value(fixed_mv.u[(period, skill, day)]) or 0.0)
        slack = float(cons.slack) if cons.slack is not None else None
        exact = slack is not None and abs(slack) < 1e-6
        understaffed = u_val > 1e-6
        binding = exact and not understaffed

        rcons = relax_mv.prob.constraints.get(relax_c1[(period, skill, day)])
        pi_relax = float(rcons.pi) if rcons is not None and rcons.pi else 0.0
        relax_price = pi_relax if abs(pi_relax) > 1e-8 else None

        if understaffed:
            # Complementary slackness on the fixed-x LP: dual = λ_u·ω.
            # This is FIXED_LP, not a silent relaxation substitute.
            price = pi_fixed if abs(pi_fixed) > 1e-8 else (
                lam_u * crit.get((period, skill, day), 1.0)
            )
            provenance = DualProvenance.FIXED_LP
        elif binding:
            if abs(pi_fixed) > 1e-8:
                price = pi_fixed
                provenance = DualProvenance.FIXED_LP
            else:
                # Tight with π≈0 — dual ray / empty postsolve. Report 0 honestly.
                price = 0.0
                provenance = DualProvenance.DEGENERATE
        else:
            continue  # surplus — skip

        # Emit the fixed-x / degenerate dual.
        coverage.append(
            CoverageDual(
                day=day,
                period=period,
                skill=skill,
                shadow_price=price,
                provenance=provenance,
                binding=binding,
                relaxation_price=relax_price,
            )
        )
        # Also emit an explicitly tagged RELAXATION dual when available and
        # distinct, so the API never pretends one number is the other.
        if relax_price is not None and (
            provenance != DualProvenance.FIXED_LP
            or abs(relax_price - price) > 1e-6
        ):
            coverage.append(
                CoverageDual(
                    day=day,
                    period=period,
                    skill=skill,
                    shadow_price=relax_price,
                    provenance=DualProvenance.RELAXATION,
                    binding=binding,
                    relaxation_price=relax_price,
                )
            )

    supervisor: list[CoverageDual] = []
    k_star = inst.supervisor_skill
    for (day, period), name in c6_names.items():
        cons = fixed_mv.prob.constraints.get(name)
        if cons is None:
            continue
        pi_fixed = float(cons.pi) if cons.pi is not None else 0.0
        u_val = float(pulp.value(fixed_mv.u_sup[(day, period)]) or 0.0)
        slack = float(cons.slack) if cons.slack is not None else None
        exact = slack is not None and abs(slack) < 1e-6
        gap = u_val > 1e-6
        binding = exact and not gap

        rcons = relax_mv.prob.constraints.get(relax_c6[(day, period)])
        pi_relax = float(rcons.pi) if rcons is not None and rcons.pi else 0.0
        relax_price = pi_relax if abs(pi_relax) > 1e-8 else None

        if gap:
            price = pi_fixed if abs(pi_fixed) > 1e-8 else lam_sup
            provenance = DualProvenance.FIXED_LP
        elif binding:
            if abs(pi_fixed) > 1e-8:
                price = pi_fixed
                provenance = DualProvenance.FIXED_LP
            else:
                price = 0.0
                provenance = DualProvenance.DEGENERATE
        else:
            continue

        supervisor.append(
            CoverageDual(
                day=day,
                period=period,
                skill=k_star,
                shadow_price=price,
                provenance=provenance,
                binding=binding,
                relaxation_price=relax_price,
            )
        )
        if relax_price is not None and (
            provenance != DualProvenance.FIXED_LP
            or abs(relax_price - price) > 1e-6
        ):
            supervisor.append(
                CoverageDual(
                    day=day,
                    period=period,
                    skill=k_star,
                    shadow_price=relax_price,
                    provenance=DualProvenance.RELAXATION,
                    binding=binding,
                    relaxation_price=relax_price,
                )
            )

    assigned = {(a.employee, a.shift, a.day) for a in solution.assignments}
    reduced: list[ReducedCost] = []
    for (e_id, s_id, d), var in fixed_mv.x.items():
        if (e_id, s_id, d) in assigned:
            continue
        dj = float(var.dj) if var.dj is not None else 0.0
        # Reduced costs: report fixed-x dj only (no silent relax swap).
        if abs(dj) > 1e-6:
            reduced.append(
                ReducedCost(
                    employee=e_id,
                    day=d,
                    shift=s_id,
                    reduced_cost=dj,
                )
            )

    reduced.sort(key=lambda r: (-abs(r.reduced_cost), r.employee))

    # Keep all provenance tags for the top keys by |relaxation_price|,
    # so RELAXATION rows are never truncated away by DEGENERATE volume.
    coverage = _trim_duals(coverage, limit_keys=40)
    supervisor = _trim_duals(supervisor, limit_keys=20)

    return Duals(
        coverage=coverage,
        supervisor=supervisor,
        reduced_costs=reduced[:50],
        note=DUALS_NOTE,
    )


def _trim_duals(duals: list[CoverageDual], *, limit_keys: int) -> list[CoverageDual]:
    by_key: dict[tuple, list[CoverageDual]] = {}
    for c in duals:
        by_key.setdefault((c.day, c.period, c.skill), []).append(c)

    def key_score(items: list[CoverageDual]) -> float:
        return max((abs(c.relaxation_price or 0.0) for c in items), default=0.0)

    top_keys = sorted(by_key.keys(), key=lambda k: -key_score(by_key[k]))[:limit_keys]
    out: list[CoverageDual] = []
    for k in top_keys:
        # Stable order: fixed_lp, degenerate, relaxation
        order = {
            DualProvenance.FIXED_LP: 0,
            DualProvenance.DEGENERATE: 1,
            DualProvenance.RELAXATION: 2,
        }
        out.extend(sorted(by_key[k], key=lambda c: order[c.provenance]))
    return out


def _build_lp(
    inst: Instance,
    *,
    equity: bool,
    fixed: Solution | None,
) -> tuple[ModelVars, dict, dict]:
    """Build LP. If `fixed` is set, pin x to that roster (§7); else [0,1] relaxation."""
    prob = pulp.LpProblem(
        "mital_lp_fixed" if fixed is not None else "mital_lp_relax",
        pulp.LpMinimize,
    )
    mv = ModelVars(prob=prob)
    assigned = (
        {(a.employee, a.shift, a.day) for a in fixed.assignments}
        if fixed is not None
        else set()
    )
    shift_hours = {s.id: s.paid_hours for s in inst.shifts}

    for e in inst.employees:
        for d in range(inst.horizon_days):
            for s in inst.shifts:
                if not is_feasible_triple(inst, e.id, s.id, d):
                    continue
                if fixed is not None:
                    val = 1.0 if (e.id, s.id, d) in assigned else 0.0
                    mv.x[(e.id, s.id, d)] = pulp.LpVariable(
                        f"xc_{e.id}_{s.id}_{d}",
                        lowBound=val,
                        upBound=val,
                        cat=pulp.LpContinuous,
                    )
                else:
                    mv.x[(e.id, s.id, d)] = pulp.LpVariable(
                        f"xr_{e.id}_{s.id}_{d}",
                        lowBound=0.0,
                        upBound=1.0,
                        cat=pulp.LpContinuous,
                    )
        mv.o[e.id] = pulp.LpVariable(
            f"o_{e.id}", lowBound=0.0, upBound=float(e.max_overtime)
        )
        mv.u_min[e.id] = pulp.LpVariable(f"u_min_{e.id}", lowBound=0.0)
        mv.h[e.id] = pulp.lpSum(
            shift_hours[s_id] * var
            for (e_id, s_id, _d), var in mv.x.items()
            if e_id == e.id
        )

    for dem in inst.demand:
        if dem.required <= 0:
            continue
        if inst.rules.modern_staffing and dem.skill == inst.supervisor_skill and any(inst.supervisor_skill not in e.skills for e in inst.employees):
            continue
        key = (dem.period, dem.skill, dem.day)
        if key not in mv.u:
            mv.u[key] = pulp.LpVariable(
                f"u_{dem.day}_{dem.period}_{dem.skill}", lowBound=0.0
            )

    for day, period in open_periods(inst):
        mv.u_sup[(day, period)] = pulp.LpVariable(
            f"u_sup_{day}_{period}", lowBound=0.0
        )

    for d in range(inst.horizon_days):
        for shift in inst.shifts:
            if inst.rules.modern_staffing and inst.rules.min_people_per_shift and any(dem.day == d and dem.required > 0 and shift_covers(shift, dem.period) for dem in inst.demand):
                mv.u_shift[(shift.id, d)] = pulp.LpVariable(f"u_shift_{shift.id}_{d}", lowBound=0.0)

    mv.z = pulp.LpVariable("z", lowBound=0.0)
    mv.z_w = pulp.LpVariable("z_w", lowBound=0.0)
    mv.z_cl = pulp.LpVariable("z_cl", lowBound=0.0)

    c1_names, c6_names = _add_named_coverage(mv, inst)
    add_all_constraints(
        mv, inst, equity_undesirable=equity, include_coverage=False,
    )
    return mv, c1_names, c6_names


def _add_named_coverage(
    mv: ModelVars, inst: Instance
) -> tuple[dict[tuple[int, str, int], str], dict[tuple[int, int], str]]:
    shift_by_id = {s.id: s for s in inst.shifts}
    emp_skills = {e.id: set(e.skills) for e in inst.employees}
    c1: dict[tuple[int, str, int], str] = {}
    for dem in inst.demand:
        if dem.required <= 0:
            continue
        if inst.rules.modern_staffing and dem.skill == inst.supervisor_skill and any(inst.supervisor_skill not in e.skills for e in inst.employees):
            continue
        name = f"C1_d{dem.day}_p{dem.period}_{dem.skill}"
        u = mv.u[(dem.period, dem.skill, dem.day)]
        covered = pulp.lpSum(
            var
            for (e_id, s_id, d), var in mv.x.items()
            if d == dem.day
            and dem.skill in emp_skills[e_id]
            and shift_covers(shift_by_id[s_id], dem.period)
        )
        mv.prob += (covered + u >= dem.required, name)
        c1[(dem.period, dem.skill, dem.day)] = name

    k_star = inst.supervisor_skill
    supervisors = {e.id for e in inst.employees if k_star in e.skills}
    regular = {e.id for e in inst.employees if e.id not in supervisors}
    c6: dict[tuple[int, int], str] = {}
    if not inst.rules.modern_staffing:
        for (day, period), u_sup in mv.u_sup.items():
            name = f"C6_d{day}_p{period}"
            covered = pulp.lpSum(var for (e_id, s_id, d), var in mv.x.items()
                if d == day and e_id in supervisors and shift_covers(shift_by_id[s_id], period))
            mv.prob += (covered + u_sup >= 1, name)
            c6[(day, period)] = name
        return c1, c6
    if not regular:
        for u_sup in mv.u_sup.values():
            mv.prob += u_sup == 0
        return c1, c6
    for d in range(inst.horizon_days):
        for shift in inst.shifts:
            sup = pulp.lpSum(var for (e, s, day), var in mv.x.items() if day == d and s == shift.id and e in supervisors)
            staff = pulp.lpSum(var for (e, s, day), var in mv.x.items() if day == d and s == shift.id and e in regular)
            mv.prob += sup <= staff
    for (day, period), u_sup in mv.u_sup.items():
        if inst.rules.max_people_per_shift == 1:
            mv.prob += u_sup == 0
            continue
        name = f"C6_d{day}_p{period}"
        covered = pulp.lpSum(
            var
            for (e_id, s_id, d), var in mv.x.items()
            if d == day
            and e_id in supervisors
            and shift_covers(shift_by_id[s_id], period)
        )
        workers = [var for (e_id, s_id, d), var in mv.x.items()
            if d == day and e_id in regular and shift_covers(shift_by_id[s_id], period)]
        for index, var in enumerate(workers):
            row_name = name if index == 0 else f"{name}_{index}"
            mv.prob += (covered + u_sup >= var, row_name)
        if workers:
            c6[(day, period)] = name
    return c1, c6
