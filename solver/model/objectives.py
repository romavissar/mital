"""Objective terms. docs/model.md §4.

Each term is separately retrievable for the solve inspector. Scale discipline:
terms should land within ~2 orders of magnitude on a typical instance.
"""

from __future__ import annotations

from dataclasses import dataclass

import pulp

from mital_solver.model.base import ModelVars
from mital_solver.pay import regular_cost
from mital_solver.schemas import Instance


@dataclass
class ObjectiveTerms:
    """Affine expressions for each objective component. docs/model.md §4."""

    wages: pulp.LpAffineExpression
    overtime: pulp.LpAffineExpression
    understaffing: pulp.LpAffineExpression
    supervisor_penalty: pulp.LpAffineExpression
    min_hours_penalty: pulp.LpAffineExpression
    unfairness: pulp.LpAffineExpression
    preference: pulp.LpAffineExpression

    def total(self) -> pulp.LpAffineExpression:
        return (
            self.wages
            + self.overtime
            + self.understaffing
            + self.supervisor_penalty
            + self.min_hours_penalty
            + self.unfairness
            + self.preference
        )


def _criticality(inst: Instance) -> dict[tuple[int, str, int], float]:
    out: dict[tuple[int, str, int], float] = {}
    for d in inst.demand:
        out[(d.period, d.skill, d.day)] = float(d.criticality)
    return out


def _preference(inst: Instance) -> dict[tuple[str, str, int], float]:
    out: dict[tuple[str, str, int], float] = {}
    for e in inst.employees:
        for pref in e.preferences:
            out[(e.id, pref.shift, pref.day)] = float(pref.penalty)
    return out


def build_objective(
    mv: ModelVars,
    inst: Instance,
    *,
    equity_undesirable: bool = False,
    fairness_weight: float | None = None,
    mode: str = "full",
    stability_term: pulp.LpAffineExpression | float = 0.0,
) -> ObjectiveTerms:
    """Build objective terms. docs/model.md §4.

    fairness_weight overrides inst.weights.fairness when not None (S3 verify).
    Under MINMAX_HOURS, unfairness uses z only; under EQUITY_UNDESIRABLE,
    z + z_w + z_cl (docs/model.md §5).

    mode:
      - "full" — §4 weighted sum (default solve)
      - "cost_understaffing" — COST + UNDERSTAFFING only (§8 ε-sweep; no λ_f)
      - "fairness_only" — minimize the fairness measure (ε_min endpoint)
      - "repair" — COST + UNDERSTAFFING + λ_s · Σ(δ⁺+δ⁻) (§9)
    """
    shift_hours = {s.id: s.paid_hours for s in inst.shifts}
    shift_periods = {s.id: s.end_period - s.start_period for s in inst.shifts}
    wage = {e.id: e.wage for e in inst.employees}
    ot_wage = {e.id: e.ot_wage for e in inst.employees}
    crit = _criticality(inst)
    pref = _preference(inst)
    w = inst.weights
    lam_f = w.fairness if fairness_weight is None else fairness_weight

    wages = (
        pulp.lpSum(wage[e_id] * shift_hours[s_id] * var for (e_id, s_id, _d), var in mv.x.items())
        if inst.pay_basis == "hourly"
        else pulp.lpSum(regular_cost(inst, e, 0) for e in inst.employees)
    )
    overtime = pulp.lpSum(ot_wage[e_id] * mv.o[e_id] for e_id in mv.o)

    open_periods = {(d.day, d.period) for d in inst.demand if d.required > 0}
    max_shift_hours = max((s.paid_hours for s in inst.shifts), default=0)
    priority = 1 + (
        sum(e.wage * inst.horizon_days * max_shift_hours + e.ot_wage * e.max_overtime + w.min_hours * e.min_hours for e in inst.employees)
        + sum(w.understaffing * d.criticality * d.required for d in inst.demand if d.skill != inst.supervisor_skill or not (inst.rules.modern_staffing and any(inst.supervisor_skill not in e.skills for e in inst.employees)))
        + w.supervisor * len(open_periods)
        + w.fairness * (sum(e.max_hours + e.max_overtime for e in inst.employees) + 2 * inst.horizon_days)
        + w.preference * sum(p.penalty for e in inst.employees for p in e.preferences)
    )
    understaffing = pulp.lpSum(
        w.understaffing * crit.get(key, 1.0) * var
        for key, var in mv.u.items()
    ) + pulp.lpSum(priority * shift_periods[s_id] * var for (s_id, _day), var in mv.u_shift.items())
    supervisor_penalty = pulp.lpSum(
        w.supervisor * var for var in mv.u_sup.values()
    )
    min_hours_penalty = pulp.lpSum(
        w.min_hours * mv.u_min[e_id] for e_id in mv.u_min
    )

    assert mv.z is not None and mv.z_w is not None and mv.z_cl is not None
    fairness_measure = (
        (mv.z + mv.z_w + mv.z_cl) if equity_undesirable else mv.z
    )
    if mode == "fairness_only":
        unfairness = fairness_measure
    else:
        unfairness = lam_f * fairness_measure

    preference = pulp.lpSum(
        w.preference * pref[(e_id, s_id, d)] * var
        for (e_id, s_id, d), var in mv.x.items()
        if (e_id, s_id, d) in pref
    )

    terms = ObjectiveTerms(
        wages=wages,
        overtime=overtime,
        understaffing=understaffing,
        supervisor_penalty=supervisor_penalty,
        min_hours_penalty=min_hours_penalty,
        unfairness=unfairness,
        preference=preference,
    )

    if mode == "full":
        mv.prob += terms.total()
    elif mode == "cost_understaffing":
        mv.prob += (
            terms.wages
            + terms.overtime
            + terms.understaffing
            + terms.supervisor_penalty
            + terms.min_hours_penalty
        )
    elif mode == "fairness_only":
        mv.prob += terms.unfairness
    elif mode == "repair":
        mv.prob += (
            terms.wages
            + terms.overtime
            + terms.understaffing
            + terms.supervisor_penalty
            + terms.min_hours_penalty
            + stability_term
        )
    else:
        raise ValueError(f"unknown objective mode {mode!r}")
    return terms


def _v(expr: pulp.LpAffineExpression | float | int) -> float:
    if isinstance(expr, (int, float)):
        return float(expr)
    val = pulp.value(expr)
    return float(val) if val is not None else 0.0


def evaluate_terms(terms: ObjectiveTerms) -> dict[str, float]:
    """Numeric values of each term after solve."""
    wages = _v(terms.wages)
    overtime = _v(terms.overtime)
    understaffing = _v(terms.understaffing)
    supervisor_penalty = _v(terms.supervisor_penalty)
    min_hours_penalty = _v(terms.min_hours_penalty)
    unfairness = _v(terms.unfairness)
    preference = _v(terms.preference)
    return {
        "wages": wages,
        "overtime": overtime,
        "understaffing": understaffing,
        "supervisor_penalty": supervisor_penalty,
        "min_hours_penalty": min_hours_penalty,
        "unfairness": unfairness,
        "preference": preference,
        "total": (
            wages
            + overtime
            + understaffing
            + supervisor_penalty
            + min_hours_penalty
            + unfairness
            + preference
        ),
    }
