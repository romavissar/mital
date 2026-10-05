"""Infeasibility / gap explainer. docs/data-contract.md conflict kinds.

The MILP is always feasible via slack; this explains why coverage or
supervisor slack is large, using structural checks and (optionally) a
Solution's uncovered rows. Explain strings match the constraint builders.
"""

from __future__ import annotations

from collections import defaultdict

from mital_solver.bench.generate import demand_person_hours
from mital_solver.model.base import open_periods, shift_covers
from mital_solver.schemas import (
    Conflict,
    ConflictCandidate,
    ConflictKind,
    InfeasibilityExplanation,
    Instance,
    Solution,
)


def _avail_shifts(inst: Instance, emp_id: str, day: int) -> set[str]:
    emp = next(e for e in inst.employees if e.id == emp_id)
    return next((set(a.shifts) for a in emp.availability if a.day == day), set())


def _qualified_available(
    inst: Instance, day: int, period: int, skill: str
) -> list[str]:
    shift_by_id = {s.id: s for s in inst.shifts}
    out: list[str] = []
    for e in inst.employees:
        if skill not in e.skills:
            continue
        offered = _avail_shifts(inst, e.id, day)
        if any(
            sid in shift_by_id and shift_covers(shift_by_id[sid], period)
            for sid in offered
        ):
            out.append(e.id)
    return out


def _candidates_for_gap(
    inst: Instance, day: int, period: int, skill: str
) -> list[ConflictCandidate]:
    """Employees who hold the skill but cannot cover this period."""
    covering = {s.id for s in inst.shifts if shift_covers(s, period)}
    cands: list[ConflictCandidate] = []
    available = set(_qualified_available(inst, day, period, skill))

    for e in inst.employees:
        if skill not in e.skills or e.id in available:
            continue
        offered = _avail_shifts(inst, e.id, day)
        if not offered:
            cands.append(
                ConflictCandidate(
                    employee=e.id,
                    reason="unavailable",
                    fix="add availability",
                )
            )
        elif not offered & covering:
            cands.append(
                ConflictCandidate(
                    employee=e.id,
                    reason="no available shift covers this period",
                    fix="extend availability to a covering shift",
                )
            )
        else:
            cands.append(
                ConflictCandidate(
                    employee=e.id,
                    reason=f"cannot cover period {period} with current staffing settings",
                    fix=None,
                )
            )
    return cands[:8]


def explain(
    inst: Instance,
    solution: Solution | None = None,
) -> InfeasibilityExplanation:
    """Return structured conflicts for uncoverable demand / supervisor gaps."""
    conflicts: list[Conflict] = []

    # --- skill shortfalls ---
    skill_gaps: dict[tuple[int, str], list[int]] = defaultdict(list)
    if solution is not None:
        for u in solution.uncovered:
            # Skip pure C6 rows (skill == supervisor_skill, shortfall 1);
            # those are reported under SUPERVISOR_GAP. C1 rows for the
            # supervisor skill as a demanded role still have required≥1 and
            # appear with whatever shortfall C1 recorded — include if the
            # skill also has ordinary demand shortfall beyond presence.
            if u.skill == inst.supervisor_skill and u.shortfall == 1:
                continue
            skill_gaps[(u.day, u.skill)].append(u.period)
    else:
        for dem in inst.demand:
            pool = _qualified_available(inst, dem.day, dem.period, dem.skill)
            if len(pool) < dem.required:
                skill_gaps[(dem.day, dem.skill)].append(dem.period)

    for (day, skill), periods in sorted(skill_gaps.items()):
        periods = sorted(set(periods))
        p0 = periods[0]
        msg = (
            f"Need more {skill} than are available on day {day} "
            f"across periods {periods[0]}–{periods[-1]}."
            if len(periods) > 1
            else (
                f"No feasible coverage for {skill} on day {day} "
                f"period {p0} without understaffing."
            )
        )
        conflicts.append(
            Conflict(
                kind=ConflictKind.NO_QUALIFIED_STAFF,
                day=day,
                periods=periods,
                skill=skill,
                message=msg,
                candidates=_candidates_for_gap(inst, day, p0, skill),
            )
        )

    # --- supervisor gaps ---
    sup_by_day: dict[int, list[int]] = defaultdict(list)
    if solution is not None and solution.objective.supervisor_gap > 0:
        assigned = {(a.employee, a.day, a.shift) for a in solution.assignments}
        supervisors = {
            e.id for e in inst.employees if inst.supervisor_skill in e.skills
        }
        shift_by_id = {s.id: s for s in inst.shifts}
        for day, period in sorted(open_periods(inst)):
            covered = any(
                a.employee in supervisors
                and shift_covers(shift_by_id[a.shift], period)
                for a in solution.assignments
                if a.day == day
            )
            if not covered:
                sup_by_day[day].append(period)
    else:
        for day, period in sorted(open_periods(inst)):
            if not _qualified_available(
                inst, day, period, inst.supervisor_skill
            ):
                sup_by_day[day].append(period)

    for day, periods in sorted(sup_by_day.items()):
        periods = sorted(set(periods))
        conflicts.append(
            Conflict(
                kind=ConflictKind.SUPERVISOR_GAP,
                day=day,
                periods=periods,
                skill=inst.supervisor_skill,
                message=(
                    f"No {inst.supervisor_skill} is available/scheduled "
                    f"on day {day} periods {periods[0]}–{periods[-1]}."
                ),
                candidates=_candidates_for_gap(
                    inst, day, periods[0], inst.supervisor_skill
                ),
            )
        )

    # --- availability vs min_hours ---
    sh = {s.id: s.paid_hours for s in inst.shifts}
    for e in inst.employees:
        if e.min_hours <= 0:
            continue
        reachable = sum(
            max(sh[s] for s in av.shifts if s in sh)
            for av in e.availability
            if av.shifts
        )
        if reachable + 1e-9 < e.min_hours:
            conflicts.append(
                Conflict(
                    kind=ConflictKind.AVAILABILITY_GAP,
                    day=None,
                    periods=[],
                    skill=None,
                    message=(
                        f"{e.id} has min_hours={e.min_hours} but at most "
                        f"{reachable}h reachable from availability."
                    ),
                    candidates=[
                        ConflictCandidate(
                            employee=e.id,
                            reason="insufficient availability for contracted minimum",
                            fix="add available days/shifts or lower min_hours",
                        )
                    ],
                )
            )

    # --- hours pool ---
    if solution is not None and solution.shortfall_person_periods > 0:
        total_cap = sum(e.max_hours for e in inst.employees)
        dph = demand_person_hours(inst)
        if dph > total_cap + 1e-6:
            conflicts.append(
                Conflict(
                    kind=ConflictKind.HOURS_CAP,
                    day=None,
                    periods=[],
                    skill=None,
                    message=(
                        f"Demand person-hours exceed sum(max_hours) "
                        f"({dph:.1f} > {total_cap:.1f})."
                    ),
                    candidates=[],
                )
            )

    return InfeasibilityExplanation(conflicts=conflicts)
