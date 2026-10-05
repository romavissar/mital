"""Scheduling constraints. docs/model.md §3.

Each builder returns ConstraintSet(rows, explain). See docs/model.md for the formulation.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field

import pulp

from mital_solver.model.base import ModelVars, shift_covers
from mital_solver.schemas import Instance


ExplainFn = Callable[..., str]


@dataclass
class ConstraintSet:
    rows: list = field(default_factory=list)
    explain: ExplainFn = field(default=lambda *a, **k: "")


def coverage(mv: ModelVars, inst: Instance) -> ConstraintSet:
    """C1 — Coverage with understaffing slack. docs/model.md §3.

    Always feasible via u (≥ 0). Skip rows where r = 0. §11.4: never hard.
    """
    rows: list = []
    shift_by_id = {s.id: s for s in inst.shifts}
    emp_skills = {e.id: set(e.skills) for e in inst.employees}

    for dem in inst.demand:
        if dem.required <= 0:
            continue
        if inst.rules.modern_staffing and dem.skill == inst.supervisor_skill and any(inst.supervisor_skill not in e.skills for e in inst.employees):
            continue
        u = mv.u[(dem.period, dem.skill, dem.day)]
        covered = pulp.lpSum(
            var
            for (e_id, s_id, d), var in mv.x.items()
            if d == dem.day
            and dem.skill in emp_skills[e_id]
            and shift_covers(shift_by_id[s_id], dem.period)
        )
        rows.append(
            covered + u >= dem.required
        )

    def explain(day: int, period: int, skill: str) -> str:
        return (
            f"No feasible coverage for {skill} on day {day} "
            f"period {period} without understaffing."
        )

    return ConstraintSet(rows=rows, explain=explain)


def one_shift_per_day(mv: ModelVars, inst: Instance) -> ConstraintSet:
    """C2 — At most one shift per employee per day. docs/model.md §3."""
    rows: list = []
    for e in inst.employees:
        for d in range(inst.horizon_days):
            xs = [
                var for (e_id, _s, day), var in mv.x.items()
                if e_id == e.id and day == d
            ]
            if xs:
                rows.append(pulp.lpSum(xs) <= 1)

    def explain(employee: str, day: int) -> str:
        return f"{employee} cannot work more than one shift on day {day}."

    return ConstraintSet(rows=rows, explain=explain)


def contracted_hours(mv: ModelVars, inst: Instance) -> ConstraintSet:
    """C3 — Contracted hours with overtime. docs/model.md §3.

    Manager-entered upper bound hard. Lower bound soft via u_min.
    """
    rows: list = []
    for e in inst.employees:
        h = mv.h[e.id]
        o = mv.o[e.id]
        rows.append(h <= e.max_hours + o)
        rows.append(h + mv.u_min[e.id] >= e.min_hours)

    def explain(employee: str, kind: str = "max") -> str:
        if kind == "min":
            return f"{employee} is below contracted minimum hours."
        return f"{employee} exceeds max hours even with overtime."

    return ConstraintSet(rows=rows, explain=explain)


def supervisor_presence(mv: ModelVars, inst: Instance) -> ConstraintSet:
    """C6 — Supervisors work with staff, and staff are supervised when possible."""
    rows: list = []
    shift_by_id = {s.id: s for s in inst.shifts}
    k_star = inst.supervisor_skill
    supervisors = {e.id for e in inst.employees if k_star in e.skills}
    regular = {e.id for e in inst.employees if e.id not in supervisors}

    if not inst.rules.requires_supervision:
        rows.extend(u_sup == 0 for u_sup in mv.u_sup.values())
    elif not inst.rules.modern_staffing:
        for (day, period), u_sup in mv.u_sup.items():
            covered = pulp.lpSum(var for (e_id, s_id, d), var in mv.x.items()
                if d == day and e_id in supervisors and shift_covers(shift_by_id[s_id], period))
            rows.append(covered + u_sup >= 1)
        return ConstraintSet(rows=rows, explain=lambda day, period: f"No {k_star} is scheduled on day {day} period {period}.")

    if inst.rules.modern_staffing and regular:
        for d in range(inst.horizon_days):
            for shift in inst.shifts:
                sup = pulp.lpSum(var for (e, s, day), var in mv.x.items() if day == d and s == shift.id and e in supervisors)
                staff = pulp.lpSum(var for (e, s, day), var in mv.x.items() if day == d and s == shift.id and e in regular)
                rows.append(sup <= staff)

    if not inst.rules.requires_supervision:
        return ConstraintSet(rows=rows, explain=lambda *args: "Supervision is optional.")

    if not regular:
        # Legacy single-role rosters have no separate employee role.
        rows.extend(u_sup == 0 for u_sup in mv.u_sup.values())
        return ConstraintSet(rows=rows, explain=lambda *args: "")

    for (day, period), u_sup in mv.u_sup.items():
        covered = pulp.lpSum(
            var
            for (e_id, s_id, d), var in mv.x.items()
            if d == day
            and e_id in supervisors
            and shift_covers(shift_by_id[s_id], period)
        )
        rows.extend(covered + u_sup >= var for (e_id, s_id, d), var in mv.x.items()
            if d == day and e_id in regular and shift_covers(shift_by_id[s_id], period))

    def explain(day: int, period: int) -> str:
        return (
            f"No {k_star} is scheduled on day {day} period {period} "
            f"(employees need a supervisor when more than one person may work)."
        )

    return ConstraintSet(rows=rows, explain=explain)


def shift_staffing(mv: ModelVars, inst: Instance) -> ConstraintSet:
    """C9 — Hard maximum and soft minimum headcount for each shift."""
    rows: list = []
    for d in range(inst.horizon_days):
        for shift in inst.shifts:
            count = pulp.lpSum(var for (e, s, day), var in mv.x.items() if s == shift.id and day == d)
            if inst.rules.modern_staffing and inst.rules.max_people_per_shift is not None:
                rows.append(count <= inst.rules.max_people_per_shift)
            slack = mv.u_shift.get((shift.id, d))
            if slack is not None:
                rows.append(count + slack >= inst.rules.min_people_per_shift)
    return ConstraintSet(rows=rows, explain=lambda shift, day: f"Shift {shift} on day {day} is below its minimum staffing.")


def fairness_minmax(
    mv: ModelVars,
    inst: Instance,
    *,
    equity_undesirable: bool = False,
) -> ConstraintSet:
    """C7 — Min–max fairness linearization. docs/model.md §3, §5, §11.2–3.

    Both directions required. h̄ is an affine expression in x, not a constant.
    When equity_undesirable (§5.2), also bound weekend and closing spreads.
    """
    rows: list = []
    n = len(inst.employees)
    if n == 0:
        return ConstraintSet(rows=rows, explain=lambda: "")

    assert mv.z is not None and mv.z_w is not None and mv.z_cl is not None

    h_bar = (1.0 / n) * pulp.lpSum(mv.h[e.id] for e in inst.employees)
    for e in inst.employees:
        rows.append(mv.z >= mv.h[e.id] - h_bar)
        rows.append(mv.z >= h_bar - mv.h[e.id])

    if equity_undesirable:
        weekend = set(inst.rules.weekend_days)
        closing_ids = {s.id for s in inst.shifts if s.closing}
        w_count = {
            e.id: pulp.lpSum(
                var
                for (e_id, _s, d), var in mv.x.items()
                if e_id == e.id and d in weekend
            )
            for e in inst.employees
        }
        cl_count = {
            e.id: pulp.lpSum(
                var
                for (e_id, s_id, _d), var in mv.x.items()
                if e_id == e.id and s_id in closing_ids
            )
            for e in inst.employees
        }
        w_bar = (1.0 / n) * pulp.lpSum(w_count[e.id] for e in inst.employees)
        cl_bar = (1.0 / n) * pulp.lpSum(cl_count[e.id] for e in inst.employees)
        for e in inst.employees:
            rows.append(mv.z_w >= w_count[e.id] - w_bar)
            rows.append(mv.z_w >= w_bar - w_count[e.id])
            rows.append(mv.z_cl >= cl_count[e.id] - cl_bar)
            rows.append(mv.z_cl >= cl_bar - cl_count[e.id])
    else:
        # Fix unused equity variables at zero under MINMAX_HOURS (§5.1).
        rows.append(mv.z_w == 0)
        rows.append(mv.z_cl == 0)

    def explain() -> str:
        return "Fairness bounds on hour / weekend / closing deviation."

    return ConstraintSet(rows=rows, explain=explain)


def add_all_constraints(
    mv: ModelVars,
    inst: Instance,
    *,
    equity_undesirable: bool = False,
    include_coverage: bool = True,
) -> dict[str, ConstraintSet]:
    """Attach applicable constraint sets to the problem; return sets for /explain.

    Set include_coverage=False when the caller adds named C1/C6 rows
    itself (LP dual extraction).
    """
    sets: dict[str, ConstraintSet] = {
        "C2": one_shift_per_day(mv, inst),
        "C3": contracted_hours(mv, inst),
        "C7": fairness_minmax(
            mv, inst, equity_undesirable=equity_undesirable
        ),
        "C9": shift_staffing(mv, inst),
    }
    if include_coverage:
        sets = {
            "C1": coverage(mv, inst),
            **sets,
            "C6": supervisor_presence(mv, inst),
        }
    for cset in sets.values():
        for row in cset.rows:
            mv.prob += row
    return sets
