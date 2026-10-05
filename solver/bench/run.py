"""Benchmark runner → results/benchmark.csv.

Runs MILP, greedy, and round_robin on the six committed instances, then a
scaling sweep of the MILP at the 5 s interactive budget for
n_employees ∈ {8, 18, 25, 40, 60}.
"""

from __future__ import annotations

import argparse
import csv
import time
from pathlib import Path

from mital_solver.bench.baselines import greedy, round_robin
from mital_solver.model.solve import solve
from mital_solver.schemas import FairnessMode, Instance, Solution

ROOT = Path(__file__).resolve().parents[2]
INSTANCES = ROOT / "data" / "instances"
RESULTS = ROOT / "results"

# Committed comparison instances.
COMPARE_IDS = [
    "cafe_08",
    "cafe_18",
    "clinic_25",
    "retail_40",
    "retail_60",
    "tight_20",
]

# Size family for the scaling sweep / Figure 3. Fixed tightness ≈ 0.80.
SCALE_IDS = [
    ("cafe_08", 8),
    ("cafe_18", 18),
    ("clinic_25", 25),
    ("retail_40", 40),
    ("retail_60", 60),
]

CSV_FIELDS = [
    "suite",
    "instance",
    "method",
    "n_employees",
    "cost",
    "wages",
    "overtime",
    "understaffing",
    "supervisor_penalty",
    "supervisor_gap_count",
    "min_hours_penalty",
    "unfairness",
    "preference",
    "hour_spread",
    "gini",
    "jain",
    "uncovered_periods",
    "shortfall_person_periods",
    "solve_time_s",
    "mip_gap",
    "status",
]


def _load(instance_id: str) -> Instance:
    path = INSTANCES / f"{instance_id}.json"
    return Instance.model_validate_json(path.read_text(encoding="utf-8"))


def _assert_objective_reconciles(sol: Solution, *, label: str) -> None:
    """Fail loudly if reported cost ≠ sum of objective terms."""
    o = sol.objective
    parts = (
        o.wages
        + o.overtime
        + o.understaffing
        + o.supervisor_penalty
        + o.min_hours_penalty
        + o.unfairness
        + o.preference
    )
    if abs(parts - o.total) > 0.05:
        raise AssertionError(
            f"objective terms do not sum to cost for {label}: "
            f"wages({o.wages:.4f}) + overtime({o.overtime:.4f}) + "
            f"understaffing({o.understaffing:.4f}) + "
            f"supervisor_penalty({o.supervisor_penalty:.4f}) + "
            f"min_hours_penalty({o.min_hours_penalty:.4f}) + "
            f"unfairness({o.unfairness:.4f}) + preference({o.preference:.4f}) "
            f"= {parts:.4f} ≠ cost {o.total:.4f}"
        )


def _row(
    *,
    suite: str,
    instance_id: str,
    method: str,
    n_employees: int,
    sol: Solution,
) -> dict:
    _assert_objective_reconciles(sol, label=f"{suite}/{instance_id}/{method}")
    return {
        "suite": suite,
        "instance": instance_id,
        "method": method,
        "n_employees": n_employees,
        "cost": f"{sol.objective.total:.4f}",
        "wages": f"{sol.objective.wages:.4f}",
        "overtime": f"{sol.objective.overtime:.4f}",
        "understaffing": f"{sol.objective.understaffing:.4f}",
        "supervisor_penalty": f"{sol.objective.supervisor_penalty:.4f}",
        "supervisor_gap_count": sol.objective.supervisor_gap,
        "min_hours_penalty": f"{sol.objective.min_hours_penalty:.4f}",
        "unfairness": f"{sol.objective.unfairness:.4f}",
        "preference": f"{sol.objective.preference:.4f}",
        "hour_spread": f"{sol.fairness.max_deviation_hours:.4f}",
        "gini": f"{sol.fairness.gini:.6f}",
        "jain": f"{sol.fairness.jain:.6f}",
        "uncovered_periods": sol.uncovered_entry_count,
        "shortfall_person_periods": f"{sol.shortfall_person_periods:.4f}",
        "solve_time_s": f"{sol.solve_time_s:.4f}",
        "mip_gap": f"{sol.mip_gap:.6f}",
        "status": sol.status.value,
    }


def run_compare(
    *,
    time_limit_s: float,
    mip_gap: float,
) -> list[dict]:
    rows: list[dict] = []
    for instance_id in COMPARE_IDS:
        inst = _load(instance_id)
        n = len(inst.employees)
        print(f"[compare] {instance_id} (n={n})", flush=True)

        t0 = time.perf_counter()
        milp = solve(
            inst,
            fairness=FairnessMode.MINMAX_HOURS,
            time_limit_s=time_limit_s,
            mip_gap=mip_gap,
        )
        print(
            f"  milp: cost={milp.objective.total:.2f} "
            f"uncovered={milp.uncovered_entry_count} "
            f"sup_gap={milp.objective.supervisor_gap} "
            f"t={milp.solve_time_s:.2f}s status={milp.status.value} "
            f"gap={milp.mip_gap:.4f}",
            flush=True,
        )
        rows.append(
            _row(
                suite="compare",
                instance_id=instance_id,
                method="milp",
                n_employees=n,
                sol=milp,
            )
        )

        g = greedy(inst)
        print(
            f"  greedy: cost={g.objective.total:.2f} "
            f"uncovered={g.uncovered_entry_count} "
            f"sup_gap={g.objective.supervisor_gap} "
            f"t={g.solve_time_s:.3f}s",
            flush=True,
        )
        rows.append(
            _row(
                suite="compare",
                instance_id=instance_id,
                method="greedy",
                n_employees=n,
                sol=g,
            )
        )

        rr = round_robin(inst)
        print(
            f"  round_robin: cost={rr.objective.total:.2f} "
            f"uncovered={rr.uncovered_entry_count} "
            f"sup_gap={rr.objective.supervisor_gap} "
            f"t={rr.solve_time_s:.3f}s",
            flush=True,
        )
        rows.append(
            _row(
                suite="compare",
                instance_id=instance_id,
                method="round_robin",
                n_employees=n,
                sol=rr,
            )
        )
        print(f"  wall={time.perf_counter() - t0:.1f}s", flush=True)
    return rows


def run_scale(*, time_limit_s: float = 5.0, mip_gap: float = 0.01) -> list[dict]:
    """MILP at the interactive 5 s budget — time-to-incumbent and gap."""
    rows: list[dict] = []
    for instance_id, n_expected in SCALE_IDS:
        inst = _load(instance_id)
        n = len(inst.employees)
        assert n == n_expected, f"{instance_id}: expected n={n_expected}, got {n}"
        print(f"[scale] {instance_id} n={n} time_limit={time_limit_s}s", flush=True)
        sol = solve(
            inst,
            fairness=FairnessMode.MINMAX_HOURS,
            time_limit_s=time_limit_s,
            mip_gap=mip_gap,
        )
        print(
            f"  cost={sol.objective.total:.2f} gap={sol.mip_gap:.4f} "
            f"t={sol.solve_time_s:.2f}s status={sol.status.value} "
            f"unc={sol.uncovered_entry_count}",
            flush=True,
        )
        rows.append(
            _row(
                suite="scale",
                instance_id=instance_id,
                method="milp",
                n_employees=n,
                sol=sol,
            )
        )
    return rows


def write_csv(path: Path, rows: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=CSV_FIELDS)
        writer.writeheader()
        writer.writerows(rows)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--out",
        type=Path,
        default=RESULTS / "benchmark.csv",
    )
    parser.add_argument(
        "--compare-time-limit",
        type=float,
        default=30.0,
        help="MILP time limit for the method comparison suite",
    )
    parser.add_argument("--mip-gap", type=float, default=0.01)
    parser.add_argument(
        "--scale-time-limit",
        type=float,
        default=5.0,
        help="MILP time limit for the scaling sweep (interactive budget)",
    )
    parser.add_argument(
        "--skip-scale",
        action="store_true",
        help="Only run the method comparison suite",
    )
    parser.add_argument(
        "--scale-only",
        action="store_true",
        help="Only run the scaling sweep",
    )
    args = parser.parse_args()

    rows: list[dict] = []
    if not args.scale_only:
        rows.extend(
            run_compare(
                time_limit_s=args.compare_time_limit,
                mip_gap=args.mip_gap,
            )
        )
    if args.scale_only or not args.skip_scale:
        rows.extend(
            run_scale(
                time_limit_s=args.scale_time_limit,
                mip_gap=args.mip_gap,
            )
        )
    write_csv(args.out, rows)
    print(f"wrote {args.out} ({len(rows)} rows)", flush=True)


if __name__ == "__main__":
    main()
