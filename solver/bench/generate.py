"""Parameterized instance generator for café / clinic / retail benchmarks.

Tightness is demand person-hours / effective capacity, where effective
capacity sums min(max_hours, hours reachable from availability) per employee.
"""

from __future__ import annotations

import argparse
from pathlib import Path
from typing import Literal

import numpy as np

from mital_solver.schemas import (
    AvailabilityEntry,
    DemandEntry,
    Employee,
    Instance,
    PreferenceEntry,
    Rules,
    Shift,
    Weights,
)

Domain = Literal["cafe", "clinic", "retail"]

TIGHTNESS_TOL = 0.02

FIRST_NAMES = [
    "Ana", "Ben", "Cara", "Diego", "Elena", "Finn", "Grace", "Hugo",
    "Iris", "Jules", "Kai", "Lena", "Maya", "Noah", "Omar", "Priya",
    "Quinn", "Rosa", "Sam", "Tara", "Uma", "Vera", "Will", "Xena",
    "Yuri", "Zoe", "Alex", "Blair", "Chris", "Drew", "Eden", "Fran",
    "Gabe", "Hana", "Ivo", "Jade", "Kit", "Liv", "Mo", "Nia",
    "Oak", "Pax", "Remy", "Sage", "Tess", "Uri", "Vale", "Wes",
    "Yael", "Zara", "Ari", "Bo", "Cleo", "Dani", "Ezra", "Faye",
    "Gio", "Hazel", "Indie", "Jo", "Kris", "Lux",
]

DOMAIN_SKILLS: dict[Domain, tuple[list[str], str]] = {
    "cafe": (["barista", "keyholder", "kitchen"], "keyholder"),
    "clinic": (["nurse", "receptionist", "supervisor"], "supervisor"),
    "retail": (["sales", "keyholder", "stock"], "keyholder"),
}

DEFAULT_SKILL_MIX: dict[Domain, dict[str, float]] = {
    "cafe": {"barista": 0.85, "kitchen": 0.35, "keyholder": 0.30},
    "clinic": {"nurse": 0.70, "receptionist": 0.40, "supervisor": 0.25},
    "retail": {"sales": 0.90, "stock": 0.40, "keyholder": 0.25},
}

SHIFT_TEMPLATES: dict[Domain, list[dict]] = {
    "cafe": [
        {"id": "open", "label": "Opening", "start_period": 24, "end_period": 56,
         "paid_hours": 7.5, "undesirable": False, "closing": False},
        {"id": "mid", "label": "Mid", "start_period": 40, "end_period": 72,
         "paid_hours": 7.5, "undesirable": False, "closing": False},
        {"id": "close", "label": "Closing", "start_period": 56, "end_period": 88,
         "paid_hours": 7.5, "undesirable": True, "closing": True},
    ],
    "clinic": [
        {"id": "early", "label": "Early", "start_period": 28, "end_period": 60,
         "paid_hours": 7.5, "undesirable": False, "closing": False},
        {"id": "day", "label": "Day", "start_period": 36, "end_period": 68,
         "paid_hours": 7.5, "undesirable": False, "closing": False},
        {"id": "late", "label": "Late", "start_period": 52, "end_period": 84,
         "paid_hours": 7.5, "undesirable": True, "closing": True},
    ],
    "retail": [
        {"id": "open", "label": "Opening", "start_period": 32, "end_period": 64,
         "paid_hours": 7.5, "undesirable": False, "closing": False},
        {"id": "mid", "label": "Mid", "start_period": 44, "end_period": 76,
         "paid_hours": 7.5, "undesirable": False, "closing": False},
        {"id": "close", "label": "Closing", "start_period": 60, "end_period": 92,
         "paid_hours": 7.5, "undesirable": True, "closing": True},
    ],
}


def demand_person_hours(inst: Instance) -> float:
    """Required person-hours (each demand period is 15 minutes)."""
    return sum(d.required for d in inst.demand) * 0.25


def hours_reachable(emp: Employee, shifts: list[Shift]) -> float:
    """Max hours under one-shift-per-day given availability (ignores max_hours)."""
    shift_hours = {s.id: s.paid_hours for s in shifts}
    total = 0.0
    for av in emp.availability:
        if not av.shifts:
            continue
        total += max(shift_hours[sid] for sid in av.shifts if sid in shift_hours)
    return total


def effective_capacity(inst: Instance) -> float:
    """Sum over employees of min(max_hours, hours reachable from availability)."""
    return sum(
        min(e.max_hours, hours_reachable(e, inst.shifts)) for e in inst.employees
    )


def available_person_hours(inst: Instance) -> float:
    """Alias kept for callers; equals effective_capacity."""
    return effective_capacity(inst)


def achieved_tightness(inst: Instance) -> float:
    cap = effective_capacity(inst)
    if cap <= 0:
        return float("inf")
    return demand_person_hours(inst) / cap


def _shift_covers(shift: Shift, period: int) -> bool:
    return shift.start_period <= period < shift.end_period


def _local_pool(
    employees: list[Employee],
    shifts: list[Shift],
    day: int,
    period: int,
    skill: str,
) -> int:
    shift_by_id = {s.id: s for s in shifts}
    n = 0
    for e in employees:
        if skill not in e.skills:
            continue
        offered = next((a.shifts for a in e.availability if a.day == day), [])
        if any(
            sid in shift_by_id and _shift_covers(shift_by_id[sid], period)
            for sid in offered
        ):
            n += 1
    return n


def generate(
    *,
    instance_id: str,
    n_employees: int,
    n_days: int = 7,
    domain: Domain = "cafe",
    skill_mix: dict[str, float] | None = None,
    demand_tightness: float = 0.80,
    availability_density: float = 0.70,
    start_date: str = "2026-08-03",
    seed: int = 0,
) -> Instance:
    """Build a realistic Instance.

    Parameters
    ----------
    demand_tightness
        Target ratio of demand person-hours to effective capacity.
        Values > 1.0 deliberately over-constrain coverage.
    availability_density
        Probability an employee is available for a given (day, shift).
    """
    rng = np.random.default_rng(seed)
    skills, supervisor_skill = DOMAIN_SKILLS[domain]
    mix = skill_mix or DEFAULT_SKILL_MIX[domain]
    shifts = [Shift(**t) for t in SHIFT_TEMPLATES[domain]]
    shift_by_id = {s.id: s for s in shifts}

    employees: list[Employee] = []
    for i in range(n_employees):
        eid = f"e_{i:03d}"
        name = FIRST_NAMES[i % len(FIRST_NAMES)]
        if i >= len(FIRST_NAMES):
            name = f"{name}{i // len(FIRST_NAMES) + 1}"

        emp_skills = [sk for sk in skills if rng.random() < mix.get(sk, 0.3)]
        if not emp_skills:
            emp_skills = [skills[0]]
        is_supervisor_seed = i < max(2, n_employees // 6)
        if is_supervisor_seed and supervisor_skill not in emp_skills:
            emp_skills.append(supervisor_skill)

        base_wage = {"cafe": 13.5, "clinic": 22.0, "retail": 14.0}[domain]
        wage = round(float(base_wage + rng.uniform(-1.5, 3.0)), 2)
        ot_wage = round(wage * 1.5, 2)

        if rng.random() < 0.35:
            min_h, max_h = 0.0, float(rng.choice([20, 24, 28]))
        else:
            min_h = float(rng.choice([0, 16, 24]))
            max_h = 40.0

        availability: list[AvailabilityEntry] = []
        for d in range(n_days):
            dens = availability_density * (0.75 if d in (5, 6) else 1.0)
            # Supervisors get denser availability so C6 is locally feasible.
            if supervisor_skill in emp_skills:
                dens = min(1.0, dens + 0.20)
            offered = [s.id for s in shifts if rng.random() < dens]
            # Supervisors: ensure at least one covering shift on weekdays.
            if supervisor_skill in emp_skills and d not in (5, 6) and not offered:
                offered = [shifts[min(1, len(shifts) - 1)].id]
            if offered:
                availability.append(AvailabilityEntry(day=d, shifts=offered))

        if len(availability) < 2:
            for d in range(min(3, n_days)):
                if not any(a.day == d for a in availability):
                    availability.append(
                        AvailabilityEntry(day=d, shifts=[s.id for s in shifts])
                    )

        reachable = sum(
            max(shift_by_id[sid].paid_hours for sid in av.shifts)
            for av in availability
            if av.shifts
        )
        # Keep min_hours satisfiable from availability (diagnose check 4).
        min_h = min(min_h, reachable)

        preferences: list[PreferenceEntry] = []
        for av in availability:
            for sid in av.shifts:
                sh = shift_by_id[sid]
                if sh.undesirable and rng.random() < 0.4:
                    preferences.append(
                        PreferenceEntry(
                            day=av.day,
                            shift=sid,
                            penalty=float(rng.integers(2, 6)),
                        )
                    )

        employees.append(
            Employee(
                id=eid,
                name=name,
                wage=wage,
                ot_wage=ot_wage,
                skills=emp_skills,
                min_hours=min_h,
                max_hours=max_h,
                max_overtime=8.0,
                max_consecutive_days=5,
                availability=availability,
                preferences=preferences,
            )
        )

    skeleton = Instance(
        id=instance_id,
        horizon_days=n_days,
        start_date=start_date,
        currency="EUR",
        skills=skills,
        supervisor_skill=supervisor_skill,
        shifts=shifts,
        employees=employees,
        demand=[],
        rules=Rules(
            min_rest_hours=11.0,
            weekend_days=[5, 6] if n_days >= 7 else [],
        ),
        weights=Weights(),
    )
    capacity = effective_capacity(skeleton)
    if capacity <= 0:
        raise RuntimeError(f"{instance_id}: effective capacity is zero")
    target_demand_hours = demand_tightness * capacity

    demand = _build_demand(
        rng=rng,
        n_days=n_days,
        shifts=shifts,
        skills=skills,
        supervisor_skill=supervisor_skill,
        employees=employees,
        target_person_hours=target_demand_hours,
        demand_tightness=demand_tightness,
        domain=domain,
    )

    inst = Instance(
        id=instance_id,
        horizon_days=n_days,
        start_date=start_date,
        currency="EUR",
        skills=skills,
        supervisor_skill=supervisor_skill,
        shifts=shifts,
        employees=employees,
        demand=demand,
        rules=skeleton.rules,
        weights=Weights(),
    )

    achieved = achieved_tightness(inst)
    if abs(achieved - demand_tightness) > TIGHTNESS_TOL:
        raise RuntimeError(
            f"{instance_id}: achieved tightness {achieved:.4f} outside "
            f"±{TIGHTNESS_TOL} of target {demand_tightness:.4f} "
            f"(demand_h={demand_person_hours(inst):.1f}, "
            f"effective_cap={effective_capacity(inst):.1f})"
        )
    return inst


def _build_demand(
    *,
    rng: np.random.Generator,
    n_days: int,
    shifts: list[Shift],
    skills: list[str],
    supervisor_skill: str,
    employees: list[Employee],
    target_person_hours: float,
    demand_tightness: float,
    domain: Domain,
) -> list[DemandEntry]:
    """Shape a daily demand curve and scale to the target person-hours."""
    open_start = min(s.start_period for s in shifts)
    open_end = max(s.end_period for s in shifts)
    all_periods = list(range(open_start, open_end))
    allow_local_shortfall = demand_tightness > 1.0

    pool: dict[tuple[int, int, str], int] = {}
    for d in range(n_days):
        for p in all_periods:
            for sk in skills:
                pool[(d, p, sk)] = _local_pool(employees, shifts, d, p, sk)

    # Normal instances: only open periods a supervisor can cover (C6 hard).
    day_periods: list[tuple[int, int]] = []
    for d in range(n_days):
        for p in all_periods:
            if allow_local_shortfall or pool[(d, p, supervisor_skill)] >= 1:
                day_periods.append((d, p))

    mid = 0.5 * (open_start + open_end)
    primary = [sk for sk in skills if sk != supervisor_skill]
    skill_share: dict[str, float] = {}
    if primary:
        skill_share[primary[0]] = 0.55
        for sk in primary[1:]:
            skill_share[sk] = 0.25 / max(len(primary) - 1, 1)
    skill_share[supervisor_skill] = 0.20

    raw: dict[tuple[int, int, str], float] = {}
    for d, p in day_periods:
        day_scale = 1.15 if d in (5, 6) and domain != "clinic" else 1.0
        if domain == "clinic" and d == 6:
            day_scale = 0.55
        r = 0.45 + 0.55 * np.exp(-0.5 * ((p - mid) / 12.0) ** 2)
        if domain in ("cafe", "retail"):
            r += 0.35 * np.exp(-0.5 * ((p - 48) / 6.0) ** 2)
        for sk, share in skill_share.items():
            load = float(r * day_scale * share)
            if load < 0.08:
                continue
            raw[(d, p, sk)] = load

    unit_hours = sum(raw.values()) * 0.25
    scale = (target_person_hours / unit_hours) if unit_hours > 0 else 1.0

    demand_map: dict[tuple[int, int, str], int] = {}
    for (d, p, sk), load in raw.items():
        req = int(round(load * scale))
        if req <= 0:
            continue
        local = pool[(d, p, sk)]
        if not allow_local_shortfall:
            if local <= 0:
                continue
            req = min(req, local)
            if sk == supervisor_skill:
                req = min(req, 1)
        else:
            req = max(1, req)
        demand_map[(d, p, sk)] = req

    def ph() -> float:
        return sum(demand_map.values()) * 0.25

    primary_skill = primary[0] if primary else skills[0]
    lo = target_person_hours * (1.0 - TIGHTNESS_TOL + 0.005)
    hi = target_person_hours * (1.0 + TIGHTNESS_TOL - 0.005)

    guard = 0
    while ph() < lo and guard < 20000:
        guard += 1
        candidates = [
            key for key, req in demand_map.items()
            if key[2] == primary_skill
            and (allow_local_shortfall or req < pool[key])
        ]
        if not candidates:
            added = False
            for d, p in day_periods:
                key = (d, p, primary_skill)
                local = pool[key]
                if local <= 0 and not allow_local_shortfall:
                    continue
                cur = demand_map.get(key, 0)
                if allow_local_shortfall or cur < local:
                    demand_map[key] = cur + 1
                    added = True
                    break
            if not added:
                break
            continue
        key = candidates[int(rng.integers(0, len(candidates)))]
        demand_map[key] += 1

    guard = 0
    while ph() > hi and guard < 20000:
        guard += 1
        candidates = sorted(
            demand_map.keys(),
            key=lambda k: (k[2] == primary_skill, demand_map[k]),
        )
        if not candidates:
            break
        key = candidates[0]
        demand_map[key] -= 1
        if demand_map[key] <= 0:
            del demand_map[key]

    # Deliberately create local skill shortfalls on over-constrained instances
    # so diagnose check (1) fails (tight_20's job), then rebalance hours.
    if allow_local_shortfall and demand_map:
        peak = sorted(
            demand_map.keys(),
            key=lambda k: demand_map[k],
            reverse=True,
        )[:12]
        for key in peak:
            demand_map[key] = max(demand_map[key], pool[key] + 1)
        guard = 0
        while ph() > hi and guard < 20000:
            guard += 1
            reducible = [
                k for k in demand_map
                if k not in peak and demand_map[k] > 1
            ]
            if not reducible:
                reducible = [k for k in demand_map if demand_map[k] > pool[k] + 1]
            if not reducible:
                break
            key = reducible[0]
            demand_map[key] -= 1

    return [
        DemandEntry(
            day=d,
            period=p,
            skill=sk,
            required=req,
            criticality=(
                1.2
                if domain in ("cafe", "retail") and 44 <= p <= 56
                else 1.0
            ),
        )
        for (d, p, sk), req in sorted(demand_map.items())
        if req > 0
    ]


# Scaling family: fixed tightness 0.80, vary size.
# Tightness family: fixed n=40 retail, vary tightness.
PRESETS: dict[str, dict] = {
    "cafe_08": dict(
        instance_id="cafe_08", n_employees=8, domain="cafe",
        demand_tightness=0.80, availability_density=0.78, seed=108,
    ),
    "cafe_18": dict(
        instance_id="cafe_18", n_employees=18, domain="cafe",
        demand_tightness=0.80, availability_density=0.75, seed=118,
    ),
    # Cross-family controls for H2 (size vs shift-template confound).
    "cafe_40": dict(
        instance_id="cafe_40", n_employees=40, domain="cafe",
        demand_tightness=0.80, availability_density=0.72, seed=140,
    ),
    "retail_10": dict(
        instance_id="retail_10", n_employees=10, domain="retail",
        demand_tightness=0.80, availability_density=0.78, seed=110,
    ),
    "clinic_25": dict(
        instance_id="clinic_25", n_employees=25, domain="clinic",
        demand_tightness=0.80, availability_density=0.74, seed=125,
    ),
    "retail_40_loose": dict(
        instance_id="retail_40_loose", n_employees=40, domain="retail",
        demand_tightness=0.65, availability_density=0.72, seed=14065,
    ),
    "retail_40": dict(
        instance_id="retail_40", n_employees=40, domain="retail",
        demand_tightness=0.80, availability_density=0.72, seed=14080,
    ),
    "retail_40_tight": dict(
        instance_id="retail_40_tight", n_employees=40, domain="retail",
        demand_tightness=0.95, availability_density=0.72, seed=14095,
    ),
    "retail_60": dict(
        instance_id="retail_60", n_employees=60, domain="retail",
        demand_tightness=0.80, availability_density=0.70, seed=160,
    ),
    "tight_20": dict(
        instance_id="tight_20", n_employees=20, domain="cafe",
        demand_tightness=1.35, availability_density=0.55, seed=220,
    ),
}


def write_presets(out_dir: Path) -> list[Instance]:
    out_dir.mkdir(parents=True, exist_ok=True)
    # Remove stale instance files we no longer emit.
    keep = {f"{name}.json" for name in PRESETS}
    for path in out_dir.glob("*.json"):
        if path.name not in keep:
            path.unlink()

    instances: list[Instance] = []
    for name, kwargs in PRESETS.items():
        inst = generate(**kwargs)
        path = out_dir / f"{name}.json"
        path.write_text(inst.model_dump_json(indent=2) + "\n", encoding="utf-8")
        instances.append(inst)
    return instances


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--out",
        type=Path,
        default=Path(__file__).resolve().parents[2] / "data" / "instances",
    )
    args = parser.parse_args()
    instances = write_presets(args.out)
    for inst in instances:
        cap = effective_capacity(inst)
        dph = demand_person_hours(inst)
        print(
            f"{inst.id}: n={len(inst.employees)} "
            f"demand_h={dph:.1f} eff_cap={cap:.1f} "
            f"tightness={dph / cap:.3f} "
            f"sum_max_h={sum(e.max_hours for e in inst.employees):.1f}"
        )


if __name__ == "__main__":
    main()
