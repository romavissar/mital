"""Precompute ε-frontiers for committed instances → data/frontiers/.

Cached frontiers are valid only for the exact committed instance bytes.
See docs/data-contract.md for the cache key.
"""

from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

from mital_solver.cache_keys import instance_sha256
from mital_solver.model.pareto import pareto_frontier
from mital_solver.schemas import FairnessMode, Instance, ParetoPoint, ParetoResponse

ROOT = Path(__file__).resolve().parents[2]
INSTANCES = ROOT / "data" / "instances"
FRONTIERS = ROOT / "data" / "frontiers"

# Demo / benchmark set the dial is allowed to use.
DEFAULT_IDS = [
    "cafe_08",
    "cafe_18",
    "cafe_40",
    "clinic_25",
    "retail_10",
    "retail_40",
    "retail_60",
]


def build_frontier(
    inst: Instance,
    *,
    n_points: int = 12,
    time_limit_s: float = 8.0,
    mip_gap: float = 0.02,
) -> ParetoResponse:
    t0 = time.perf_counter()
    points = pareto_frontier(
        inst,
        n_points=n_points,
        fairness=FairnessMode.MINMAX_HOURS,
        time_limit_s=time_limit_s,
        mip_gap=mip_gap,
    )
    frontier = sorted(
        [
            ParetoPoint(
                epsilon=p.epsilon,
                cost=p.cost,
                max_deviation_hours=p.solution.fairness.max_deviation_hours,
                solution=p.solution,
            )
            for p in points
        ],
        key=lambda p: p.cost,
    )
    return ParetoResponse(
        frontier=frontier,
        total_solve_time_s=time.perf_counter() - t0,
    )


def write_one(
    instance_id: str,
    *,
    n_points: int,
    time_limit_s: float,
    mip_gap: float,
) -> Path:
    raw_path = INSTANCES / f"{instance_id}.json"
    inst = Instance.model_validate_json(raw_path.read_text(encoding="utf-8"))
    resp = build_frontier(
        inst, n_points=n_points, time_limit_s=time_limit_s, mip_gap=mip_gap
    )
    payload = {
        "instance_id": instance_id,
        "instance_sha256": instance_sha256(inst),
        "fairness": FairnessMode.MINMAX_HOURS.value,
        "pareto_points_requested": n_points,
        "time_limit_s": time_limit_s,
        "mip_gap": mip_gap,
        "frontier": resp.model_dump()["frontier"],
        "total_solve_time_s": resp.total_solve_time_s,
        "note": (
            "Precomputed ε-frontier for the committed instance. Valid only "
            "when request.instance hashes to instance_sha256. Any pin, "
            "availability, demand, or weight edit must miss this cache."
        ),
    }
    FRONTIERS.mkdir(parents=True, exist_ok=True)
    out = FRONTIERS / f"{instance_id}.json"
    out.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    return out


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--ids", nargs="*", default=DEFAULT_IDS)
    parser.add_argument("--pareto-points", type=int, default=12)
    parser.add_argument("--time-limit", type=float, default=8.0)
    parser.add_argument("--mip-gap", type=float, default=0.02)
    args = parser.parse_args()

    for i, instance_id in enumerate(args.ids):
        print(f"[{i+1}/{len(args.ids)}] {instance_id} …", flush=True)
        t0 = time.perf_counter()
        path = write_one(
            instance_id,
            n_points=args.pareto_points,
            time_limit_s=args.time_limit,
            mip_gap=args.mip_gap,
        )
        data = json.loads(path.read_text())
        print(
            f"  → {path.name}: {len(data['frontier'])} stops, "
            f"{data['total_solve_time_s']:.1f}s solve, "
            f"{time.perf_counter()-t0:.1f}s wall",
            flush=True,
        )


if __name__ == "__main__":
    main()
