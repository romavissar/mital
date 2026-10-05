"""Necessary-condition diagnostics for benchmark instances.

These are filters on the generator, not on the MILP. Failures here mean the
instance has permanently uncoverable demand (or unsatisfiable contracts)
before the solver even runs.
"""

from __future__ import annotations

import argparse
from dataclasses import dataclass, field
from pathlib import Path

from mital_solver.bench.generate import demand_person_hours
from mital_solver.schemas import Employee, Instance, Shift


def _shift_covers(shift: Shift, period: int) -> bool:
    return shift.start_period <= period < shift.end_period


def _avail_map(emp: Employee) -> dict[int, set[str]]:
    return {a.day: set(a.shifts) for a in emp.availability}


def _qualified_available(
    inst: Instance,
    day: int,
    period: int,
    skill: str,
) -> list[str]:
    """Employees with `skill` available for some shift covering `period` on `day`."""
    shift_by_id = {s.id: s for s in inst.shifts}
    out: list[str] = []
    for e in inst.employees:
        if skill not in e.skills:
            continue
        offered = _avail_map(e).get(day, set())
        for sid in offered:
            sh = shift_by_id.get(sid)
            if sh is not None and _shift_covers(sh, period):
                out.append(e.id)
                break
    return out


def _open_periods(inst: Instance) -> set[tuple[int, int]]:
    """(day, period) with any positive demand across skills."""
    open_: set[tuple[int, int]] = set()
    for d in inst.demand:
        if d.required > 0:
            open_.add((d.day, d.period))
    return open_


def _max_hours_from_availability(inst: Instance, emp: Employee) -> float:
    """Max assignable hours under one-shift-per-day given availability."""
    shift_hours = {s.id: s.paid_hours for s in inst.shifts}
    total = 0.0
    for av in emp.availability:
        if not av.shifts:
            continue
        total += max(shift_hours[sid] for sid in av.shifts if sid in shift_hours)
    return total


@dataclass
class DiagnosticReport:
    instance_id: str
    # (1) local skill coverage shortfalls
    skill_shortfalls: int = 0
    skill_examples: list[str] = field(default_factory=list)
    # (2) supervisor gaps on open periods
    supervisor_gaps: int = 0
    supervisor_examples: list[str] = field(default_factory=list)
    # (3) contract hour pool vs demand
    sum_max_hours: float = 0.0
    demand_hours: float = 0.0
    # (4) unsatisfiable min_hours
    min_hours_failures: int = 0
    min_hours_examples: list[str] = field(default_factory=list)

    @property
    def check1_ok(self) -> bool:
        return self.skill_shortfalls == 0

    @property
    def check2_ok(self) -> bool:
        return self.supervisor_gaps == 0

    @property
    def check3_ok(self) -> bool:
        return self.sum_max_hours >= self.demand_hours - 1e-9

    @property
    def check4_ok(self) -> bool:
        return self.min_hours_failures == 0

    @property
    def ok(self) -> bool:
        return (
            self.check1_ok
            and self.check2_ok
            and self.check3_ok
            and self.check4_ok
        )


def diagnose(inst: Instance) -> DiagnosticReport:
    report = DiagnosticReport(instance_id=inst.id)
    demand_by_key = {
        (d.day, d.period, d.skill): d.required for d in inst.demand
    }

    # (1) per-(day, period, skill) available qualified headcount
    for (day, period, skill), required in sorted(demand_by_key.items()):
        pool = _qualified_available(inst, day, period, skill)
        if len(pool) < required:
            report.skill_shortfalls += 1
            if len(report.skill_examples) < 3:
                report.skill_examples.append(
                    f"d{day}/p{period}/{skill}: need {required}, have {len(pool)}"
                )

    # (2) supervisor in every open period
    k_star = inst.supervisor_skill
    for day, period in sorted(_open_periods(inst)):
        pool = _qualified_available(inst, day, period, k_star)
        if len(pool) < 1:
            report.supervisor_gaps += 1
            if len(report.supervisor_examples) < 3:
                report.supervisor_examples.append(f"d{day}/p{period}")

    # (3) sum(max_hours) vs demand person-hours
    report.sum_max_hours = sum(e.max_hours for e in inst.employees)
    report.demand_hours = demand_person_hours(inst)

    # (4) min_hours vs availability capacity
    for e in inst.employees:
        if e.min_hours <= 0:
            continue
        reachable = _max_hours_from_availability(inst, e)
        if reachable + 1e-9 < e.min_hours:
            report.min_hours_failures += 1
            if len(report.min_hours_examples) < 3:
                report.min_hours_examples.append(
                    f"{e.id}: min={e.min_hours}, avail≤{reachable}"
                )

    return report


def _fmt_bool(ok: bool) -> str:
    return "PASS" if ok else "FAIL"


def print_table(reports: list[DiagnosticReport]) -> None:
    header = (
        f"{'instance':<12} {'(1) skill':>10} {'(2) superv':>10} "
        f"{'(3) max_h':>10} {'(4) min_h':>10} {'sum_max':>10} "
        f"{'demand_h':>10} {'short':>7} {'sup_gap':>8} {'min_fail':>8}"
    )
    print(header)
    print("-" * len(header))
    for r in reports:
        print(
            f"{r.instance_id:<12} "
            f"{_fmt_bool(r.check1_ok):>10} "
            f"{_fmt_bool(r.check2_ok):>10} "
            f"{_fmt_bool(r.check3_ok):>10} "
            f"{_fmt_bool(r.check4_ok):>10} "
            f"{r.sum_max_hours:>10.1f} "
            f"{r.demand_hours:>10.1f} "
            f"{r.skill_shortfalls:>7d} "
            f"{r.supervisor_gaps:>8d} "
            f"{r.min_hours_failures:>8d}"
        )
    print()
    for r in reports:
        notes: list[str] = []
        if r.skill_examples:
            notes.append("skill: " + "; ".join(r.skill_examples))
        if r.supervisor_examples:
            notes.append("supervisor: " + "; ".join(r.supervisor_examples))
        if r.min_hours_examples:
            notes.append("min_hours: " + "; ".join(r.min_hours_examples))
        if not r.check3_ok:
            notes.append(
                f"max_hours pool {r.sum_max_hours:.1f} < demand {r.demand_hours:.1f}"
            )
        if notes:
            print(f"{r.instance_id}:")
            for n in notes:
                print(f"  - {n}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--dir",
        type=Path,
        default=Path(__file__).resolve().parents[2] / "data" / "instances",
    )
    args = parser.parse_args()

    paths = sorted(args.dir.glob("*.json"))
    if not paths:
        raise SystemExit(f"no instances in {args.dir}")

    reports = [
        diagnose(Instance.model_validate_json(p.read_text())) for p in paths
    ]
    print_table(reports)

    normal = [r for r in reports if r.instance_id != "tight_20"]
    tight = next((r for r in reports if r.instance_id == "tight_20"), None)

    normal_ok = all(r.ok for r in normal)
    if tight is not None:
        print(
            f"tight_20: check1={_fmt_bool(tight.check1_ok)} "
            f"check3={_fmt_bool(tight.check3_ok)} "
            f"(expected FAIL on 1 and 3)"
        )
    if normal_ok:
        print("NORMAL INSTANCES: all necessary conditions PASS")
        raise SystemExit(0)
    print("NORMAL INSTANCES: FAIL — fix the generator before S2")
    raise SystemExit(1)


if __name__ == "__main__":
    main()
