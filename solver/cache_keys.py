"""Canonical instance hash shared by cache writers and readers."""

from __future__ import annotations

import hashlib
import json

from mital_solver.schemas import Instance


def instance_sha256(inst: Instance) -> str:
    data = inst.model_dump(mode="json")
    data["model_version"] = 2  # Invalidate solutions cached under the removed work rules.
    for employee in data["employees"]:
        if not employee["absences"]:
            employee.pop("absences")
    if inst.rules.min_people_per_shift == 1 and inst.rules.max_people_per_shift is None:
        data["rules"].pop("min_people_per_shift")
        data["rules"].pop("max_people_per_shift")
    if inst.rules.supervision_required is None:
        data["rules"].pop("supervision_required")
    # New optional pay fields must not invalidate committed hourly demo caches.
    if inst.pay_basis == "hourly" and all(e.monthly_salary is None for e in inst.employees):
        data.pop("pay_basis")
        for employee in data["employees"]:
            employee.pop("monthly_salary")
    if not inst.rules.romania_policy:
        for key in ("romania_policy", "previous_week_known", "previous_week_start", "previous_work"):
            data["rules"].pop(key)
        for employee in data["employees"]:
            employee.pop("shift_worker")
    payload = json.dumps(data, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(payload.encode()).hexdigest()
