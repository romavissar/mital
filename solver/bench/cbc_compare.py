"""S12 — HiGHS vs CBC on the six compare instances → results/cbc_compare.csv."""

from __future__ import annotations

import argparse
import csv
from pathlib import Path

from mital_solver.model.solve import load_instance, solve
from mital_solver.schemas import FairnessMode

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "results" / "cbc_compare.csv"

IDS = [
    "cafe_08",
    "cafe_18",
    "clinic_25",
    "retail_40",
    "retail_60",
    "tight_20",
]

FIELDS = [
    "instance",
    "backend",
    "n_employees",
    "cost",
    "wages",
    "overtime",
    "understaffing",
    "unfairness",
    "uncovered_periods",
    "supervisor_gap_count",
    "solve_time_s",
    "mip_gap",
    "status",
]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--time-limit", type=float, default=30.0)
    parser.add_argument("--mip-gap", type=float, default=0.01)
    args = parser.parse_args()

    rows: list[dict] = []
    for instance_id in IDS:
        inst = load_instance(ROOT / "data" / "instances" / f"{instance_id}.json")
        n = len(inst.employees)
        for backend in ("highs", "cbc"):
            print(f"{instance_id} / {backend} …", flush=True)
            sol = solve(
                inst,
                fairness=FairnessMode.MINMAX_HOURS,
                time_limit_s=args.time_limit,
                mip_gap=args.mip_gap,
                backend=backend,
            )
            print(
                f"  cost={sol.objective.total:.2f} t={sol.solve_time_s:.2f}s "
                f"status={sol.status.value} unc={sol.uncovered_entry_count}",
                flush=True,
            )
            rows.append(
                {
                    "instance": instance_id,
                    "backend": backend,
                    "n_employees": n,
                    "cost": f"{sol.objective.total:.4f}",
                    "wages": f"{sol.objective.wages:.4f}",
                    "overtime": f"{sol.objective.overtime:.4f}",
                    "understaffing": f"{sol.objective.understaffing:.4f}",
                    "unfairness": f"{sol.objective.unfairness:.4f}",
                    "uncovered_periods": sol.uncovered_entry_count,
                    "supervisor_gap_count": sol.objective.supervisor_gap,
                    "solve_time_s": f"{sol.solve_time_s:.4f}",
                    "mip_gap": f"{sol.mip_gap:.6f}",
                    "status": sol.status.value,
                }
            )

    OUT.parent.mkdir(parents=True, exist_ok=True)
    with OUT.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=FIELDS)
        w.writeheader()
        w.writerows(rows)
    print(f"wrote {OUT}", flush=True)


if __name__ == "__main__":
    main()
