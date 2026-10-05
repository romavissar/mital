"""Property-based constraint tests. docs/model.md §3."""

from __future__ import annotations

import pytest
from hypothesis import HealthCheck, assume, given, settings
from hypothesis import strategies as st

from mital_solver.bench.generate import generate
from mital_solver.model.solve import solve
from mital_solver.schemas import FairnessMode, SolutionStatus
from mital_solver.tests.checkers import (
    check_c1_coverage,
    check_c6_supervisor,
)


@st.composite
def small_instances(draw):
    n = draw(st.integers(min_value=4, max_value=8))
    days = draw(st.integers(min_value=2, max_value=4))
    domain = draw(st.sampled_from(["cafe", "retail", "clinic"]))
    seed = draw(st.integers(min_value=0, max_value=10_000))
    tightness = draw(st.floats(min_value=0.55, max_value=0.85))
    try:
        return generate(
            instance_id=f"hyp_{domain}_{n}_{days}_{seed}",
            n_employees=n,
            n_days=days,
            domain=domain,
            demand_tightness=tightness,
            availability_density=0.75,
            seed=seed,
        )
    except RuntimeError as error:
        if "achieved tightness" not in str(error):
            raise
        assume(False)  # This small pool cannot reach the requested demand target.


@settings(
    max_examples=12,
    deadline=None,
    suppress_health_check=[HealthCheck.too_slow, HealthCheck.data_too_large],
)
@given(inst=small_instances())
def test_coverage_and_supervision_hold(inst) -> None:
    sol = solve(
        inst,
        fairness=FairnessMode.MINMAX_HOURS,
        time_limit_s=8.0,
        mip_gap=0.02,
    )
    assert sol.status != SolutionStatus.INFEASIBLE
    check_c1_coverage(inst, sol)
    check_c6_supervisor(inst, sol)
