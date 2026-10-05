"""Exact marginal-cost probe for a coverage row.

Used by the gutter click path (UI wiring deferred to S9): bump one demand
RHS by +1, re-solve the MILP, return the true objective delta.
"""

from __future__ import annotations

from dataclasses import dataclass

from mital_solver.schemas import FairnessMode, Instance, Solution


@dataclass
class PerturbationResult:
    day: int
    period: int
    skill: str
    base_objective: float
    new_objective: float
    delta: float
    base_status: str
    new_status: str
    solve_time_s: float


def perturb_coverage(
    inst: Instance,
    *,
    day: int,
    period: int,
    skill: str,
    base: Solution | None = None,
    fairness: FairnessMode = FairnessMode.MINMAX_HOURS,
    time_limit_s: float = 5.0,
) -> PerturbationResult:
    """Re-solve after increasing demand[day, period, skill].required by 1.

    If `base` is omitted, solves the unperturbed instance first.
    """
    from mital_solver.model.solve import solve  # lazy: avoid analysis↔model cycle

    if base is None:
        base = solve(inst, fairness=fairness, time_limit_s=time_limit_s)

    bumped = inst.model_copy(deep=True)
    hit = False
    for dem in bumped.demand:
        if dem.day == day and dem.period == period and dem.skill == skill:
            dem.required += 1
            hit = True
            break
    if not hit:
        raise ValueError(
            f"no demand row for day={day} period={period} skill={skill!r}"
        )

    new = solve(
        bumped,
        fairness=fairness,
        time_limit_s=time_limit_s,
        warm_start=base,
    )
    return PerturbationResult(
        day=day,
        period=period,
        skill=skill,
        base_objective=base.objective.total,
        new_objective=new.objective.total,
        delta=new.objective.total - base.objective.total,
        base_status=base.status.value,
        new_status=new.status.value,
        solve_time_s=new.solve_time_s,
    )
