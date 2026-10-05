"""Heuristic baselines that respect the same hard constraints as the MILP.

docs/model.md §3 hard families include one shift per day and the manager-entered
upper hour bound. Coverage, supervisor presence, and contracted minima are soft — shortfalls become the
usual understaffing / min-hours penalties so the Solution schema matches
the MILP.

Greedy fills periods with the cheapest feasible employee;
round_robin equalizes hours and ignores cost.
"""

from __future__ import annotations

import time
from collections import defaultdict

from mital_solver.analysis.metrics import gini, jain
from mital_solver.model.base import is_feasible_triple, open_periods, shift_covers
from mital_solver.pay import regular_cost
from mital_solver.schemas import (
    Assignment,
    FairnessMode,
    FairnessReport,
    Instance,
    ObjectiveBreakdown,
    PerEmployeeStats,
    Solution,
    SolutionStatus,
    UncoveredEntry,
)


def _incompatible_shift_ids(inst: Instance) -> set[tuple[str, str]]:
    """(s, s') pairs that violate rest across consecutive days. docs/model.md §1."""
    rho = inst.rules.min_rest_hours
    out: set[tuple[str, str]] = set()
    for s in inst.shifts:
        end_s = s.end_period / 4.0
        for s2 in inst.shifts:
            start_s2 = s2.start_period / 4.0
            if end_s + rho > start_s2 + 24.0:
                out.add((s.id, s2.id))
    return out


def _hours_map(
    inst: Instance, roster: dict[tuple[str, int], str]
) -> dict[str, float]:
    shift_hours = {s.id: s.paid_hours for s in inst.shifts}
    hours = {e.id: 0.0 for e in inst.employees}
    for (e_id, _d), s_id in roster.items():
        hours[e_id] += shift_hours[s_id]
    return hours


def _can_assign(
    inst: Instance,
    emp_id: str,
    shift_id: str,
    day: int,
    roster: dict[tuple[str, int], str],
    incompat: set[tuple[str, str]],
) -> bool:
    """True iff assigning (emp, shift, day) keeps C2/C3-upper/C4/C5."""
    if (emp_id, day) in roster:
        return False
    if not is_feasible_triple(inst, emp_id, shift_id, day):
        return False

    emp = next(e for e in inst.employees if e.id == emp_id)
    shift = next(s for s in inst.shifts if s.id == shift_id)
    hours = _hours_map(inst, roster)
    if hours[emp_id] + shift.paid_hours > emp.max_hours + emp.max_overtime + 1e-9:
        return False

    # C4 — rest with previous / next day.
    if day > 0:
        prev = roster.get((emp_id, day - 1))
        if prev is not None and (prev, shift_id) in incompat:
            return False
    if day + 1 < inst.horizon_days:
        nxt = roster.get((emp_id, day + 1))
        if nxt is not None and (shift_id, nxt) in incompat:
            return False

    # C5 — consecutive days: every window of length C+1 containing `day`.
    c = emp.max_consecutive_days
    working = {
        d for d in range(inst.horizon_days) if (emp_id, d) in roster or d == day
    }
    for start in range(0, inst.horizon_days - c):
        if start <= day <= start + c:
            if sum(1 for d in range(start, start + c + 1) if d in working) > c:
                return False
    return True


def _coverage_gain(
    inst: Instance,
    emp_id: str,
    shift_id: str,
    day: int,
    shortfall: dict[tuple[int, int, str], float],
) -> float:
    """How many shortfall person-periods this assignment would clear."""
    emp = next(e for e in inst.employees if e.id == emp_id)
    shift = next(s for s in inst.shifts if s.id == shift_id)
    skills = set(emp.skills)
    gain = 0.0
    for (d, period, skill), left in shortfall.items():
        if d != day or left <= 0 or skill not in skills:
            continue
        if shift_covers(shift, period):
            gain += min(1.0, left)
    return gain


def _apply_assignment(
    inst: Instance,
    emp_id: str,
    shift_id: str,
    day: int,
    roster: dict[tuple[str, int], str],
    shortfall: dict[tuple[int, int, str], float],
) -> None:
    roster[(emp_id, day)] = shift_id
    emp = next(e for e in inst.employees if e.id == emp_id)
    shift = next(s for s in inst.shifts if s.id == shift_id)
    skills = set(emp.skills)
    for key in list(shortfall):
        d, period, skill = key
        if d != day or skill not in skills:
            continue
        if shift_covers(shift, period) and shortfall[key] > 0:
            shortfall[key] = max(0.0, shortfall[key] - 1.0)


def _days_worked(emp_id: str, roster: dict[tuple[str, int], str]) -> int:
    return sum(1 for (e, _d) in roster if e == emp_id)


def _mark_supervisor_cover(
    inst: Instance,
    emp_id: str,
    shift_id: str,
    day: int,
    open_set: set[tuple[int, int]],
    sup_covered: set[tuple[int, int]],
) -> None:
    k_star = inst.supervisor_skill
    emp = next(e for e in inst.employees if e.id == emp_id)
    if k_star not in emp.skills:
        return
    sh = next(s for s in inst.shifts if s.id == shift_id)
    for period in range(sh.start_period, sh.end_period):
        if (day, period) in open_set:
            sup_covered.add((day, period))


def _build_roster(
    inst: Instance,
    *,
    rank_key,
) -> dict[tuple[str, int], str]:
    """Fill demand periods greedily. rank_key(emp, hours, days) → sort key (asc)."""
    incompat = _incompatible_shift_ids(inst)
    shortfall: dict[tuple[int, int, str], float] = {
        (d.day, d.period, d.skill): float(d.required)
        for d in inst.demand
        if d.required > 0
    }
    roster: dict[tuple[str, int], str] = {}
    emp_by_id = {e.id: e for e in inst.employees}
    k_star = inst.supervisor_skill
    open_set = open_periods(inst)
    sup_covered: set[tuple[int, int]] = set()
    shifts_covering: dict[int, list[str]] = defaultdict(list)
    for s in inst.shifts:
        for p in range(s.start_period, s.end_period):
            shifts_covering[p].append(s.id)

    # Day-major order. Combined with days-worked in rank_key, staff who
    # sat out day d are preferred on day d+1 — spreads the C5 budget.
    demand_order = sorted(
        shortfall.keys(), key=lambda k: (k[0], k[1], k[2])
    )
    for day, period, skill in demand_order:
        while shortfall[(day, period, skill)] > 0.5:
            hours = _hours_map(inst, roster)
            needs_sup = (day, period) in open_set and (day, period) not in sup_covered
            candidates: list[tuple[str, str]] = []
            for e in inst.employees:
                if skill not in e.skills:
                    continue
                for s_id in shifts_covering.get(period, []):
                    if _can_assign(inst, e.id, s_id, day, roster, incompat):
                        candidates.append((e.id, s_id))
            if not candidates:
                break

            def sort_key(pair: tuple[str, str]) -> tuple:
                e_id, s_id = pair
                emp = emp_by_id[e_id]
                gain = _coverage_gain(inst, e_id, s_id, day, shortfall)
                is_sup = k_star in emp.skills
                # C6 soft: supervisor rank must beat wage, or mornings stay
                # unsupervised while cheaper non-keyholders take open.
                sup_rank = 0 if (needs_sup and is_sup) else 1
                return (
                    sup_rank,
                    rank_key(emp, hours[e_id], _days_worked(e_id, roster)),
                    -gain,
                    e_id,
                    s_id,
                )

            e_id, s_id = min(candidates, key=sort_key)
            _apply_assignment(inst, e_id, s_id, day, roster, shortfall)
            _mark_supervisor_cover(
                inst, e_id, s_id, day, open_set, sup_covered
            )

    # Second pass: close remaining supervisor gaps if a hard-feasible
    # supervisor assignment exists (still soft — may leave gaps).
    for day, period in sorted(open_set):
        if (day, period) in sup_covered:
            continue
        hours = _hours_map(inst, roster)
        candidates = []
        for e in inst.employees:
            if k_star not in e.skills:
                continue
            for s_id in shifts_covering.get(period, []):
                if _can_assign(inst, e.id, s_id, day, roster, incompat):
                    candidates.append((e.id, s_id))
        if not candidates:
            continue
        e_id, s_id = min(
            candidates,
            key=lambda pair: (
                rank_key(
                    emp_by_id[pair[0]],
                    hours[pair[0]],
                    _days_worked(pair[0], roster),
                ),
                pair[0],
                pair[1],
            ),
        )
        roster[(e_id, day)] = s_id
        _mark_supervisor_cover(
            inst, e_id, s_id, day, open_set, sup_covered
        )

    return roster


def solution_from_roster(
    inst: Instance,
    roster: dict[tuple[str, int], str],
    *,
    solver: str,
    solve_time_s: float,
    fairness: FairnessMode = FairnessMode.MINMAX_HOURS,
) -> Solution:
    """Build a Solution from a feasible (employee, day) → shift map."""
    shift_by_id = {s.id: s for s in inst.shifts}
    weekend = set(inst.rules.weekend_days)
    closing_ids = {s.id for s in inst.shifts if s.closing}
    pref_map = {
        (e.id, p.shift, p.day): p.penalty
        for e in inst.employees
        for p in e.preferences
    }
    k_star = inst.supervisor_skill
    w = inst.weights

    assignments = [
        Assignment(employee=e_id, day=day, shift=s_id)
        for (e_id, day), s_id in sorted(roster.items())
    ]

    # Hours / OT / per-employee stats.
    hours_list: list[float] = []
    weekend_counts: list[int] = []
    closing_counts: list[int] = []
    per_employee: list[PerEmployeeStats] = []
    wages = 0.0
    overtime = 0.0
    min_hours_penalty = 0.0
    preference = 0.0

    for e in inst.employees:
        worked = [a for a in assignments if a.employee == e.id]
        hours = sum(shift_by_id[a.shift].paid_hours for a in worked)
        hours_list.append(hours)
        ot = max(0.0, hours - e.max_hours)
        ot = min(ot, float(e.max_overtime))
        w_n = sum(1 for a in worked if a.day in weekend)
        c_n = sum(1 for a in worked if a.shift in closing_ids)
        weekend_counts.append(w_n)
        closing_counts.append(c_n)
        pref_pen = sum(pref_map.get((e.id, a.shift, a.day), 0.0) for a in worked)
        base_cost = regular_cost(inst, e, hours)
        cost = base_cost + e.ot_wage * ot
        wages += base_cost
        overtime += e.ot_wage * ot
        u_min = max(0.0, e.min_hours - hours)
        min_hours_penalty += w.min_hours * u_min
        preference += w.preference * pref_pen
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

    # C1 shortfalls from roster (same semantics as u variables).
    covered: dict[tuple[int, int, str], float] = defaultdict(float)
    for a in assignments:
        emp = next(e for e in inst.employees if e.id == a.employee)
        sh = shift_by_id[a.shift]
        for dem in inst.demand:
            if dem.day != a.day or dem.required <= 0:
                continue
            if dem.skill in emp.skills and shift_covers(sh, dem.period):
                covered[(dem.day, dem.period, dem.skill)] += 1.0

    uncovered: list[UncoveredEntry] = []
    shortfall_person_periods = 0.0
    understaffing = 0.0
    for dem in inst.demand:
        if dem.required <= 0:
            continue
        got = covered.get((dem.day, dem.period, dem.skill), 0.0)
        short = max(0.0, dem.required - got)
        if short > 0.5:
            s_int = int(round(short))
            uncovered.append(
                UncoveredEntry(
                    day=dem.day,
                    period=dem.period,
                    skill=dem.skill,
                    shortfall=s_int,
                )
            )
            shortfall_person_periods += short
            understaffing += w.understaffing * dem.criticality * short

    uncovered_entry_count = len(uncovered)

    # C6 supervisor gaps.
    supervisors = {e.id for e in inst.employees if k_star in e.skills}
    sup_cover: dict[tuple[int, int], float] = defaultdict(float)
    for a in assignments:
        if a.employee not in supervisors:
            continue
        sh = shift_by_id[a.shift]
        for day, period in open_periods(inst):
            if day == a.day and shift_covers(sh, period):
                sup_cover[(day, period)] += 1.0

    supervisor_gap = 0
    for day, period in sorted(open_periods(inst)):
        if sup_cover.get((day, period), 0.0) < 0.5:
            supervisor_gap += 1
            uncovered.append(
                UncoveredEntry(
                    day=day, period=period, skill=k_star, shortfall=1
                )
            )
    supervisor_penalty = w.supervisor * supervisor_gap

    mean_h = sum(hours_list) / len(hours_list) if hours_list else 0.0
    max_dev = max((abs(h - mean_h) for h in hours_list), default=0.0)
    w_spread = (max(weekend_counts) - min(weekend_counts)) if weekend_counts else 0
    c_spread = (max(closing_counts) - min(closing_counts)) if closing_counts else 0

    if fairness == FairnessMode.EQUITY_UNDESIRABLE:
        unfairness = w.fairness * (max_dev + w_spread + c_spread)
    else:
        unfairness = w.fairness * max_dev

    total = (
        wages
        + overtime
        + understaffing
        + supervisor_penalty
        + min_hours_penalty
        + unfairness
        + preference
    )

    return Solution(
        status=SolutionStatus.FEASIBLE,
        mip_gap=0.0,
        solve_time_s=solve_time_s,
        solver=solver,
        assignments=assignments,
        objective=ObjectiveBreakdown(
            total=total,
            wages=wages,
            overtime=overtime,
            understaffing=understaffing,
            supervisor_penalty=supervisor_penalty,
            supervisor_gap=supervisor_gap,
            min_hours_penalty=min_hours_penalty,
            unfairness=unfairness,
            preference=preference,
        ),
        per_employee=per_employee,
        fairness=FairnessReport(
            mode=fairness,
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


def assert_hard_constraints(
    inst: Instance, roster: dict[tuple[str, int], str]
) -> None:
    """Raise AssertionError if C2/C3-upper/C4/C5 are violated."""
    incompat = _incompatible_shift_ids(inst)
    # C2 — at most one shift per day is implicit in roster dict keys.
    for e in inst.employees:
        hours = 0.0
        for d in range(inst.horizon_days):
            s_id = roster.get((e.id, d))
            if s_id is None:
                continue
            if not is_feasible_triple(inst, e.id, s_id, d):
                raise AssertionError(
                    f"availability/skill violation: {e.id} {s_id} day {d}"
                )
            hours += next(s.paid_hours for s in inst.shifts if s.id == s_id)
            if d > 0:
                prev = roster.get((e.id, d - 1))
                if prev is not None and (prev, s_id) in incompat:
                    raise AssertionError(
                        f"C4 rest: {e.id} {prev}→{s_id} around day {d}"
                    )
        if hours > e.max_hours + e.max_overtime + 1e-9:
            raise AssertionError(
                f"C3 hours cap: {e.id} has {hours}h > "
                f"{e.max_hours}+{e.max_overtime}"
            )
        c = e.max_consecutive_days
        working = {d for d in range(inst.horizon_days) if (e.id, d) in roster}
        for start in range(0, inst.horizon_days - c):
            n = sum(1 for d in range(start, start + c + 1) if d in working)
            if n > c:
                raise AssertionError(
                    f"C5 consecutive: {e.id} window starting {start} has {n}"
                )


def greedy(inst: Instance) -> Solution:
    """Fill each unmet period with the cheapest feasible employee.

    Rank is (days_worked, marginal regular cost): among the least-loaded
    staff, pick the cheapest (zero regular marginal cost in salary mode).
    Pure wage-first burns C5 consecutive-day budget early and
    leaves later days uncoverable, which would make the MILP comparison
    dishonest. Hard constraints stay identical to the MILP.
    """
    t0 = time.perf_counter()
    roster = _build_roster(
        inst,
        rank_key=lambda emp, _hours, days: (
            days, emp.wage if inst.pay_basis == "hourly" else 0, emp.id
        ),
    )
    assert_hard_constraints(inst, roster)
    return solution_from_roster(
        inst,
        roster,
        solver="greedy",
        solve_time_s=time.perf_counter() - t0,
    )


def round_robin(inst: Instance) -> Solution:
    """Fewest hours so far; ignore wage. Equalizes load, not cost."""
    t0 = time.perf_counter()
    roster = _build_roster(
        inst,
        rank_key=lambda emp, hours, days: (hours, days, emp.id),
    )
    assert_hard_constraints(inst, roster)
    return solution_from_roster(
        inst,
        roster,
        solver="round_robin",
        solve_time_s=time.perf_counter() - t0,
    )
