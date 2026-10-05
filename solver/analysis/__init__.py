"""Post-solve analysis: metrics, duals, conflict explanations."""

from mital_solver.analysis.conflicts import explain
from mital_solver.analysis.duals import compute_duals
from mital_solver.analysis.margins import (
    batch_exact_margins,
    exhaustive_exact_margins,
)
from mital_solver.analysis.metrics import gini, jain

__all__ = [
    "gini",
    "jain",
    "compute_duals",
    "explain",
    "batch_exact_margins",
    "exhaustive_exact_margins",
]
