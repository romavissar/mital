"""The desktop process boundary emits one JSON response without HTTP."""

from __future__ import annotations

import json
import subprocess
import sys

import pytest

from mital_solver.schemas import AvailabilityEntry, DemandEntry, Employee, Instance, Rules, Shift


@pytest.mark.parametrize("pay_basis, expected_regular", [
    ("hourly", 20),
    ("monthly_salary", 3000 / 31),
])
def test_desktop_bridge_solves_through_stdio(pay_basis: str, expected_regular: float) -> None:
    inst = Instance(
        id="bridge_smoke",
        horizon_days=1,
        start_date="2026-10-05",
        currency="RON",
        pay_basis=pay_basis,
        skills=["worker"],
        supervisor_skill="worker",
        shifts=[
            Shift(
                id="day", label="Day", start_period=32, end_period=36,
                paid_hours=1,
            )
        ],
        employees=[
            Employee(
                id="ana", name="Ana", wage=20, ot_wage=30,
                monthly_salary=3000 if pay_basis == "monthly_salary" else None,
                skills=["worker"], min_hours=0, max_hours=8,
                max_overtime=0, max_consecutive_days=5,
                availability=[AvailabilityEntry(day=0, shifts=["day"])],
            )
        ],
        demand=[DemandEntry(day=0, period=32, skill="worker", required=1)],
        rules=Rules(weekend_days=[]),
    )
    request = {
        "op": "solve",
        "payload": {"instance": inst.model_dump(mode="json"), "time_limit_s": 5},
    }
    process = subprocess.run(
        [sys.executable, "-m", "mital_solver.desktop_bridge"],
        input=json.dumps(request), text=True, capture_output=True,
        check=False, timeout=15,
    )
    assert process.returncode == 0, process.stderr
    response = json.loads(process.stdout)
    assert response["ok"] is True
    assert response["result"]["assignments"] == [
        {"employee": "ana", "day": 0, "shift": "day"}
    ]
    assert response["result"]["objective"]["wages"] == pytest.approx(expected_regular)
