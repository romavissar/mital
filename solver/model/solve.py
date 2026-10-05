"""Build and solve the shift-assignment MILP. docs/model.md §§2–5."""

from __future__ import annotations

import time
from pathlib import Path

import pulp

from mital_solver.analysis.metrics import gini, jain
from mital_solver.model.base import build_variables
from mital_solver.model.constraints import add_all_constraints
from mital_solver.model.objectives import build_objective, evaluate_terms
from mital_solver.model.priorities import lock_staffing_priorities
from mital_solver.pay import regular_cost
from mital_solver.schemas import (
    Assignment,
    FairnessMode,
    FairnessReport,
    Instance,
    ObjectiveBreakdown,
    PerEmployeeStats,
    Pin,
    Solution,
    SolutionStatus,
    UncoveredEntry,
)


def extract_solution(
    mv,
    inst: Instance,
    terms,
    *,
    status: SolutionStatus,
    mip_gap: float,
    solve_time_s: float,
    fairness_mode: FairnessMode = FairnessMode.MINMAX_HOURS,
    solver_name: str = "highs",
) -> Solution:
    """Read variable values into a Solution (docs/data-contract.md)."""
    shift_by_id = {s.id: s for s in inst.shifts}
    weekend = set(inst.rules.weekend_days)
    closing_ids = {s.id for s in inst.shifts if s.closing}
    pref_map = {
        (e.id, p.shift, p.day): p.penalty
        for e in inst.employees
        for p in e.preferences
    }
    k_star = inst.supervisor_skill

    assignments: list[Assignment] = []
    for (e_id, s_id, d), var in mv.x.items():
        if (pulp.value(var) or 0.0) > 0.5:
            assignments.append(Assignment(employee=e_id, day=d, shift=s_id))

    term_vals = evaluate_terms(terms)

    # Supervisor gap count from u_sup (not from assignment reconstruction).
    supervisor_gap = sum(
        1 for var in mv.u_sup.values() if (pulp.value(var) or 0.0) > 0.5
    )
    objective = ObjectiveBreakdown(
        total=term_vals["total"],
        wages=term_vals["wages"],
        overtime=term_vals["overtime"],
        understaffing=term_vals["understaffing"],
        supervisor_penalty=term_vals["supervisor_penalty"],
        supervisor_gap=supervisor_gap,
        min_hours_penalty=term_vals["min_hours_penalty"],
        unfairness=term_vals["unfairness"],
        preference=term_vals["preference"],
    )

    per_employee: list[PerEmployeeStats] = []
    hours_list: list[float] = []
    weekend_counts: list[int] = []
    closing_counts: list[int] = []

    for e in inst.employees:
        worked = [a for a in assignments if a.employee == e.id]
        hours = sum(shift_by_id[a.shift].paid_hours for a in worked)
        hours_list.append(hours)
        w_n = sum(1 for a in worked if a.day in weekend)
        c_n = sum(1 for a in worked if a.shift in closing_ids)
        weekend_counts.append(w_n)
        closing_counts.append(c_n)
        ot = float(pulp.value(mv.o[e.id]) or 0.0)
        cost = regular_cost(inst, e, hours) + e.ot_wage * ot
        pref_pen = sum(
            pref_map.get((e.id, a.shift, a.day), 0.0) for a in worked
        )
        per_employee.append(
            PerEmployeeStats(
                employee=e.id,
                hours=hours,
                overtime_hours=ot,
                weekend_shifts=w_n,
                closing_shifts=c_n,
                cost=cost,
                preference_penalty=pref_pen,
            )
        )

    mean_h = sum(hours_list) / len(hours_list) if hours_list else 0.0
    max_dev = max((abs(h - mean_h) for h in hours_list), default=0.0)
    # Prefer model z when available (matches what was optimized).
    z_val = pulp.value(mv.z) if mv.z is not None else None
    if z_val is not None:
        max_dev = float(z_val)
    w_spread = (max(weekend_counts) - min(weekend_counts)) if weekend_counts else 0
    c_spread = (max(closing_counts) - min(closing_counts)) if closing_counts else 0
    if fairness_mode == FairnessMode.EQUITY_UNDESIRABLE:
        zw = pulp.value(mv.z_w)
        zcl = pulp.value(mv.z_cl)
        if zw is not None:
            w_spread = int(round(float(zw)))
        if zcl is not None:
            c_spread = int(round(float(zcl)))

    # C1 shortfalls from u variables (authoritative).
    uncovered: list[UncoveredEntry] = []
    shortfall_person_periods = 0.0
    for (period, skill, day), var in mv.u.items():
        short = float(pulp.value(var) or 0.0)
        if short > 0.5:
            s_int = int(round(short))
            uncovered.append(
                UncoveredEntry(
                    day=day, period=period, skill=skill, shortfall=s_int
                )
            )
            shortfall_person_periods += short

    uncovered_entry_count = len(uncovered)

    # C6 supervisor gaps — same list, skill = supervisor_skill.
    for (day, period), var in mv.u_sup.items():
        if (pulp.value(var) or 0.0) > 0.5:
            uncovered.append(
                UncoveredEntry(
                    day=day,
                    period=period,
                    skill=k_star,
                    shortfall=1,
                )
            )

    return Solution(
        status=status,
        mip_gap=mip_gap,
        solve_time_s=solve_time_s,
        solver=solver_name,
        assignments=assignments,
        objective=objective,
        per_employee=per_employee,
        fairness=FairnessReport(
            mode=fairness_mode,
            max_deviation_hours=max_dev,
            gini=gini(hours_list),
            jain=jain(hours_list),
            weekend_spread=w_spread,
            closing_spread=c_spread,
        ),
        uncovered_entry_count=uncovered_entry_count,
        shortfall_person_periods=shortfall_person_periods,
        uncovered=uncovered,
        duals=None,
        gap_trace=[],
    )


def _highs_status_and_gap(
    solver_model,
    *,
    pulp_status: str,
    has_incumbent: bool,
    elapsed: float,
    time_limit_s: float,
) -> tuple[SolutionStatus, float]:
    """Map HiGHS native status → SolutionStatus; return true MIP gap.

    PuLP reports time-limit termination as Optimal (LpStatus=1). Read
    getModelStatus() instead. Gap comes from HighsInfo.mip_gap
    (incumbent vs dual bound), not a missing getMipGap hook.
    """
    gap = 0.0
    model_status = ""
    try:
        model_status = solver_model.modelStatusToString(
            solver_model.getModelStatus()
        ).lower()
    except Exception:
        model_status = ""
    try:
        info = solver_model.getInfo()
        raw = float(info.mip_gap)
        if raw == raw and raw not in (float("inf"), float("-inf")):
            gap = raw
    except Exception:
        gap = 0.0

    if "time limit" in model_status:
        try:
            if int(solver_model.getInfo().primal_solution_status) == 2:
                return SolutionStatus.FEASIBLE, gap
        except Exception:
            pass
        return SolutionStatus.TIMEOUT, gap
    if "infeasible" in model_status or pulp_status == "Infeasible":
        return SolutionStatus.INFEASIBLE, gap
    if "optimal" in model_status or pulp_status == "Optimal":
        return SolutionStatus.OPTIMAL, gap
    if has_incumbent:
        if elapsed >= time_limit_s * 0.95:
            return SolutionStatus.TIMEOUT, gap
        return SolutionStatus.FEASIBLE, gap
    return SolutionStatus.INFEASIBLE, gap


def fairness_measure_value(sol: Solution, fairness: FairnessMode) -> float:
    """Scalar fairness used by the ε-constraint (§8)."""
    z = sol.fairness.max_deviation_hours
    if fairness == FairnessMode.EQUITY_UNDESIRABLE:
        return z + float(sol.fairness.weekend_spread) + float(
            sol.fairness.closing_spread
        )
    return z


def _apply_warm_start(mv, warm_start: Solution) -> None:
    assigned = {(a.employee, a.shift, a.day) for a in warm_start.assignments}
    for (e_id, s_id, d), var in mv.x.items():
        try:
            var.setInitialValue(1.0 if (e_id, s_id, d) in assigned else 0.0)
        except Exception:
            pass


def _apply_pins(mv, pins: list[Pin]) -> None:
    """Fix x[e,s,d] to pin values. Pinning value=1 on a non-existent triple fails."""
    for p in pins:
        key = (p.employee, p.shift, p.day)
        if key not in mv.x:
            if p.value == 1:
                raise ValueError(
                    f"cannot pin assignment "
                    f"({p.employee}, {p.shift}, day {p.day})=1: "
                    "triple was eliminated (unavailable or unqualified)"
                )
            continue
        mv.x[key].lowBound = float(p.value)
        mv.x[key].upBound = float(p.value)


def solve(
    inst: Instance,
    *,
    time_limit_s: float = 5.0,
    mip_gap: float = 0.01,
    fairness: FairnessMode = FairnessMode.MINMAX_HOURS,
    fairness_weight: float | None = None,
    fairness_epsilon: float | None = None,
    objective_mode: str = "full",
    warm_start: Solution | None = None,
    pins: list[Pin] | None = None,
    duals: bool = False,
    msg: bool = False,
    backend: str = "highs",
) -> Solution:
    """Build the MILP (docs/model.md §§2–5) and solve with HiGHS (or CBC).

    LEXIMIN is not implemented (docs/model.md §5.3).

    fairness_epsilon — optional upper bound on the fairness measure (§8).
    objective_mode — see build_objective (full | cost_understaffing |
    fairness_only | repair).
    backend — "highs" (default) or "cbc" (S12 benchmark only).
    """
    if fairness == FairnessMode.LEXIMIN:
        raise ValueError(
            "LEXIMIN is not implemented"
        )
    if backend not in ("highs", "cbc"):
        raise ValueError(f"unknown solver backend {backend!r}")

    equity = fairness == FairnessMode.EQUITY_UNDESIRABLE
    mv = build_variables(inst)
    add_all_constraints(mv, inst, equity_undesirable=equity)
    if pins:
        _apply_pins(mv, pins)

    if fairness_epsilon is not None:
        assert mv.z is not None and mv.z_w is not None and mv.z_cl is not None
        measure = (mv.z + mv.z_w + mv.z_cl) if equity else mv.z
        mv.prob += measure <= fairness_epsilon, "fairness_epsilon"

    terms = build_objective(
        mv,
        inst,
        equity_undesirable=equity,
        fairness_weight=fairness_weight,
        mode=objective_mode,
    )

    if warm_start is not None:
        _apply_warm_start(mv, warm_start)

    if backend == "highs":
        solver = pulp.HiGHS(msg=msg, timeLimit=time_limit_s, gapRel=mip_gap)
    else:
        solver = pulp.PULP_CBC_CMD(
            msg=msg, timeLimit=time_limit_s, gapRel=mip_gap
        )

    t0 = time.perf_counter()
    lock_staffing_priorities(mv, solver)
    status_code = mv.prob.solve(solver)
    elapsed = time.perf_counter() - t0

    pulp_status = pulp.LpStatus[status_code]
    has_incumbent = pulp.value(mv.prob.objective) is not None

    if backend == "highs":
        solver_name = getattr(mv.prob.solver, "name", "") or ""
        if "highs" not in solver_name.lower():
            raise RuntimeError(
                f"expected HiGHS backend, got {solver_name!r} "
                f"({type(mv.prob.solver).__name__})"
            )
        status, gap = _highs_status_and_gap(
            mv.prob.solverModel,
            pulp_status=pulp_status,
            has_incumbent=has_incumbent,
            elapsed=elapsed,
            time_limit_s=time_limit_s,
        )
        out_solver = "highs"
    else:
        # CBC via PuLP: status codes are trustworthy; gap often unavailable.
        gap = 0.0
        if pulp_status == "Optimal":
            status = SolutionStatus.OPTIMAL
        elif pulp_status == "Infeasible":
            status = SolutionStatus.INFEASIBLE
        elif has_incumbent:
            status = (
                SolutionStatus.TIMEOUT
                if elapsed >= time_limit_s * 0.95
                else SolutionStatus.FEASIBLE
            )
        else:
            status = SolutionStatus.INFEASIBLE
        out_solver = "cbc"

    sol = extract_solution(
        mv,
        inst,
        terms,
        status=status,
        mip_gap=gap,
        solve_time_s=elapsed,
        fairness_mode=fairness,
        solver_name=out_solver,
    )
    if duals and status != SolutionStatus.INFEASIBLE:
        from mital_solver.analysis.duals import compute_duals

        sol.duals = compute_duals(inst, sol, fairness=fairness)
    return sol


def print_roster(inst: Instance, sol: Solution) -> None:
    """Print an employee × day roster grid for manual inspection."""
    shift_by_id = {s.id: s for s in inst.shifts}
    by_emp_day: dict[tuple[str, int], str] = {
        (a.employee, a.day): a.shift for a in sol.assignments
    }
    days = list(range(inst.horizon_days))
    header = f"{'employee':<10}" + "".join(f"{'d' + str(d):>10}" for d in days)
    print(header)
    print("-" * len(header))
    for e in inst.employees:
        cells = []
        for d in days:
            sid = by_emp_day.get((e.id, d), ".")
            if sid == ".":
                cells.append(f"{'.':>10}")
            else:
                sh = shift_by_id[sid]
                label = f"{sid}[{sh.start_period}-{sh.end_period})"
                cells.append(f"{label:>10}")
        print(f"{e.id:<10}" + "".join(cells))
    print(
        f"status={sol.status.value} obj={sol.objective.total:.2f} "
        f"uncovered_entries={sol.uncovered_entry_count} "
        f"shortfall_pp={sol.shortfall_person_periods:.1f} "
        f"sup_gap={sol.objective.supervisor_gap} "
        f"time={sol.solve_time_s:.2f}s"
    )


def load_instance(path: str | Path) -> Instance:
    return Instance.model_validate_json(Path(path).read_text())
