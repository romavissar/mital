"""Exhaustive exact coverage marginals → data/margins/.

Offline batch (pair with S11). ~200 s per mid-size instance. Do not run on
the interactive path. Cache is valid only when instance + roster hashes match.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import time
from pathlib import Path

from mital_solver.analysis.margins import exhaustive_exact_margins
from mital_solver.bench.frontiers import DEFAULT_IDS, instance_sha256
from mital_solver.model.solve import solve
from mital_solver.schemas import FairnessMode, Instance, Solution

ROOT = Path(__file__).resolve().parents[2]
INSTANCES = ROOT / "data" / "instances"
MARGINS = ROOT / "data" / "margins"


def solution_sha256(sol: Solution) -> str:
    """Roster fingerprint — margins are solution-dependent."""
    assignments = sorted(
        (
            {"employee": a.employee, "day": a.day, "shift": a.shift}
            for a in sol.assignments
        ),
        key=lambda x: (x["employee"], x["day"], x["shift"]),
    )
    payload = json.dumps(
        {"assignments": assignments},
        sort_keys=True,
        separators=(",", ":"),
    )
    return hashlib.sha256(payload.encode()).hexdigest()


def write_one(
    instance_id: str,
    *,
    time_limit_s: float,
    mip_gap: float,
    perturb_time_limit_s: float,
) -> Path:
    raw_path = INSTANCES / f"{instance_id}.json"
    inst = Instance.model_validate_json(raw_path.read_text(encoding="utf-8"))
    sol = solve(
        inst,
        fairness=FairnessMode.MINMAX_HOURS,
        time_limit_s=time_limit_s,
        mip_gap=mip_gap,
        duals=True,
    )
    margins, wall = exhaustive_exact_margins(
        inst,
        sol,
        fairness=FairnessMode.MINMAX_HOURS,
        perturb_time_limit_s=perturb_time_limit_s,
    )
    payload = {
        "instance_id": instance_id,
        "instance_sha256": instance_sha256(inst),
        "solution_sha256": solution_sha256(sol),
        "fairness": FairnessMode.MINMAX_HOURS.value,
        "n_binding": sum(1 for m in margins if m.binding),
        "n_margins": len(margins),
        "compute_time_s": wall,
        "base_objective_total": sol.objective.total,
        "margins": [
            {
                "day": m.day,
                "period": m.period,
                "skill": m.skill,
                "delta": m.delta,
                "provenance": m.provenance.value,
                "binding": m.binding,
                "required": m.required,
                "shadow_price": m.shadow_price,
                "relaxation_price": m.relaxation_price,
                "solve_time_s": m.solve_time_s,
            }
            for m in margins
        ],
        "note": (
            "Exhaustive exact Δ over all binding coverage rows at the "
            "committed default solve. Valid only when request instance and "
            "roster hashes match. Ranked by |Δ| — true costliest-first."
        ),
    }
    MARGINS.mkdir(parents=True, exist_ok=True)
    out = MARGINS / f"{instance_id}.json"
    out.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    return out


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--ids", nargs="*", default=DEFAULT_IDS)
    parser.add_argument("--time-limit", type=float, default=12.0)
    parser.add_argument("--mip-gap", type=float, default=0.02)
    parser.add_argument("--perturb-time-limit", type=float, default=2.5)
    args = parser.parse_args()

    for i, instance_id in enumerate(args.ids):
        print(f"[{i+1}/{len(args.ids)}] {instance_id} …", flush=True)
        t0 = time.perf_counter()
        path = write_one(
            instance_id,
            time_limit_s=args.time_limit,
            mip_gap=args.mip_gap,
            perturb_time_limit_s=args.perturb_time_limit,
        )
        data = json.loads(path.read_text(encoding="utf-8"))
        print(
            f"  → {path.name}: {data['n_margins']} margins "
            f"({data['n_binding']} binding), "
            f"{data['compute_time_s']:.1f}s perturb, "
            f"{time.perf_counter()-t0:.1f}s wall",
            flush=True,
        )


if __name__ == "__main__":
    main()
