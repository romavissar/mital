"""Monthly salary is fixed across the roster; overtime stays incremental."""

from __future__ import annotations

import pytest
from pydantic import ValidationError
from mital_solver.cache_keys import instance_sha256
from mital_solver.model.solve import solve
from mital_solver.schemas import Instance


def salary_instance() -> Instance:
    return Instance.model_validate({
        "id": "salary_cross_month",
        "horizon_days": 2,
        "start_date": "2026-10-31",
        "currency": "RON",
        "pay_basis": "monthly_salary",
        "skills": ["staff"],
        "supervisor_skill": "staff",
        "shifts": [{
            "id": "day", "label": "Day", "start_period": 32,
            "end_period": 64, "paid_hours": 7.5,
        }],
        "employees": [
            {
                "id": "ana", "name": "Ana", "wage": 10, "ot_wage": 30,
                "monthly_salary": 3100, "skills": ["staff"],
                "min_hours": 0, "max_hours": 7.5, "max_overtime": 8,
                "max_consecutive_days": 5,
                "availability": [
                    {"day": 0, "shifts": ["day"]},
                    {"day": 1, "shifts": ["day"]},
                ],
            },
            {
                "id": "ben", "name": "Ben", "wage": 10, "ot_wage": 30,
                "monthly_salary": 3000, "skills": ["staff"],
                "min_hours": 0, "max_hours": 7.5, "max_overtime": 8,
                "max_consecutive_days": 5, "availability": [],
            },
        ],
        "demand": [
            {"day": day, "period": period, "skill": "staff", "required": 1}
            for day in range(2) for period in range(32, 64)
        ],
        "rules": {"min_rest_hours": 12, "weekend_days": []},
    })


def test_salary_cost_is_fixed_and_overtime_is_incremental() -> None:
    inst = salary_instance()
    sol = solve(inst, time_limit_s=5, mip_gap=0)
    base_ana = 3100 / 31 + 3100 / 30
    base_ben = 3000 / 31 + 3000 / 30
    assert sol.uncovered_entry_count == 0
    assert sol.objective.wages == pytest.approx(base_ana + base_ben)
    assert sol.objective.overtime == pytest.approx(7.5 * 30)
    stats = {item.employee: item for item in sol.per_employee}
    assert stats["ana"].cost == pytest.approx(base_ana + 7.5 * 30)
    assert stats["ben"].hours == 0
    assert stats["ben"].cost == pytest.approx(base_ben)


def test_salary_mode_requires_real_salary_and_date() -> None:
    raw = salary_instance().model_dump()
    raw["employees"][0]["monthly_salary"] = None
    with pytest.raises(ValidationError, match="monthly_salary is required"):
        Instance.model_validate(raw)
    raw["employees"][0]["monthly_salary"] = 3100
    raw["start_date"] = "2026-02-30"
    with pytest.raises(ValidationError, match="valid start_date"):
        Instance.model_validate(raw)


def test_hourly_mode_keeps_overtime_rate_invariant() -> None:
    raw = salary_instance().model_dump()
    raw["pay_basis"] = "hourly"
    raw["employees"][0]["ot_wage"] = 5
    with pytest.raises(ValidationError, match="ot_wage"):
        Instance.model_validate(raw)


def test_cache_key_changes_when_staffing_changes() -> None:
    instance = salary_instance()
    changed = instance.model_copy(deep=True)
    changed.rules.min_people_per_shift = 2
    assert instance_sha256(instance) != instance_sha256(changed)
