"""Minimal-disruption re-optimization. docs/model.md §9."""

from __future__ import annotations

import time

import pulp

from mital_solver.model.base import build_variables
from mital_solver.model.constraints import add_all_constraints
from mital_solver.model.objectives import build_objective
from mital_solver.model.priorities import lock_staffing_priorities
from mital_solver.model.solve import _apply_warm_start, extract_solution
from mital_solver.schemas import FairnessMode, Instance, Solution, SolutionStatus


def repair(
    inst: Instance,
    published: Solution,
    *,
    fairness: FairnessMode = FairnessMode.MINMAX_HOURS,
    time_limit_s: float = 5.0,
    mip_gap: float = 0.01,
    msg: bool = False,
) -> Solution:
    """Re-optimize after a disruption, penalizing changes from `published`.

    Objective: COST + UNDERSTAFFING + λ_s Σ(δ⁺ + δ⁻). docs/model.md §9.
    """
    if fairness == FairnessMode.LEXIMIN:
        raise ValueError(
            "LEXIMIN is batch-only and out of scope for the 3-day build"
        )

    equity = fairness == FairnessMode.EQUITY_UNDESIRABLE
    mv = build_variables(inst, name="mital_repair")
    add_all_constraints(mv, inst, equity_undesirable=equity)

    published_set = {
        (a.employee, a.shift, a.day) for a in published.assignments
    }
    lam_s = inst.weights.stability
    deltas: list[pulp.LpVariable] = []

    for (e_id, s_id, d), var in mv.x.items():
        hat = 1.0 if (e_id, s_id, d) in published_set else 0.0
        d_plus = pulp.LpVariable(
            f"dp_{e_id}_{s_id}_{d}", lowBound=0.0, upBound=1.0, cat=pulp.LpContinuous
        )
        d_minus = pulp.LpVariable(
            f"dm_{e_id}_{s_id}_{d}", lowBound=0.0, upBound=1.0, cat=pulp.LpContinuous
        )
        mv.prob += var - hat == d_plus - d_minus, f"stab_{e_id}_{s_id}_{d}"
        deltas.extend([d_plus, d_minus])

    stability = lam_s * pulp.lpSum(deltas)
    terms = build_objective(
        mv,
        inst,
        equity_undesirable=equity,
        mode="repair",
        stability_term=stability,
    )

    _apply_warm_start(mv, published)

    solver = pulp.HiGHS(msg=msg, timeLimit=time_limit_s, gapRel=mip_gap)
    t0 = time.perf_counter()
    lock_staffing_priorities(mv, solver)
    status_code = mv.prob.solve(solver)
    elapsed = time.perf_counter() - t0

    pulp_status = pulp.LpStatus[status_code]
    from mital_solver.model.solve import _highs_status_and_gap

    status, gap = _highs_status_and_gap(
        mv.prob.solverModel,
        pulp_status=pulp_status,
        has_incumbent=pulp.value(mv.prob.objective) is not None,
        elapsed=elapsed,
        time_limit_s=time_limit_s,
    )

    return extract_solution(
        mv,
        inst,
        terms,
        status=status,
        mip_gap=gap,
        solve_time_s=elapsed,
        fairness_mode=fairness,
    )


def changed_assignments(before: Solution, after: Solution) -> int:
    """Count (employee, day, shift) triples that differ between two rosters."""
    a = {(x.employee, x.day, x.shift) for x in before.assignments}
    b = {(x.employee, x.day, x.shift) for x in after.assignments}
    return len(a.symmetric_difference(b))
