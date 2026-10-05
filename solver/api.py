"""FastAPI transport for the solver. docs/data-contract.md.

The only module that knows about HTTP. solver/model/ must not import this.
Persistence is JSON files under data/saved/ — no database.
Precomputed frontiers under data/frontiers/; margins under data/margins/.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import time
from pathlib import Path
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response

from mital_solver import __version__
from mital_solver.analysis.conflicts import explain as explain_instance
from mital_solver.analysis.margins import batch_exact_margins
from mital_solver.cache_keys import instance_sha256
from mital_solver.demand.erlang import square_root_staffing
from mital_solver.model.pareto import pareto_frontier
from mital_solver.model.repair import repair as repair_roster
from mital_solver.model.solve import solve as solve_instance
from mital_solver.schemas import (
    DemandEntry,
    DemandRequest,
    DualProvenance,
    ExactMarginEntry,
    FairnessMode,
    InfeasibilityExplanation,
    Instance,
    MarginsRequest,
    MarginsResponse,
    ParetoPoint,
    ParetoResponse,
    SavedRoster,
    SolveMode,
    SolveRequest,
    Solution,
)

ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = Path(os.environ.get("MITAL_DATA_DIR", ROOT / "data"))
SAVED_DIR = DATA_DIR / "saved"
FRONTIERS_DIR = DATA_DIR / "frontiers"
MARGINS_DIR = DATA_DIR / "margins"
_ID_RE = re.compile(r"^[A-Za-z0-9._-]+$")

_SAMPLED_NOTE = (
    "Sampled marginal costs: exact MILP Δ on a |relaxation dual| "
    "shortlist. Selection is chance-level for the true costliest rows "
    "(recall 1/5 vs ~0.58 expected random on retail_40). Provenance "
    "badges are LP dual tags only — never quote them as monetary amounts."
)
_EXACT_NOTE = (
    "Precomputed exhaustive exact Δ over all binding coverage rows "
    "(data/margins/). Ranked by |Δ| — true costliest-first. Valid only "
    "for this instance + roster hash; pins or edits miss the cache."
)

app = FastAPI(title="mital solver", version=__version__)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _saved_path(doc_id: str) -> Path:
    if not _ID_RE.match(doc_id):
        raise HTTPException(
            status_code=422,
            detail="id must be alphanumeric plus . _ -",
        )
    return SAVED_DIR / f"{doc_id}.json"


def _reject_leximin(fairness: FairnessMode) -> None:
    if fairness == FairnessMode.LEXIMIN:
        raise HTTPException(
            status_code=422,
            detail="leximin is batch-only and out of scope for the interactive API",
        )


def _instance_sha256(inst: Instance) -> str:
    return instance_sha256(inst)


def _solution_sha256(sol: Solution) -> str:
    """Roster fingerprint — must match solver/bench/margins.py."""
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


def _cached_pareto(req: SolveRequest) -> ParetoResponse | None:
    """Return a committed frontier only for an unmodified instance.

    Pins, fairness mode other than the artifact, or a hash mismatch → None.
    Never return cached stops against a modified instance.
    """
    if req.pins:
        return None
    if req.fairness != FairnessMode.MINMAX_HOURS:
        return None
    path = FRONTIERS_DIR / f"{req.instance.id}.json"
    if not path.is_file():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    if data.get("instance_sha256") != _instance_sha256(req.instance):
        return None
    if data.get("fairness") != FairnessMode.MINMAX_HOURS.value:
        return None
    frontier = [ParetoPoint.model_validate(p) for p in data.get("frontier", [])]
    return ParetoResponse(
        frontier=sorted(frontier, key=lambda p: p.cost),
        total_solve_time_s=float(data.get("total_solve_time_s", 0.0)),
        source="cache",
        cache_note=(
            "Precomputed frontier for this committed instance. "
            "Live ε-sweeps take 30–60s at these sizes — the tractability "
            "wall that motivates column generation."
        ),
    )


@app.get("/health")
def health() -> dict:
    return {
        "status": "ok",
        "solver": "highs",
        "version": __version__,
    }


@app.post("/solve", response_model=Solution)
def post_solve(
    req: SolveRequest,
    duals: bool = Query(False, description="Populate duals via fixed-LP re-solve"),
) -> Solution:
    _reject_leximin(req.fairness)
    try:
        return solve_instance(
            req.instance,
            fairness=req.fairness,
            time_limit_s=req.time_limit_s,
            mip_gap=req.mip_gap,
            pins=req.pins or None,
            duals=duals,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@app.post("/pareto", response_model=ParetoResponse)
def post_pareto(
    req: SolveRequest,
    compute: bool = Query(
        False,
        description="Force a live sweep even when a matching cache exists",
    ),
) -> ParetoResponse:
    _reject_leximin(req.fairness)
    if req.mode not in (SolveMode.PARETO, SolveMode.SOLVE):
        raise HTTPException(
            status_code=422,
            detail="POST /pareto expects mode=pareto (or solve)",
        )

    if not compute:
        cached = _cached_pareto(req)
        if cached is not None:
            return cached

    t0 = time.perf_counter()
    try:
        points = pareto_frontier(
            req.instance,
            n_points=req.pareto_points,
            fairness=req.fairness,
            time_limit_s=req.time_limit_s,
            mip_gap=req.mip_gap,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

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
    note = None
    if req.pins:
        note = "Cache skipped: pins present. Dial should hide or mark stale."
    elif (FRONTIERS_DIR / f"{req.instance.id}.json").is_file():
        note = (
            "Cache miss: instance no longer matches the committed file "
            "(edit, weight change, or hash drift). Dial must not show "
            "cached stops."
        )
    return ParetoResponse(
        frontier=frontier,
        total_solve_time_s=time.perf_counter() - t0,
        source="live",
        cache_note=note,
    )


@app.post("/repair", response_model=Solution)
def post_repair(req: SolveRequest) -> Solution:
    _reject_leximin(req.fairness)
    if req.published is None:
        raise HTTPException(
            status_code=422,
            detail="POST /repair requires published: a Solution to stay close to",
        )
    try:
        return repair_roster(
            req.instance,
            req.published,
            fairness=req.fairness,
            time_limit_s=req.time_limit_s,
            mip_gap=req.mip_gap,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@app.post("/explain", response_model=InfeasibilityExplanation)
def post_explain(inst: Instance) -> InfeasibilityExplanation:
    return explain_instance(inst)


def _period_clock(period: int) -> str:
    minutes = period * 15
    return f"{minutes // 60:02d}:{minutes % 60:02d}"


def _margin_message(
    *,
    required: int,
    skill: str,
    day: int,
    period: int,
    delta: float,
    currency: str,
) -> str:
    sym = "€" if currency == "EUR" else f"{currency} "
    return (
        f"Requiring {required} {skill} on day {day} "
        f"at {_period_clock(period)} costs {sym}{delta:.0f}/week "
        f"(exact re-solve)."
    )


def _cached_margins(req: MarginsRequest) -> MarginsResponse | None:
    """Return exhaustive exact Δs only for an unmodified instance + roster.

    Pins, fairness other than the artifact, or hash mismatch → None.
    """
    if req.pins:
        return None
    if req.fairness != FairnessMode.MINMAX_HOURS:
        return None
    path = MARGINS_DIR / f"{req.instance.id}.json"
    if not path.is_file():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    if data.get("instance_sha256") != _instance_sha256(req.instance):
        return None
    if data.get("solution_sha256") != _solution_sha256(req.solution):
        return None
    if data.get("fairness") != FairnessMode.MINMAX_HOURS.value:
        return None

    raw = data.get("margins") or []
    entries: list[ExactMarginEntry] = []
    for row in raw[: req.top_n]:
        day = int(row["day"])
        period = int(row["period"])
        skill = str(row["skill"])
        delta = float(row["delta"])
        required = int(row["required"])
        entries.append(
            ExactMarginEntry(
                day=day,
                period=period,
                skill=skill,
                delta=delta,
                provenance=DualProvenance(row["provenance"]),
                binding=bool(row.get("binding", True)),
                required=required,
                shadow_price=float(row.get("shadow_price", 0.0)),
                message=_margin_message(
                    required=required,
                    skill=skill,
                    day=day,
                    period=period,
                    delta=delta,
                    currency=req.instance.currency,
                ),
            )
        )
    return MarginsResponse(
        margins=entries,
        compute_time_s=float(data.get("compute_time_s", 0.0)),
        source="exact_precomputed",
        note=_EXACT_NOTE,
    )


@app.post("/margins", response_model=MarginsResponse)
def post_margins(req: MarginsRequest) -> MarginsResponse:
    """Exact coverage marginals for the gutter — cache or sampled shortlist."""
    _reject_leximin(req.fairness)
    cached = _cached_margins(req)
    if cached is not None:
        return cached

    margins, wall = batch_exact_margins(
        req.instance,
        req.solution,
        fairness=req.fairness,
        top_n=req.top_n,
        perturb_time_limit_s=req.perturb_time_limit_s,
    )
    entries = [
        ExactMarginEntry(
            day=m.day,
            period=m.period,
            skill=m.skill,
            delta=m.delta,
            provenance=m.provenance,
            binding=m.binding,
            required=m.required,
            shadow_price=m.shadow_price,
            message=_margin_message(
                required=m.required,
                skill=m.skill,
                day=m.day,
                period=m.period,
                delta=m.delta,
                currency=req.instance.currency,
            ),
        )
        for m in margins
    ]
    return MarginsResponse(
        margins=entries,
        compute_time_s=wall,
        source="sampled",
        note=_SAMPLED_NOTE,
    )


@app.post("/demand", response_model=list[DemandEntry])
def post_demand(req: DemandRequest) -> list[DemandEntry]:
    out: list[DemandEntry] = []
    for a in req.arrivals:
        if a.arrival_rate <= 0:
            continue
        required = square_root_staffing(
            a.arrival_rate,
            mean_service_h=req.mean_service_h,
            beta=req.beta,
            target_p_wait=None if req.beta is not None else req.target_p_wait,
            wait_threshold_h=req.wait_threshold_h,
        )
        out.append(
            DemandEntry(
                day=a.day,
                period=a.period,
                skill=req.skill,
                required=required,
                criticality=req.criticality,
            )
        )
    return out


@app.get("/saved")
def list_saved() -> dict:
    SAVED_DIR.mkdir(parents=True, exist_ok=True)
    ids = sorted(p.stem for p in SAVED_DIR.glob("*.json"))
    return {"ids": ids}


@app.get("/saved/{doc_id}", response_model=SavedRoster)
def get_saved(doc_id: str) -> SavedRoster:
    path = _saved_path(doc_id)
    if not path.is_file():
        raise HTTPException(status_code=404, detail=f"no saved roster {doc_id!r}")
    return SavedRoster.model_validate_json(path.read_text(encoding="utf-8"))


@app.put("/saved/{doc_id}", response_model=SavedRoster)
def put_saved(doc_id: str, body: SavedRoster) -> SavedRoster:
    path = _saved_path(doc_id)
    SAVED_DIR.mkdir(parents=True, exist_ok=True)
    path.write_text(
        body.model_dump_json(indent=2) + "\n",
        encoding="utf-8",
    )
    return body


@app.delete("/saved/{doc_id}", status_code=204, response_class=Response)
def delete_saved(doc_id: str) -> Response:
    path = _saved_path(doc_id)
    if not path.is_file():
        raise HTTPException(status_code=404, detail=f"no saved roster {doc_id!r}")
    path.unlink()
    return Response(status_code=204)
