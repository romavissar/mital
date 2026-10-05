"""Variable construction for the shift-assignment MILP.

docs/model.md §2 — decision variables and the elimination rule.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import pulp

from mital_solver.schemas import Instance, Shift


def shift_covers(shift: Shift, period: int) -> bool:
    """a_{s,t}: shift covers period t (half-open [start, end))."""
    return shift.start_period <= period < shift.end_period


def skills_required_by_shift(inst: Instance, shift: Shift, day: int) -> set[str]:
    """Skills with positive demand during periods covered by `shift` on `day`."""
    needed: set[str] = set()
    for d in inst.demand:
        if d.day != day or d.required <= 0:
            continue
        if shift_covers(shift, d.period):
            needed.add(d.skill)
    return needed


def open_periods(inst: Instance) -> set[tuple[int, int]]:
    """(day, period) with any positive demand — C6 domain."""
    out: set[tuple[int, int]] = set()
    for d in inst.demand:
        if d.required > 0:
            out.add((d.day, d.period))
    return out


def is_feasible_triple(inst: Instance, emp_id: str, shift_id: str, day: int) -> bool:
    """True iff x[e,s,d] should be created (docs/model.md §2 elimination)."""
    emp = next(e for e in inst.employees if e.id == emp_id)
    shift = next(s for s in inst.shifts if s.id == shift_id)

    offered = next((a.shifts for a in emp.availability if a.day == day), [])
    if any(absence.day == day for absence in emp.absences):
        return False
    if shift_id not in offered:
        return False

    needed = skills_required_by_shift(inst, shift, day)
    if needed and needed.isdisjoint(emp.skills):
        return False
    return True


@dataclass
class ModelVars:
    """PulP variables for one instance. docs/model.md §2."""

    prob: pulp.LpProblem
    x: dict[tuple[str, str, int], pulp.LpVariable] = field(default_factory=dict)
    o: dict[str, pulp.LpVariable] = field(default_factory=dict)
    u: dict[tuple[int, str, int], pulp.LpVariable] = field(default_factory=dict)
    u_sup: dict[tuple[int, int], pulp.LpVariable] = field(default_factory=dict)
    u_min: dict[str, pulp.LpVariable] = field(default_factory=dict)
    u_shift: dict[tuple[str, int], pulp.LpVariable] = field(default_factory=dict)
    z: pulp.LpVariable | None = None
    z_w: pulp.LpVariable | None = None
    z_cl: pulp.LpVariable | None = None
    h: dict[str, pulp.LpAffineExpression] = field(default_factory=dict)


def build_variables(inst: Instance, name: str = "mital") -> ModelVars:
    """Create decision variables with §2 elimination.

    Never creates x[e,s,d] when unavailable or unqualified for the shift's
    demanded skills on that day.
    """
    prob = pulp.LpProblem(name, pulp.LpMinimize)
    mv = ModelVars(prob=prob)
    shift_by_id = {s.id: s for s in inst.shifts}

    for e in inst.employees:
        for d in range(inst.horizon_days):
            for s in inst.shifts:
                if not is_feasible_triple(inst, e.id, s.id, d):
                    continue
                mv.x[(e.id, s.id, d)] = pulp.LpVariable(
                    f"x_{e.id}_{s.id}_{d}",
                    cat=pulp.LpBinary,
                )

        mv.o[e.id] = pulp.LpVariable(
            f"o_{e.id}",
            lowBound=0.0,
            upBound=float(e.max_overtime),
            cat=pulp.LpContinuous,
        )
        mv.u_min[e.id] = pulp.LpVariable(
            f"u_min_{e.id}",
            lowBound=0.0,
            cat=pulp.LpContinuous,
        )

        # h_e = Σ ℓ_s x_{e,s,d}  (docs/model.md §2)
        mv.h[e.id] = pulp.lpSum(
            shift_by_id[s_id].paid_hours * var
            for (e_id, s_id, _d), var in mv.x.items()
            if e_id == e.id
        )

    for dem in inst.demand:
        if dem.required <= 0:
            continue
        if inst.rules.modern_staffing and dem.skill == inst.supervisor_skill and any(inst.supervisor_skill not in e.skills for e in inst.employees):
            continue
        key = (dem.period, dem.skill, dem.day)
        if key not in mv.u:
            mv.u[key] = pulp.LpVariable(
                f"u_{dem.day}_{dem.period}_{dem.skill}",
                lowBound=0.0,
                cat=pulp.LpContinuous,
            )

    for day, period in open_periods(inst):
        mv.u_sup[(day, period)] = pulp.LpVariable(
            f"u_sup_{day}_{period}",
            lowBound=0.0,
            cat=pulp.LpContinuous,
        )

    for d in range(inst.horizon_days):
        for s in inst.shifts:
            if inst.rules.modern_staffing and inst.rules.min_people_per_shift and any(dem.day == d and dem.required > 0 and shift_covers(s, dem.period) for dem in inst.demand):
                mv.u_shift[(s.id, d)] = pulp.LpVariable(f"u_shift_{s.id}_{d}", lowBound=0)

    mv.z = pulp.LpVariable("z", lowBound=0.0, cat=pulp.LpContinuous)
    mv.z_w = pulp.LpVariable("z_w", lowBound=0.0, cat=pulp.LpContinuous)
    mv.z_cl = pulp.LpVariable("z_cl", lowBound=0.0, cat=pulp.LpContinuous)
    return mv
