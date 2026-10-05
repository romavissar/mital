"""Post-solve fairness metrics. docs/model.md §5 — reported, never optimized."""

from __future__ import annotations


def gini(values: list[float]) -> float:
    """Gini coefficient of a non-negative distribution."""
    n = len(values)
    if n == 0:
        return 0.0
    s = sorted(values)
    total = sum(s)
    if total <= 0:
        return 0.0
    num = sum(i * v for i, v in enumerate(s, start=1))
    return float((2 * num) / (n * total) - (n + 1) / n)


def jain(values: list[float]) -> float:
    """Jain's fairness index. 1 = perfectly equal."""
    n = len(values)
    if n == 0:
        return 1.0
    total = sum(values)
    sq = sum(v * v for v in values)
    if sq <= 0:
        return 1.0
    return float((total * total) / (n * sq))
