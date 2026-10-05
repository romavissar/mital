"""Old saved rule fields must not block a current shift."""

from mital_solver.model.solve import solve
from mital_solver.schemas import Instance


def test_legacy_rest_and_previous_week_do_not_block_monday() -> None:
    instance = Instance.model_validate({
        "id": "legacy", "horizon_days": 2, "start_date": "2026-10-05",
        "skills": ["staff"], "supervisor_skill": "staff",
        "shifts": [
            {"id": "late", "label": "Late", "start_period": 48, "end_period": 80, "paid_hours": 8},
            {"id": "early", "label": "Early", "start_period": 16, "end_period": 48, "paid_hours": 8},
        ],
        "employees": [{
            "id": "ana", "name": "Ana", "wage": 10, "ot_wage": 15,
            "skills": ["staff"], "min_hours": 0, "max_hours": 16,
            "max_overtime": 0, "max_consecutive_days": 1,
            "availability": [{"day": 0, "shifts": ["late"]}, {"day": 1, "shifts": ["early"]}],
        }],
        "demand": [{"day": 0, "period": 48, "skill": "staff", "required": 1},
                   {"day": 1, "period": 16, "skill": "staff", "required": 1}],
        "rules": {"romania_policy": True, "min_rest_hours": 12, "weekend_days": [],
                  "previous_week_known": True, "previous_week_start": "2026-09-28",
                  "previous_work": [{"employee": "ana", "day": -1,
                                     "start_period": 48, "end_period": 80, "paid_hours": 8}]},
    })
    result = solve(instance, time_limit_s=5)
    assert result.uncovered_entry_count == 0
    assert {(a.day, a.shift) for a in result.assignments} == {(0, "late"), (1, "early")}


def test_manager_hour_cap_still_applies() -> None:
    instance = Instance.model_validate({
        "id": "cap", "horizon_days": 2, "start_date": "2026-10-05",
        "skills": ["staff"], "supervisor_skill": "staff",
        "shifts": [{"id": "day", "label": "Day", "start_period": 32, "end_period": 64, "paid_hours": 8}],
        "employees": [{"id": "ana", "name": "Ana", "wage": 10, "ot_wage": 15,
                       "skills": ["staff"], "min_hours": 0, "max_hours": 8,
                       "max_overtime": 0, "max_consecutive_days": 7,
                       "availability": [{"day": 0, "shifts": ["day"]}, {"day": 1, "shifts": ["day"]}]}],
        "demand": [{"day": day, "period": 32, "skill": "staff", "required": 1} for day in (0, 1)],
        "rules": {"weekend_days": []},
    })
    assert len(solve(instance, time_limit_s=5).assignments) == 1
