"""Erlang C and square-root staffing. docs/model.md §6."""

from __future__ import annotations

import math


def erlang_c(n: int, a: float) -> float:
    """Probability that an arrival waits (Erlang C / M/M/n).

    n — number of servers (≥ 1)
    a — offered load in erlangs (λ/μ), must be < n for stability
    """
    if n < 1:
        raise ValueError("n must be >= 1")
    if a < 0:
        raise ValueError("offered load a must be >= 0")
    if a >= n:
        return 1.0

    # C(n,a) = [a^n / n!] / [a^n/n! + (1 - a/n) Σ_{k=0}^{n-1} a^k/k!]
    # Computed in log-space for the sum to avoid overflow.
    log_an_nfact = n * math.log(a) - sum(math.log(i) for i in range(1, n + 1))
    # Sum Σ a^k/k! via iterative product.
    term = 1.0  # a^0/0!
    s = term
    for k in range(1, n):
        term *= a / k
        s += term

    # numerator = a^n / n!
    numer = math.exp(log_an_nfact)
    denom = numer + (1.0 - a / n) * s
    return numer / denom


def beta_for_erlang_c_target(
    a: float,
    *,
    mu: float,
    wait_threshold_h: float,
    target_p: float,
    beta_lo: float = 0.0,
    beta_hi: float = 5.0,
    tol: float = 1e-4,
) -> float:
    """Find β such that square-root staffing meets the Erlang-C wait target.

    Staffing rule: r = ceil(a + β√a). Search β so P(W > t) ≤ target_p.
    """
    if a <= 0:
        return 0.0

    def p_wait(n: int) -> float:
        if n <= a:
            return 1.0
        c = erlang_c(n, a)
        return c * math.exp(-(n - a) * mu * wait_threshold_h)

    def ok(beta: float) -> bool:
        n = max(1, math.ceil(a + beta * math.sqrt(a)))
        return p_wait(n) <= target_p + 1e-12

    if ok(beta_lo):
        return beta_lo
    if not ok(beta_hi):
        # Target unreachable in search range — return upper end.
        return beta_hi

    lo, hi = beta_lo, beta_hi
    while hi - lo > tol:
        mid = 0.5 * (lo + hi)
        if ok(mid):
            hi = mid
        else:
            lo = mid
    return hi


def square_root_staffing(
    arrival_rate: float,
    *,
    mean_service_h: float,
    beta: float | None = None,
    target_p_wait: float | None = 0.2,
    wait_threshold_h: float = 2.0 / 60.0,
) -> int:
    """Required headcount r_t = ceil(R + β√R), floored at 1.

    If beta is None, solve it from the Erlang C wait target
    (default: P(wait > 2 min) ≤ 0.2). docs/model.md §6.
    """
    if mean_service_h <= 0:
        raise ValueError("mean_service_h must be > 0")
    mu = 1.0 / mean_service_h
    R = arrival_rate * mean_service_h  # λ/μ
    if R <= 0:
        return 1

    if beta is None:
        if target_p_wait is None:
            raise ValueError("provide beta or target_p_wait")
        beta = beta_for_erlang_c_target(
            R,
            mu=mu,
            wait_threshold_h=wait_threshold_h,
            target_p=target_p_wait,
        )

    r = math.ceil(R + beta * math.sqrt(R))
    return max(1, r)
