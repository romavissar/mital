"""Batch exact coverage marginals for the gutter.

Shortlist by |relaxation_price| (plateau-tolerant), quote euros from
perturb_coverage Δ only — never from relaxation duals.
"""

from __future__ import annotations

import time
from dataclasses import dataclass

from mital_solver.analysis.duals import compute_duals
from mital_solver.analysis.perturb import perturb_coverage
from mital_solver.schemas import (
    CoverageDual,
    DualProvenance,
    FairnessMode,
    Instance,
    Solution,
)


@dataclass
class ExactMargin:
    day: int
    period: int
    skill: str
    delta: float
    provenance: DualProvenance
    binding: bool
    shadow_price: float
    relaxation_price: float | None
    required: int
    solve_time_s: float


def _shortlist(
    coverage: list[CoverageDual], *, limit: int
) -> list[CoverageDual]:
    """Top keys by |relaxation_price|, falling back to |shadow_price|."""

    def key(c: CoverageDual) -> float:
        if c.relaxation_price is not None:
            return abs(c.relaxation_price)
        return abs(c.shadow_price)

    ranked = sorted(coverage, key=key, reverse=True)
    # Keep first `limit` after collapsing identical (day, period, skill).
    seen: set[tuple[int, int, str]] = set()
    out: list[CoverageDual] = []
    for c in ranked:
        k = (c.day, c.period, c.skill)
        if k in seen:
            continue
        seen.add(k)
        out.append(c)
        if len(out) >= limit:
            break
    return out


def _required(inst: Instance, day: int, period: int, skill: str) -> int:
    for d in inst.demand:
        if d.day == day and d.period == period and d.skill == skill:
            return d.required
    return 0


def _margin_from_dual(
    inst: Instance,
    solution: Solution,
    c: CoverageDual,
    *,
    fairness: FairnessMode,
    perturb_time_limit_s: float,
) -> ExactMargin | None:
    try:
        result = perturb_coverage(
            inst,
            day=c.day,
            period=c.period,
            skill=c.skill,
            base=solution,
            fairness=fairness,
            time_limit_s=perturb_time_limit_s,
        )
    except ValueError:
        return None
    return ExactMargin(
        day=c.day,
        period=c.period,
        skill=c.skill,
        delta=result.delta,
        provenance=c.provenance,
        binding=c.binding,
        shadow_price=c.shadow_price,
        relaxation_price=c.relaxation_price,
        required=_required(inst, c.day, c.period, c.skill),
        solve_time_s=result.solve_time_s,
    )


def batch_exact_margins(
    inst: Instance,
    solution: Solution,
    *,
    fairness: FairnessMode = FairnessMode.MINMAX_HOURS,
    top_n: int = 10,
    perturb_time_limit_s: float = 2.5,
) -> tuple[list[ExactMargin], float]:
    """Compute exact Δ for a |π_relax| shortlist (sampled path).

    Returns (margins sorted by |delta| desc, wall seconds).
    Shortlist recall of the true top-5 is chance-level — see benchmarks.md.
    """
    t0 = time.perf_counter()
    duals = solution.duals or compute_duals(inst, solution, fairness=fairness)
    shortlist = _shortlist(duals.coverage, limit=top_n)

    margins: list[ExactMargin] = []
    for c in shortlist:
        m = _margin_from_dual(
            inst,
            solution,
            c,
            fairness=fairness,
            perturb_time_limit_s=perturb_time_limit_s,
        )
        if m is not None:
            margins.append(m)

    margins.sort(key=lambda m: abs(m.delta), reverse=True)
    return margins, time.perf_counter() - t0


def exhaustive_exact_margins(
    inst: Instance,
    solution: Solution,
    *,
    fairness: FairnessMode = FairnessMode.MINMAX_HOURS,
    perturb_time_limit_s: float = 2.5,
) -> tuple[list[ExactMargin], float]:
    """Exact Δ for every binding coverage row — offline / bench only.

    Returns (margins sorted by |delta| desc, wall seconds).
    """
    t0 = time.perf_counter()
    duals = solution.duals or compute_duals(inst, solution, fairness=fairness)
    binding = [c for c in duals.coverage if c.binding]

    margins: list[ExactMargin] = []
    for c in binding:
        m = _margin_from_dual(
            inst,
            solution,
            c,
            fairness=fairness,
            perturb_time_limit_s=perturb_time_limit_s,
        )
        if m is not None:
            margins.append(m)

    margins.sort(key=lambda m: abs(m.delta), reverse=True)
    return margins, time.perf_counter() - t0
