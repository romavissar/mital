"""One-request JSON bridge for the offline Electron desktop app.

Reads a bounded JSON request on stdin, writes exactly one JSON result on
stdout, and sends incidental solver output to stderr. It never opens a port.
"""

from __future__ import annotations

import contextlib
import json
import sys
from typing import Any

from pydantic import ValidationError

from mital_solver.api import (
    post_demand,
    post_explain,
    post_margins,
    post_pareto,
    post_repair,
    post_solve,
)
from mital_solver.schemas import (
    DemandRequest,
    Instance,
    MarginsRequest,
    SavedRoster,
    SolveRequest,
)

MAX_REQUEST_BYTES = 16 * 1024 * 1024


def dispatch(request: dict[str, Any]) -> Any:
    op = request.get("op")
    payload = request.get("payload")
    if not isinstance(op, str) or not isinstance(payload, dict):
        raise ValueError("request needs an operation and object payload")

    if op == "solve":
        return post_solve(
            SolveRequest.model_validate(payload),
            duals=bool(request.get("duals", False)),
        )
    if op == "pareto":
        return post_pareto(SolveRequest.model_validate(payload), compute=False)
    if op == "repair":
        return post_repair(SolveRequest.model_validate(payload))
    if op == "margins":
        return post_margins(MarginsRequest.model_validate(payload))
    if op == "explain":
        return post_explain(Instance.model_validate(payload))
    if op == "demand":
        return post_demand(DemandRequest.model_validate(payload))
    if op == "validateInstance":
        return Instance.model_validate(payload)
    if op == "validateSaved":
        return SavedRoster.model_validate(payload)
    raise ValueError(f"unsupported operation: {op!r}")


def main() -> int:
    try:
        raw = sys.stdin.buffer.read(MAX_REQUEST_BYTES + 1)
        if len(raw) > MAX_REQUEST_BYTES:
            raise ValueError("request exceeds 16 MiB")
        request = json.loads(raw)
        if not isinstance(request, dict):
            raise ValueError("request must be an object")
        with contextlib.redirect_stdout(sys.stderr):
            result = dispatch(request)
        if hasattr(result, "model_dump"):
            result = result.model_dump(mode="json")
        elif isinstance(result, list):
            result = [
                item.model_dump(mode="json") if hasattr(item, "model_dump") else item
                for item in result
            ]
        response = {"ok": True, "result": result}
        exit_code = 0
    except (ValueError, ValidationError, json.JSONDecodeError) as exc:
        response = {"ok": False, "error": str(exc)}
        exit_code = 1
    except Exception as exc:
        # Keep transport output well formed even when a backend raises.
        response = {"ok": False, "error": f"{type(exc).__name__}: {exc}"}
        exit_code = 1
    sys.stdout.write(json.dumps(response, ensure_ascii=False, allow_nan=False))
    sys.stdout.write("\n")
    return exit_code


if __name__ == "__main__":
    raise SystemExit(main())
