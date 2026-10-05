# Data Contract

The JSON boundary between `solver/` and `web/`. Both sides validate against this; neither invents fields. Changes here require updating `solver/schemas.py` (Pydantic) and `web/lib/types.ts` (TypeScript) **in the same commit**.

Times are ISO-8601. Periods are 15-minute blocks indexed `0..95` from local midnight. Money is a float in the instance's accounting `currency`. All IDs are opaque strings. A Romanian business created in the desktop app uses RON unless the manager chooses another accounting currency.

---

## Instance

```jsonc
{
  "id": "inst_2026w31",
  "horizon_days": 7,
  "start_date": "2026-08-03",
  "currency": "EUR",
  "pay_basis": "hourly",         // hourly (default) | monthly_salary

  "skills": ["barista", "keyholder", "kitchen"],
  "supervisor_skill": "keyholder",

  "shifts": [
    {
      "id": "open",
      "label": "Opening",
      "start_period": 24,        // 06:00
      "end_period": 56,          // 14:00
      "paid_hours": 7.5,         // breaks deducted
      "undesirable": false,
      "closing": false
    }
  ],

  "employees": [
    {
      "id": "e_014",
      "name": "Ana",
      "wage": 13.50,
      "ot_wage": 20.25,
      "monthly_salary": null,      // positive amount required in monthly_salary mode
      "shift_worker": false,       // legacy saved field; ignored
      "skills": ["barista", "keyholder"],
      "min_hours": 0,
      "max_hours": 40,
      "max_overtime": 8,
      "max_consecutive_days": 5, // legacy saved field; ignored
      // sparse: only days/shifts the employee CAN work. Omitted = unavailable.
      "availability": [
        { "day": 0, "shifts": ["open", "mid"] },
        { "day": 1, "shifts": ["open"] }
      ],
      // sparse: only nonzero penalties. Omitted = 0 (neutral).
      "preferences": [
        { "day": 5, "shift": "close", "penalty": 4 }
      ],
      "absences": [] // {"day": 2, "reason": "sick" | "out"}; removes all shifts that day
    }
  ],

  // sparse: only nonzero requirements. Omitted = closed / no demand.
  "demand": [
    { "day": 0, "period": 32, "skill": "barista", "required": 3, "criticality": 1.0 }
  ],

  "rules": {
    "min_rest_hours": 0, // legacy saved field; ignored
    "min_people_per_shift": 1, // preferred minimum on active shifts
    "max_people_per_shift": null, // optional hard cap; 1 allows a regular employee to work alone
    "supervision_required": null, // true blocks publishing unsupervised work; false permits it; null preserves earlier behavior
    "weekend_days": [5, 6],
    "romania_policy": false,       // legacy saved field; ignored
    "previous_week_known": false,
    "previous_week_start": null,
    "previous_work": []           // published prior assignments, days -7..-1
  },

  "weights": {
    "understaffing": 500,
    "supervisor": 900,
    "min_hours": 400,
    "fairness": 100,
    "preference": 5,
    "stability": 60
  }
}
```

### Invariants (validated before solve and publish)

Desktop draft autosave accepts incomplete setup, such as a new salaried employee whose salary is not yet entered. The solver validates the complete instance before a solve, and a published roster requires a valid instance and solution.

- Every `skills` reference in employees and demand exists in the top-level `skills`.
- Every shift reference in availability and preferences exists in `shifts`.
- An employee may have at most one sick/out absence per day; an absent employee cannot be assigned that day. The original availability remains intact for later restoration.
- `end_period > start_period`; overnight shifts are modeled as two entries, not wraparound.
- `paid_hours ≤ (end_period − start_period) / 4`.
- In hourly mode, `ot_wage ≥ wage`. In monthly-salary mode, every employee has a positive `monthly_salary`; `wage` is retained for switching back to hourly and is ignored by the salary objective. `ot_wage` is the manager's estimated extra cost per overtime hour in either mode.
- `max_hours ≥ min_hours`, `criticality ≥ 1.0`.
- `min_people_per_shift` is a nonnegative integer; an optional `max_people_per_shift` is at least 1 and at least the minimum. The maximum is firm; the minimum is reported as a soft shortage when staffing is unavailable.
- `0 ≤ day < horizon_days`.
- Legacy work-rule fields are accepted when loading older saved rosters but are not enforced.

The `objective.wages` field means regular pay cost in both modes. In hourly mode it is scheduled hours × wage. In monthly-salary mode it is the fixed salary allocation for every employee across the schedule's calendar days, even if they receive no shifts. The allocation sums `monthly_salary / days_in_that_month` for each date in the horizon, including when a week crosses a month boundary. Overtime remains `overtime_hours × ot_wage`. These are schedule-planning costs, not payroll or a determination of overtime compensation under Romanian law.

A time-limited solve with a valid integer incumbent is reported as `feasible`; its `mip_gap` shows how far it may be from the optimum. `timeout` means no publishable incumbent was found before the limit.

Regional work-rule fields in older saves are accepted but ignored by the solver. The app enforces the manager-entered staffing, availability, and hours settings shown in the UI.

---

## Solve request

```jsonc
{
  "instance": { /* Instance */ },
  "mode": "solve",                    // solve | pareto | repair
  "fairness": "minmax_hours",         // minmax_hours | equity_undesirable | leximin
  "time_limit_s": 5.0,
  "mip_gap": 0.01,
  "pins": [                           // manager drag-to-pin, becomes a fixed variable
    { "employee": "e_014", "day": 2, "shift": "mid", "value": 1 }
  ],
  "pareto_points": 12,                // mode=pareto only
  "published": { /* Solution */ }     // mode=repair only
}
```

---

## Solution

```jsonc
{
  "status": "optimal",                // optimal | feasible | infeasible | timeout
  "mip_gap": 0.004,
  "solve_time_s": 3.12,
  "solver": "highs",

  "assignments": [
    { "employee": "e_014", "day": 0, "shift": "open" }
  ],

  "objective": {
    "total": 8421.50,
    "wages": 7980.00,
    "overtime": 216.50,
    "understaffing": 0.0,          // λ_u · Σ ω u  (coverage penalty only)
    "supervisor_penalty": 0.0,     // λ_sup · Σ u_sup
    "supervisor_gap": 0,           // count of open periods with u_sup > 0
    "min_hours_penalty": 0.0,      // λ_min · Σ u_min
    "unfairness": 175.00,
    "preference": 50.00
  },

  // Distinct from len(uncovered) and from understaffing penalty:
  "uncovered_entry_count": 0,       // # of (day, period, skill) C1 rows with shortfall > 0
  "shortfall_person_periods": 0.0,  // Σ shortfall over those C1 rows (raw headcount-periods)

  "per_employee": [
    {
      "employee": "e_014",
      "hours": 37.5,
      "overtime_hours": 0,
      "weekend_shifts": 1,
      "closing_shifts": 2,
      "cost": 506.25,
      "preference_penalty": 4
    }
  ],

  "fairness": {
    "mode": "minmax_hours",
    "max_deviation_hours": 7.0,
    "gini": 0.081,
    "jain": 0.976,
    "weekend_spread": 1,
    "closing_spread": 2
  },

  // C1 skill gaps and C6 supervisor gaps. Supervisor rows use skill =
  // supervisor_skill and shortfall 1 when u_sup > 0.
  "uncovered": [
    { "day": 6, "period": 76, "skill": "keyholder", "shortfall": 1 }
  ],

  "duals": {
    "coverage": [
      {
        "day": 5, "period": 72, "skill": "barista",
        "shadow_price": 0.0,
        "provenance": "degenerate",   // fixed_lp | relaxation | degenerate
        "binding": true,
        "relaxation_price": 142.81    // never silently copied into shadow_price
      }
    ],
    "supervisor": [
      {
        "day": 5, "period": 72, "skill": "keyholder",
        "shadow_price": 900.0,
        "provenance": "fixed_lp",
        "binding": true,
        "relaxation_price": null
      }
    ],
    "reduced_costs": [
      { "employee": "e_022", "day": 3, "shift": "mid", "reduced_cost": 18.40 }
    ],
    "note": "LP duals at the fixed integer solution; locally valid guidance, not MILP-exact. Each dual carries a provenance tag (fixed_lp | relaxation | degenerate) — never substitute one for another silently. Supervisor duals are from a soft constraint (u_sup): a fully saturated unsupervised period prices at λ_sup rather than the true hard marginal cost of finding a keyholder."
  },

  "gap_trace": [
    { "t": 0.4, "incumbent": 9310.0, "bound": 7902.0 },
    { "t": 3.1, "incumbent": 8421.5, "bound": 8387.8 }
  ]
}
```

`duals` is populated only when the request asks for it (`?duals=true`) — the extra LP re-solve is not free.

---

## Pareto response

```jsonc
{
  "frontier": [
    {
      "epsilon": 14.0,
      "cost": 8102.00,
      "max_deviation_hours": 13.5,
      "solution": { /* full Solution */ }
    }
  ],
  "total_solve_time_s": 9.4,
  "source": "cache",              // cache | live
  "cache_note": "…"               // optional; explain hit/miss
}
```

Sorted ascending by cost. Every point is non-dominated, understaffing-free, and independently publishable. The ε-sweep is confined to the practical band $[z_{\min}^{\mathrm{cov}},\,z_{\max}]$ (understaffing stays zero); cliff points are dropped, never padded with dominated solutions. The UI dial interpolates **nothing** — it snaps between these solutions.

**Dial minimum.** If `frontier.length < 4`, the UI does **not** show the tradeoff dial. It shows a static schedule and a short note that this instance has too few distinct cost–fairness tradeoffs to browse. Do not invent intermediate stops.

**Frontier cache (limitation).** Committed instances may have a precomputed frontier in `data/frontiers/{id}.json`, keyed by a canonical SHA-256 of the instance. `POST /pareto` returns `source: "cache"` only when the request instance hashes to that file, fairness is `minmax_hours`, and `pins` is empty. Any pin, availability/demand/weight edit, or hash mismatch must miss the cache (`source: "live"`). The UI must **hide the dial or mark it stale** in that state — never show cached stops against a modified instance. Live sweeps take 30–60 s at demo sizes; the cache demonstrates the ε-constraint method without pretending interactive re-optimization is free. That wall is H3 evidence (column generation), not a product feature.

---

## Margins response

```jsonc
{
  "margins": [
    {
      "day": 5,
      "period": 48,
      "skill": "barista",
      "delta": 42.0,              // exact MILP objective change — the only € quote
      "provenance": "relaxation", // LP dual tag only — never quote as €
      "binding": true,
      "required": 2,
      "shadow_price": -12.5,
      "message": "…"
    }
  ],
  "compute_time_s": 25.8,
  "source": "sampled",            // exact_precomputed | sampled
  "note": "…"
}
```

**Margins cache.** Committed instances may have exhaustive exact Δs in `data/margins/{id}.json` (built offline by `python -m mital_solver.bench.margins`), keyed by instance SHA-256 **and** roster SHA-256. `POST /margins` returns `source: "exact_precomputed"` with true $|\Delta|$ rankings only when both hashes match, fairness is `minmax_hours`, and `pins` is empty. Otherwise `source: "sampled"`: shortlist by $|\pi^{\mathrm{relax}}|$, then exact perturbation. The gutter label is “marginal costs” on the exact path and “sampled marginals” otherwise.

---

## Infeasibility explanation

Returned when understaffing slack is large or a hard constraint set conflicts.

```jsonc
{
  "conflicts": [
    {
      "kind": "no_qualified_staff",
      "day": 6,
      "periods": [72, 80],
      "skill": "keyholder",
      "message": "No keyholder is available Sunday 18:00–20:00.",
      "candidates": [
        { "employee": "e_031", "reason": "unavailable", "fix": "add availability" },
        { "employee": "e_007", "reason": "unavailable for this shift" }
      ]
    }
  ]
}
```

`kind` is a closed enum. Active explanations use `no_qualified_staff`, `hours_cap`, `availability_gap`, and `supervisor_gap`. The old `rest_conflict` and `consecutive_days` values remain accepted for stored reports.

---

## Demand request

```jsonc
{
  "arrivals": [
    { "day": 0, "period": 32, "arrival_rate": 24.0 }  // customers/hour
  ],
  "skill": "barista",
  "mean_service_h": 0.1,           // 1/μ
  "target_p_wait": 0.2,            // P(wait > threshold) ≤ this
  "wait_threshold_h": 0.0333,      // default 2 minutes
  "beta": null,                    // if set, skip Erlang-C β search
  "criticality": 1.0
}
```

Returns sparse `demand[]` (`DemandEntry`) via square-root staffing (docs/model.md §6). Periods with `arrival_rate = 0` are omitted.

---

## Desktop contract (transport and local storage implemented)

The static desktop renderer uses a typed `window.mital` facade exposed by Electron preload. It does not call `http://127.0.0.1:8000`. Electron main validates each request, invokes the Python solver bridge with JSON over standard input/output, and returns the same `Instance`, `Solution`, `ParetoResponse`, and `MarginsResponse` shapes defined above. The Python model remains independent of Electron and the FastAPI development transport. Packaged builds bundle the solver; developer runs use an installed Python package.

The facade has explicit operations: `listBusinesses`, `loadBusiness`, `saveBusiness`, `saveDraft`, `recoverBusiness`, `backupStatus`, `deleteBusiness`, `solver` (allowlisted `solve`, `pareto`, `repair`, `explain`, `demand`, `margins`, and validation), `listSaved`, `getSaved`, `putSaved`, `exportBackup`, `exportCsv`, `importBackup`, `openDataFolder`, and `printRoster`. Benchmark instances are not exposed through desktop IPC. Renderer code receives no arbitrary filesystem path or generic process execution. The process bridge limits request/response size and time, allowlists operations, and uses Pydantic validation of solver payloads. Solver diagnostics go to standard error, not the JSON response channel.

The local document is versioned JSON under the OS `mital` application-data directory, with this shape. The Currency settings control persists display currency and dated manager-entered rates here. Language selection is stored in the same document.

```jsonc
{
  "schema_version": 1,
  "business_id": "opaque-local-id",
  "business_name": "Example SRL",
  "settings": {
    "language": "ro",                 // "ro" | "en"; explicit user selection
    "display_currency": "RON",      // "RON" | "EUR" | "USD"
    "fx": {
      "date": "2026-10-03",
      "source": "manager-entered",
      "ron_per_eur": null,         // positive number required before conversion
      "ron_per_usd": null          // positive number required before conversion
    }
  },
  "draft": { /* Instance */ },
  "published": { /* SavedRoster or null */ }
}
```

The desktop UI uses the OS language to initialize `settings.language` (`ro` for Romanian, otherwise `en`) and persists it with the business document. Manager UI and print translations use that setting. FX values are never fetched remotely. Display conversion uses `amount × RON_per_source / RON_per_target`; solver inputs, published records, and backup JSON keep amounts in the instance's accounting currency. A conversion requires the needed positive rates plus a valid non-future date and nonempty source. Rates older than 30 days are flagged in the interface.

## Current development HTTP endpoints

| Method | Path | Body | Returns |
|---|---|---|---|
| `POST` | `/solve` | Solve request | Solution |
| `POST` | `/pareto` | Solve request, `mode=pareto` | Pareto response |
| `POST` | `/repair` | Solve request, `mode=repair` | Solution |
| `POST` | `/explain` | Instance | Infeasibility explanation |
| `POST` | `/demand` | Arrival forecast + QoS target | `demand[]` for an Instance |
| `POST` | `/margins` | `{instance, solution, pins?}` | Exact coverage Δs for the gutter (`source`: `exact_precomputed` \| `sampled`) |
| `GET` | `/health` | — | solver backend and version |
| `GET` | `/saved` | — | list of saved roster ids |
| `GET` | `/saved/{id}` | — | `{instance, solution?}` |
| `PUT` | `/saved/{id}` | `{instance, solution?}` | saved roster |
| `DELETE` | `/saved/{id}` | — | 204 |

The optional development API still persists JSON files under `data/saved/` — no database. The desktop app stores them under OS application data and can import older `SavedRoster` JSON files. `POST /solve?duals=true` populates `duals` (extra LP re-solve).

The older design mentioned SSE at `/solve/stream`; that endpoint is not implemented in the current API. The desktop bridge must not assume streaming until it has an explicit progress protocol.
