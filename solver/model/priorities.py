"""Keep staffing and contracted hours ahead of cost preferences."""

import pulp

from mital_solver.model.base import ModelVars


def lock_staffing_priorities(mv: ModelVars, solver: pulp.LpSolver) -> None:
    """Find the smallest possible shift and contracted-hour shortfalls.

    Shortfalls remain soft when availability or a shift cap makes zero impossible.
    """
    original = mv.prob.objective
    for name, variables in (("staffing", mv.u_shift), ("supervision", mv.u_sup), ("contract", mv.u_min)):
        if not variables:
            continue
        shortfall = pulp.lpSum(variables.values())
        mv.prob.setObjective(shortfall)
        if mv.prob.solve(solver) != pulp.LpStatusOptimal:
            break
        best = pulp.value(shortfall)
        mv.prob += shortfall <= best + 1e-5, f"best_{name}_shortfall"
    mv.prob.setObjective(original)
