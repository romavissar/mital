"""Regression: committed optimal objectives must not degrade."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from mital_solver.model.solve import load_instance, solve
from mital_solver.schemas import FairnessMode, SolutionStatus

ROOT = Path(__file__).resolve().parents[2]
INSTANCES = ROOT / "data" / "instances"
EXPECTED = INSTANCES / "expected_objectives.json"

# Tolerances: allow tiny numeric noise; never accept a worse objective.
ABS_TOL = 0.05
# Larger instances may need a bit more time to match the committed optimum.
TIME_LIMIT = {
    "cafe_08": 10.0,
    "cafe_18": 15.0,
    "clinic_25": 30.0,
    "retail_40": 30.0,
    "retail_60": 45.0,
    "tight_20": 15.0,
}


def _expected() -> dict[str, float]:
    raw = json.loads(EXPECTED.read_text(encoding="utf-8"))
    return {k: float(v) for k, v in raw.items() if not k.startswith("_")}


@pytest.mark.parametrize("instance_id", sorted(_expected().keys()))
def test_committed_objective_does_not_degrade(instance_id: str) -> None:
    expected = _expected()[instance_id]
    inst = load_instance(INSTANCES / f"{instance_id}.json")
    sol = solve(
        inst,
        fairness=FairnessMode.MINMAX_HOURS,
        time_limit_s=TIME_LIMIT[instance_id],
        mip_gap=0.0,
    )
    assert sol.status != SolutionStatus.INFEASIBLE
    # Must not be worse than committed (higher cost = regression).
    assert sol.objective.total <= expected + ABS_TOL, (
        f"{instance_id}: objective {sol.objective.total:.4f} worse than "
        f"committed {expected:.4f} — investigate; do not edit expected_objectives.json"
    )
