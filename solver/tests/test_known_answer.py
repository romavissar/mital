"""Known-answer test: 4 employees, 2 days — hand-verified."""

from __future__ import annotations

import pytest

from mital_solver.model.solve import solve
from mital_solver.schemas import (
    AvailabilityEntry,
    DemandEntry,
    Employee,
    FairnessMode,
    Instance,
    Rules,
    Shift,
    SolutionStatus,
    Weights,
)
from mital_solver.tests.checkers import (
    check_c1_coverage,
    check_c6_supervisor,
)


def _hand_instance() -> Instance:
    """Tiny café: open 08:00–16:00 (periods 32–64), 7.5h paid.

    Coverage needs 2 baristas each open period; C6 needs a keyholder.
    Optimal: Ana (barista+keyholder) + Ben (cheapest barista) both days.
    Cara unused (more expensive); Diego unused (no barista skill).

    wages = 14*15 + 12*15 = 390
    z = max|h − 7.5| = 7.5 → unfairness = 750
    total = 1140
    """
    shifts = [
        Shift(
            id="day",
            label="Day",
            start_period=32,
            end_period=64,
            paid_hours=7.5,
            undesirable=False,
            closing=False,
        )
    ]
    employees = [
        Employee(
            id="ana",
            name="Ana",
            wage=14.0,
            ot_wage=21.0,
            skills=["barista", "keyholder"],
            min_hours=0,
            max_hours=40,
            max_overtime=8,
            max_consecutive_days=5,
            availability=[
                AvailabilityEntry(day=0, shifts=["day"]),
                AvailabilityEntry(day=1, shifts=["day"]),
            ],
        ),
        Employee(
            id="ben",
            name="Ben",
            wage=12.0,
            ot_wage=18.0,
            skills=["barista"],
            min_hours=0,
            max_hours=40,
            max_overtime=8,
            max_consecutive_days=5,
            availability=[
                AvailabilityEntry(day=0, shifts=["day"]),
                AvailabilityEntry(day=1, shifts=["day"]),
            ],
        ),
        Employee(
            id="cara",
            name="Cara",
            wage=16.0,
            ot_wage=24.0,
            skills=["barista"],
            min_hours=0,
            max_hours=40,
            max_overtime=8,
            max_consecutive_days=5,
            availability=[
                AvailabilityEntry(day=0, shifts=["day"]),
                AvailabilityEntry(day=1, shifts=["day"]),
            ],
        ),
        Employee(
            id="diego",
            name="Diego",
            wage=11.0,
            ot_wage=16.5,
            skills=["kitchen"],
            min_hours=0,
            max_hours=40,
            max_overtime=8,
            max_consecutive_days=5,
            availability=[
                AvailabilityEntry(day=0, shifts=["day"]),
                AvailabilityEntry(day=1, shifts=["day"]),
            ],
        ),
    ]
    demand: list[DemandEntry] = []
    for day in (0, 1):
        for period in range(32, 64):
            demand.append(
                DemandEntry(
                    day=day, period=period, skill="barista", required=2
                )
            )

    return Instance(
        id="hand_4x2",
        horizon_days=2,
        start_date="2026-08-03",
        currency="EUR",
        skills=["barista", "keyholder", "kitchen"],
        supervisor_skill="keyholder",
        shifts=shifts,
        employees=employees,
        demand=demand,
        rules=Rules(min_rest_hours=11, weekend_days=[]),
        weights=Weights(),
    )


def test_hand_4x2_known_answer() -> None:
    inst = _hand_instance()
    sol = solve(
        inst,
        fairness=FairnessMode.MINMAX_HOURS,
        time_limit_s=5.0,
        mip_gap=0.0,
    )
    assert sol.status == SolutionStatus.OPTIMAL
    check_c1_coverage(inst, sol)
    check_c6_supervisor(inst, sol)

    assigned = {(a.employee, a.day, a.shift) for a in sol.assignments}
    assert ("ana", 0, "day") in assigned
    assert ("ana", 1, "day") in assigned
    assert ("ben", 0, "day") in assigned
    assert ("ben", 1, "day") in assigned
    assert not any(a.employee == "diego" for a in sol.assignments)
    assert not any(a.employee == "cara" for a in sol.assignments)

    assert sol.uncovered_entry_count == 0
    assert sol.objective.supervisor_gap == 0
    assert sol.objective.wages == pytest.approx(390.0)
    assert sol.objective.overtime == pytest.approx(0.0)
    assert sol.objective.understaffing == pytest.approx(0.0)
    assert sol.objective.unfairness == pytest.approx(750.0)
    assert sol.objective.total == pytest.approx(1140.0)
    assert sol.fairness.max_deviation_hours == pytest.approx(7.5)
