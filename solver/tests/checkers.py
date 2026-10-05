"""Independent constraint checkers from docs/model.md §3.

These re-implement the definitions for testing. They must NOT import
mital_solver.model.constraints builders.
"""

from __future__ import annotations

from collections import defaultdict

from mital_solver.schemas import Instance, Solution


def _shift_covers(start: int, end: int, period: int) -> bool:
    return start <= period < end


def _incompatible_pairs(inst: Instance) -> set[tuple[str, str]]:
    """INCOMPAT pairs: end(s)+ρ > start(s')+24. docs/model.md §1, §11.1."""
    rho = inst.rules.min_rest_hours
    out: set[tuple[str, str]] = set()
    for s in inst.shifts:
        end_s = s.end_period / 4.0
        for s2 in inst.shifts:
            start_s2 = s2.start_period / 4.0
            if end_s + rho > start_s2 + 24.0:
                out.add((s.id, s2.id))
    return out


def _roster_map(sol: Solution) -> dict[tuple[str, int], str]:
    """(employee, day) → shift. Also asserts C2 (≤1 shift/day)."""
    roster: dict[tuple[str, int], str] = {}
    for a in sol.assignments:
        key = (a.employee, a.day)
        if key in roster:
            raise AssertionError(
                f"C2 violated: {a.employee} has two shifts on day {a.day}"
            )
        roster[key] = a.shift
    return roster


def check_c1_coverage(inst: Instance, sol: Solution) -> None:
    """C1 — covered + shortfall ≥ required for every demand row."""
    shift_by_id = {s.id: s for s in inst.shifts}
    emp_skills = {e.id: set(e.skills) for e in inst.employees}
    covered: dict[tuple[int, int, str], int] = defaultdict(int)
    for a in sol.assignments:
        sh = shift_by_id[a.shift]
        skills = emp_skills[a.employee]
        for dem in inst.demand:
            if dem.day != a.day or dem.required <= 0:
                continue
            if dem.skill in skills and _shift_covers(
                sh.start_period, sh.end_period, dem.period
            ):
                covered[(dem.day, dem.period, dem.skill)] += 1

    reported = {
        (u.day, u.period, u.skill): u.shortfall
        for u in sol.uncovered
        if u.skill != inst.supervisor_skill
        or any(
            d.skill == u.skill and d.day == u.day and d.period == u.period
            for d in inst.demand
        )
    }
    # Prefer C1-only rows: uncovered_entry_count counts C1 only.
    c1_reported = {
        (u.day, u.period, u.skill): u.shortfall
        for u in sol.uncovered[: sol.uncovered_entry_count]
    }

    for dem in inst.demand:
        if dem.required <= 0:
            continue
        got = covered.get((dem.day, dem.period, dem.skill), 0)
        short = max(0, dem.required - got)
        # Feasibility: covered + shortfall accounts for demand.
        assert got + short >= dem.required
        if short > 0:
            assert (dem.day, dem.period, dem.skill) in c1_reported
            assert c1_reported[(dem.day, dem.period, dem.skill)] == short
        else:
            assert (dem.day, dem.period, dem.skill) not in c1_reported


def check_c4_rest(inst: Instance, sol: Solution) -> None:
    """C4 — no incompatible shift pair on consecutive days."""
    roster = _roster_map(sol)
    incompat = _incompatible_pairs(inst)
    for e in inst.employees:
        for d in range(inst.horizon_days - 1):
            s1 = roster.get((e.id, d))
            s2 = roster.get((e.id, d + 1))
            if s1 is None or s2 is None:
                continue
            assert (s1, s2) not in incompat, (
                f"C4 rest: {e.id} works {s1} then {s2} across day {d}"
            )


def check_c5_consecutive(inst: Instance, sol: Solution) -> None:
    """C5 — sliding window of length C+1 has ≤ C working days."""
    roster = _roster_map(sol)
    for e in inst.employees:
        c = e.max_consecutive_days
        working = {
            d for d in range(inst.horizon_days) if (e.id, d) in roster
        }
        for start in range(0, inst.horizon_days - c):
            n = sum(1 for d in range(start, start + c + 1) if d in working)
            assert n <= c, (
                f"C5 consecutive: {e.id} window starting {start} has {n} > {c}"
            )


def check_c6_supervisor(inst: Instance, sol: Solution) -> None:
    """C6 — every open period has a supervisor or is listed as a gap."""
    k_star = inst.supervisor_skill
    supervisors = {e.id for e in inst.employees if k_star in e.skills}
    shift_by_id = {s.id: s for s in inst.shifts}
    open_periods = {
        (d.day, d.period) for d in inst.demand if d.required > 0
    }
    covered: set[tuple[int, int]] = set()
    for a in sol.assignments:
        if a.employee not in supervisors:
            continue
        sh = shift_by_id[a.shift]
        for day, period in open_periods:
            if day == a.day and _shift_covers(
                sh.start_period, sh.end_period, period
            ):
                covered.add((day, period))

    gap_keys = {
        (u.day, u.period)
        for u in sol.uncovered
        if u.skill == k_star
    }
    for day, period in open_periods:
        if (day, period) in covered:
            continue
        # Must be reported as a supervisor gap (slack used).
        assert (day, period) in gap_keys or sol.objective.supervisor_gap > 0
        # Stronger: count of unsupervised open periods == supervisor_gap.
    unsupervised = sum(
        1 for dp in open_periods if dp not in covered
    )
    assert unsupervised == sol.objective.supervisor_gap, (
        f"C6: unsupervised={unsupervised} "
        f"!= supervisor_gap={sol.objective.supervisor_gap}"
    )
