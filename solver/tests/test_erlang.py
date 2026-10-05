"""Unit tests against published Erlang C values. docs/model.md §6."""

from __future__ import annotations

import math

import pytest

from mital_solver.demand.erlang import erlang_c, square_root_staffing


# Published M/M/n Erlang-C reference values (standard tables / textbooks).
# Format: (n, a, expected C(n,a))
ERLANG_C_TABLE = [
    (1, 0.5, 0.5),
    (2, 1.0, 1.0 / 3.0),
    (3, 2.0, 4.0 / 9.0),
    # Gross & Harris / standard M/M/n tables (3 d.p.)
    (5, 3.0, 0.236),
    (10, 7.0, 0.222),
]


@pytest.mark.parametrize("n,a,expected", ERLANG_C_TABLE)
def test_erlang_c_published(n: int, a: float, expected: float) -> None:
    got = erlang_c(n, a)
    assert got == pytest.approx(expected, rel=1e-3, abs=1e-3)


def test_erlang_c_unstable_saturates() -> None:
    assert erlang_c(2, 2.0) == 1.0
    assert erlang_c(2, 2.5) == 1.0


def test_square_root_staffing_floor() -> None:
    # Zero load still opens with 1 server during open hours.
    assert square_root_staffing(0.0, mean_service_h=0.1, beta=1.0) == 1


def test_square_root_staffing_with_beta() -> None:
    # R = 4, β = 1 → ceil(4 + 2) = 6
    r = square_root_staffing(40.0, mean_service_h=0.1, beta=1.0)
    assert r == 6


def test_square_root_staffing_from_target() -> None:
    r = square_root_staffing(
        30.0,
        mean_service_h=0.1,
        beta=None,
        target_p_wait=0.2,
        wait_threshold_h=2.0 / 60.0,
    )
    assert r >= math.ceil(3.0)  # at least the offered load
    assert r >= 1
