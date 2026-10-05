"""Supervisor pairing and configurable shift headcount."""

from __future__ import annotations

from pydantic import ValidationError
import pytest

from mital_solver.model.solve import solve
from mital_solver.model.repair import repair
from mital_solver.model.pareto import pareto_frontier, _shift_shortfall
from mital_solver.schemas import Instance, Pin


def roster(*, minimum: int = 1, maximum: int | None = None, available: tuple[str, ...] = ("worker", "supervisor", "extra")) -> Instance:
    return Instance.model_validate({
        "id": "staffing", "horizon_days": 1, "start_date": "2026-10-05",
        "skills": ["Employee", "Supervisor"], "supervisor_skill": "Supervisor",
        "shifts": [{"id": "day", "label": "Day", "start_period": 36, "end_period": 68, "paid_hours": 8}],
        "employees": [{
            "id": name, "name": name, "wage": 12 if name == "extra" else 10, "ot_wage": 20,
            "skills": ["Supervisor"] if name == "supervisor" else ["Employee"],
            "min_hours": 0, "max_hours": 8, "max_overtime": 0,
            "max_consecutive_days": 7,
            "availability": [{"day": 0, "shifts": ["day"]}] if name in available else [],
        } for name in ("worker", "supervisor", "extra")],
        "demand": [{"day": 0, "period": 40, "skill": skill, "required": 1} for skill in ("Employee", "Supervisor")],
        "rules": {"weekend_days": [], "min_people_per_shift": minimum, "max_people_per_shift": maximum},
    })


def test_one_person_shift_uses_worker_without_supervisor() -> None:
    sol = solve(roster(maximum=1, available=("worker", "supervisor")), time_limit_s=3)
    assert {a.employee for a in sol.assignments} == {"worker"}
    assert sol.objective.supervisor_gap == 0
    assert sol.uncovered_entry_count == 0


def test_supervisor_cannot_work_alone() -> None:
    sol = solve(roster(available=("supervisor",)), time_limit_s=3)
    assert not sol.assignments
    assert sol.objective.supervisor_gap == 0


def test_manager_can_make_supervision_optional() -> None:
    raw = roster(available=("worker",)).model_dump()
    raw["rules"]["supervision_required"] = True
    required = solve(Instance.model_validate(raw), time_limit_s=3)
    assert required.objective.supervisor_gap == 1
    raw["rules"]["supervision_required"] = False
    optional = solve(Instance.model_validate(raw), time_limit_s=3)
    assert {a.employee for a in optional.assignments} == {"worker"}
    assert optional.objective.supervisor_gap == 0


def test_required_pins_are_enforced() -> None:
    inst = roster()
    sol = solve(inst, pins=[Pin(employee="extra", day=0, shift="day", value=1)], time_limit_s=3)
    assert "extra" in {a.employee for a in sol.assignments}


def test_three_person_minimum_and_two_person_cap() -> None:
    three = solve(roster(minimum=3), time_limit_s=3)
    assert len(three.assignments) == 3
    two = solve(roster(minimum=2, maximum=2), time_limit_s=3)
    assert len(two.assignments) == 2
    short = solve(roster(minimum=3, available=("worker", "supervisor")), time_limit_s=3)
    assert len(short.assignments) == 2
    assert short.objective.understaffing > three.objective.understaffing


def test_contracted_minimum_takes_priority_over_cheaper_optional_worker() -> None:
    raw = roster(maximum=1, available=("worker", "extra")).model_dump()
    raw["employees"][0].update(min_hours=8, wage=1000, ot_wage=1500)
    raw["employees"][2].update(min_hours=0, wage=10, ot_wage=20)
    sol = solve(Instance.model_validate(raw), time_limit_s=3)
    assert [(a.employee, a.shift) for a in sol.assignments] == [("worker", "day")]


def test_shift_cap_reports_unavoidable_minimum_shortfall() -> None:
    raw = roster(maximum=1, available=("worker", "extra")).model_dump()
    raw["employees"][0]["min_hours"] = 8
    raw["employees"][2]["min_hours"] = 8
    sol = solve(Instance.model_validate(raw), time_limit_s=3)
    assert len(sol.assignments) == 1
    assert sum(max(0, e["min_hours"] - next(p.hours for p in sol.per_employee if p.employee == e["id"])) for e in raw["employees"]) == 8


def test_expensive_staff_still_fill_shift_minimum() -> None:
    raw = roster(minimum=3, maximum=3).model_dump()
    raw["employees"][2].update(wage=1000, ot_wage=1500)
    sol = solve(Instance.model_validate(raw), time_limit_s=3)
    assert {a.employee for a in sol.assignments} == {"worker", "supervisor", "extra"}


def test_invalid_bounds_rejected() -> None:
    raw = roster().model_dump()
    raw["rules"]["min_people_per_shift"] = 3
    raw["rules"]["max_people_per_shift"] = 2
    with pytest.raises(ValidationError, match="minimum people per shift exceeds maximum"):
        Instance.model_validate(raw)
    raw = roster(maximum=1).model_dump()
    raw["rules"]["supervision_required"] = True
    with pytest.raises(ValidationError, match="mandatory supervision needs"):
        Instance.model_validate(raw)


def test_sick_day_repair_reassigns_the_shift() -> None:
    inst = roster()
    before = solve(inst, time_limit_s=3)
    assert "worker" in {a.employee for a in before.assignments}
    raw = inst.model_dump()
    raw["employees"][0]["absences"] = [{"day": 0, "reason": "sick"}]
    after = repair(Instance.model_validate(raw), before, time_limit_s=3)
    assigned = {a.employee for a in after.assignments}
    assert "worker" not in assigned
    assert "extra" in assigned


def test_sick_night_shift_gets_cover_after_manager_confirms_availability() -> None:
    raw = roster(maximum=2).model_dump()
    raw["shifts"].append({"id": "night", "label": "Night", "start_period": 68, "end_period": 92, "paid_hours": 6})
    raw["employees"][0]["availability"][0]["shifts"] = ["night"]
    raw["employees"][1]["availability"][0]["shifts"] = ["day"]
    raw["employees"][2]["availability"][0]["shifts"] = ["day"]
    raw["employees"].append({**raw["employees"][2], "id": "cover", "name": "cover", "availability": []})
    raw["demand"].append({"day": 0, "period": 72, "skill": "Employee", "required": 1})
    before = solve(Instance.model_validate(raw), time_limit_s=3)
    assert any(a.employee == "worker" and a.shift == "night" for a in before.assignments)

    raw["employees"][0]["absences"] = [{"day": 0, "reason": "sick"}]
    missing = repair(Instance.model_validate(raw), before, time_limit_s=3)
    assert not any(a.shift == "night" for a in missing.assignments)

    raw["employees"][3]["availability"] = [{"day": 0, "shifts": ["night"]}]
    covered = repair(Instance.model_validate(raw), missing, time_limit_s=3)
    assert any(a.employee == "cover" and a.shift == "night" for a in covered.assignments)
    assert not any(a.employee == "worker" for a in covered.assignments)


def test_when_one_shift_must_stay_empty_solver_covers_more_open_periods() -> None:
    raw = roster(available=("worker",)).model_dump()
    raw["shifts"].append({"id": "night", "label": "Night", "start_period": 68, "end_period": 92, "paid_hours": 6})
    raw["employees"][0]["availability"][0]["shifts"].append("night")
    raw["demand"].append({"day": 0, "period": 72, "skill": "Employee", "required": 1})
    raw["rules"]["supervision_required"] = False
    sol = solve(Instance.model_validate(raw), time_limit_s=3)
    assert [(a.employee, a.shift) for a in sol.assignments] == [("worker", "day")]


def test_fairness_options_keep_best_attainable_shift_coverage() -> None:
    inst = roster(minimum=3, available=("worker", "supervisor"))
    points = pareto_frontier(inst, n_points=4, time_limit_s=1)
    assert points
    assert {_shift_shortfall(inst, point.solution) for point in points} == {1}
    metrics = [(p.cost, p.fairness, p.solution.shortfall_person_periods, p.solution.objective.supervisor_gap) for p in points]
    assert all(not (all(a <= b for a, b in zip(other, current)) and other != current)
                   for i, current in enumerate(metrics) for j, other in enumerate(metrics) if i != j)
