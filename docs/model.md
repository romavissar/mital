# The Model

Authoritative mathematical specification. **Every change to `solver/model/` must be reflected here first.** If code and this document disagree, this document is right and the code is a bug.

---

## 1. Notation

### Sets

| Symbol | Code name | Meaning |
|---|---|---|
| $E$ | `employees` | employees, indexed $e$ |
| $D$ | `days` | days in horizon, indexed $d = 0 \dots |D|-1$ |
| $S$ | `shifts` | shift templates, indexed $s$ |
| $T$ | `periods` | 15-minute blocks within a day, indexed $t = 0 \dots 95$ |
| $K$ | `skills` | skills/roles, indexed $k$ |
| $W \subseteq D$ | `weekend_days` | days flagged as undesirable |
| $S^{cl} \subseteq S$ | `closing_shifts` | shifts flagged as undesirable |

### Parameters

| Symbol | Code name | Type | Meaning |
|---|---|---|---|
| $a_{s,t}$ | `covers[s][t]` | binary | shift $s$ is on duty during period $t$ |
| $r_{t,k,d}$ | `demand[d][t][k]` | int ≥ 0 | required headcount with skill $k$ |
| $q_{e,k}$ | `has_skill[e][k]` | binary | employee $e$ holds skill $k$ |
| $v_{e,s,d}$ | `available[e][s][d]` | binary | employee $e$ can work shift $s$ on day $d$ |
| $b_{e,d}$ | `absences[e][d]` | binary | employee $e$ is marked sick or out on day $d$ |
| $c_e$ | `wage[e]` | float | regular hourly wage |
| $c^{OT}_e$ | `ot_wage[e]` | float | manager-entered extra overtime cost per hour; $c^{OT}_e \ge c_e$ in hourly mode |
| $M_e$ | `monthly_salary[e]` | float | fixed monthly salary in salary mode |
| $\ell_s$ | `paid_hours[s]` | float | paid hours in shift $s$ (breaks already deducted) |
| $p_{e,s,d}$ | `penalty[e][s][d]` | float ≥ 0 | preference penalty, 0 = wanted |
| $H^{\min}_e, H^{\max}_e$ | `min_hours`, `max_hours` | float | contracted weekly bounds |
| $O^{\max}_e$ | `max_overtime[e]` | float | overtime cap |
| $\hat{x}_{e,s,d}$ | `published[e][s][d]` | binary | previously published schedule (repair mode only) |
| $L, U$ | `min_people_per_shift`, `max_people_per_shift` | int | preferred minimum and hard maximum total staff on each shift with demand; $U$ may be absent |

## 2. Decision variables

| Variable | Domain | Meaning |
|---|---|---|
| $x_{e,s,d}$ | $\{0,1\}$ | employee $e$ works shift $s$ on day $d$ |
| $o_e$ | $[0, O^{\max}_e]$ | overtime hours for $e$ |
| $u_{t,k,d}$ | $\ge 0$ | understaffing slack (skill coverage) |
| $u^{\mathrm{sup}}_{d,t}$ | $\ge 0$ | supervisor-absence slack on an open period with regular staff |
| $u^{\min}_e$ | $\ge 0$ | hours short of contracted minimum for $e$ |
| $u^{\mathrm{shift}}_{s,d}$ | $\ge 0$ | staff short of the preferred shift minimum |
| $z$ | $\ge 0$ | max absolute deviation from mean hours |
| $z^W$ | $\ge 0$ | max deviation in weekend-shift count |
| $z^{cl}$ | $\ge 0$ | max deviation in closing-shift count |
| $\delta^+_{e,s,d}, \delta^-_{e,s,d}$ | $\ge 0$ | repair-mode deviation from published schedule |

**Variable elimination.** Never create $x_{e,s,d}$ when $v_{e,s,d} = 0$, $b_{e,d}=1$, or when $e$ holds no skill any period of $s$ requires. This is the single largest model-size win and must happen at construction, not as a fixing constraint.

Convenience expression (not a variable — do not add it as one):

$$h_e \;=\; \sum_{s \in S}\sum_{d \in D} \ell_s\, x_{e,s,d} \qquad \text{(assigned hours)}$$

---

## 3. Hard constraints

### C1 — Coverage

$$\sum_{e \in E}\sum_{s \in S} a_{s,t}\, q_{e,k}\, x_{e,s,d} \;+\; u_{t,k,d} \;\ge\; r_{t,k,d} \qquad \forall d \in D,\; t \in T,\; k \in K$$

Skip generation entirely when $r_{t,k,d} = 0$ (closed hours). The slack $u$ keeps coverage shortages from making the model infeasible. Other hard constraints or conflicting pins can still make a solve infeasible; the app must show that result rather than invent assignments.

For rosters with explicit shift headcount settings, entries for the designated supervisor skill are handled by C6 instead of C1 when a distinct regular-employee role exists. This permits a one-person shift without a supervisor and avoids requiring one when no regular employee works. Legacy rosters with neither setting retain their original C1 and C6 semantics. Other skill demand remains independent of the people-per-shift cap; conflicting settings produce visible shortfalls.

### C2 — At most one shift per employee per day

$$\sum_{s \in S} x_{e,s,d} \;\le\; 1 \qquad \forall e \in E,\; d \in D$$

### C3 — Contracted hours with overtime

$$h_e \;\le\; H^{\max}_e + o_e \qquad \forall e$$
$$h_e + u^{\min}_e \;\ge\; H^{\min}_e \qquad \forall e$$

The manager-entered upper bound stays hard. The lower bound is soft: $u^{\min}_e$ absorbs shortfalls when availability and staffing needs prevent meeting contracted hours.

### Regional work rules

The app no longer imposes daily rest, weekly rest, consecutive-day, or country-specific hour limits. Legacy fields in saved rosters are accepted for compatibility and ignored by scheduling. Managers remain responsible for any regional or contractual rules outside the app.

### C6 — Supervisor presence

Let $S_{d,t}$ count assigned staff with the designated supervisor skill, and $W_{d,t}$ count assigned staff without it. For each open period, require supervision only when at least one regular employee works and the configured maximum permits a pair:

$$S_{d,t} + u^{\mathrm{sup}}_{d,t} \ge a_{s,t}x_{e,s,d} \qquad \forall e\text{ without supervisor skill},s,d,t\text{ open},\;(U \ne 1)$$

Thus a working regular employee requires one supervisor or one unit of slack. The slack is continuous, but a missing supervisor forces it to at least 1. This avoids a binary variable for every 15-minute period.

On each shift, supervisors may not outnumber regular employees: $\sum_{e:q_{e,k^\*}=1}x_{e,s,d} \le \sum_{e:q_{e,k^\*}=0}x_{e,s,d}$. This prevents a supervisor working that shift alone. A one-person maximum exempts regular employees from the supervisor-presence rule, since requiring two people would contradict the cap. This coupling applies to rosters with explicit shift headcount settings when a distinct regular employee role exists; legacy rosters retain the prior open-period supervisor rule. The slack keeps a missing supervisor feasible and separately reported; it is zero when no employee is on duty under the new rule.

### C9 — People per shift

For every shift/day with positive demand in any covered period, let $N_{s,d}=\sum_e x_{e,s,d}$. Enforce $N_{s,d} \le U$ when a maximum is configured and $N_{s,d}+u^{\mathrm{shift}}_{s,d} \ge L$. The minimum is soft so shortages of available staff remain visible instead of making the whole schedule infeasible. Inactive shifts have no minimum; the maximum still applies. Legacy rosters with no explicit bounds do not activate this new minimum.

Publishing requires every open period to have someone working and every active shift to meet its configured minimum. When the current roster cannot do that, keep the result as a draft and show coverage or hiring suggestions.

For modern staffing rosters, use a penalty $P_{\mathrm{shift}}$ for each missing person on an active shift, chosen above a conservative upper bound on all other objective terms for that instance. This makes the solver minimize unmet shift headcount before wages, fairness, and preferences while retaining a feasible result if staff cannot cover all shifts. Report remaining gaps explicitly; a schedule cannot be guaranteed fully covered when availability, skills, hours, or the maximum make it impossible.

### C7 — Fairness linearization (min–max)

$$z \;\ge\; h_e - \bar h, \qquad z \;\ge\; \bar h - h_e \qquad \forall e$$

where $\bar h = \frac{1}{|E|}\sum_{e} h_e$ is an affine expression in $x$, **not** a parameter. Both directions are required; one-sided gives you a bound, not fairness.

Analogous pairs define $z^W$ over weekend counts and $z^{cl}$ over closing counts.

---

## 4. Objective

$$\min \;\; \underbrace{\sum_{e,s,d} c_e \ell_s x_{e,s,d} \;+\; \sum_e c^{OT}_e o_e}_{\text{COST}}
\;+\; \underbrace{\lambda_u \sum_{d,t,k} \omega_{t} \, u_{t,k,d} \;+\; P_{\mathrm{shift}} \sum_{s,d} u^{\mathrm{shift}}_{s,d} \;+\; \lambda_{\mathrm{sup}} \sum_{d,t} u^{\mathrm{sup}}_{d,t} \;+\; \lambda_{\min} \sum_e u^{\min}_e}_{\text{UNDERSTAFFING}}
\;+\; \underbrace{\lambda_f \, F}_{\text{UNFAIRNESS}}
\;+\; \underbrace{\lambda_p \sum_{e,s,d} p_{e,s,d}\, x_{e,s,d}}_{\text{DISSATISFACTION}}$$

The formula above is the legacy `hourly` mode. With `pay_basis = monthly_salary`, replace the regular-pay sum with the fixed planning allocation $\sum_e\sum_{d\in D} M_e / \mathrm{daysInMonth}(d)$, using each schedule date's calendar month. It is paid in the model even if an employee has no assigned shift, so moving ordinary hours between salaried employees does not create false salary savings. The overtime term remains $\sum_e c^{OT}_e o_e$, where the manager enters an estimated extra cost per overtime hour. `objective.wages` carries the regular-pay term in both modes for JSON compatibility. The model does not calculate payroll or legal overtime compensation; the [Romanian Labour Code](https://legislatie.just.ro/Public/DetaliiDocument/302142) provides for time-off compensation and, in specified circumstances, additional pay (Arts. 122–123).

The unfairness measure $F$ is **mode-dependent** (selected by `FairnessMode`, §5) — not the sum of every fairness variable unconditionally:

| Mode | $F$ |
|---|---|
| `MINMAX_HOURS` (default) | $z$ |
| `EQUITY_UNDESIRABLE` | $z + z^W + z^{cl}$ |
| `LEXIMIN` | (sequential; not a single weighted term — §5.3) |

$z$, $z^W$, and $z^{cl}$ are always present in the model (C7 and its weekend/closing analogues); modes that omit a component simply leave it out of $F$ and therefore out of the objective. The ε-constraint (§8) bounds the same $F$ the mode uses.

The understaffing block is reported as three inspector lines: ordinary coverage penalty, supervisor-gap penalty (and count), and min-hours shortfall — never collapsed into one unlabeled number.

### Weight defaults and scale

| Weight | Default | Reasoning |
|---|---|---|
| $\lambda_u$ | 500 | per person-period uncovered. Must exceed the cost of any single shift so the solver never trades coverage for wages |
| $\lambda_{\mathrm{sup}}$ | 900 | per unsupervised open period. Above $\lambda_u$: a shift with nobody in charge is worse than a merely thin one |
| $\lambda_{\min}$ | 400 | per hour below contracted minimum. Must sit **above** $\lambda_f$: a contracted minimum is a manager-entered commitment, fairness is a preference. Slack exists only for when availability or staffing limits make $H^{\min}$ genuinely unreachable — not so the solver can steal an hour for equity |
| $\lambda_f$ | 100 | per hour of max deviation. Must clear typical wage differentials on a 40-person roster; 25 left fairness non-binding on `retail_40` (rebalance cost ≈ €500–600 to cut $z$ by ~14h) |
| $\lambda_p$ | 5 | per unit of preference penalty |
| $\omega_t$ | 1.0 | period criticality multiplier, ≥ 1 for peak blocks |

**Solve order.** Hard constraints always apply. Before minimizing the weighted objective, the solver minimizes shift staffing shortfall, then supervision shortfall, then contracted-hour shortfall. It fixes each minimum before solving the next stage. The final weighted objective chooses among schedules at those minimum shortfall levels. Skill-period coverage, cost, fairness, and preferences are compared in that final stage.

**Scale discipline.** All four terms must land within ~2 orders of magnitude of each other on a typical instance, or the solver spends its time on one and ignores the rest. `solver/model/objectives.py` must expose each term separately so the solve inspector can break down the objective, and the benchmark suite asserts the terms stay in range.

---

## 5. Fairness — three variants

Selected by `FairnessMode`. The interactive app uses `MINMAX_HOURS`; `EQUITY_UNDESIRABLE` is available in the solver. `LEXIMIN` is a design sketch.

### 5.1 `MINMAX_HOURS` (default, interactive)
C7 above. One extra variable, $2|E|$ rows. Controls the extremes only — two employees can be equally far from the mean in opposite directions and the metric will not notice the pair.

### 5.2 `EQUITY_UNDESIRABLE`
C7 plus the weekend and closing variants, weighted separately. Closer to what staff actually perceive as fair, since "same hours" and "same misery" are different quantities.

### 5.3 `LEXIMIN` (not implemented)
Proposed lexicographic max–min method: repeatedly maximize the hours of the worst-off unfixed employee and fix that value before continuing. The current solver rejects this mode.

### Reported, never optimized
Gini coefficient and Jain's index are computed post-solve for evaluation. Both are nonlinear; do not attempt to put either in the objective.

---

## 6. Demand generation (Erlang C)

Given forecast arrival rate $\lambda_t$ (customers/hour) and mean service time $1/\mu$ hours:

$$R_t = \frac{\lambda_t}{\mu} \qquad\text{(offered load, erlangs)}$$

$$r_t \;=\; \left\lceil R_t + \beta\sqrt{R_t} \right\rceil$$

$\beta$ is the quality-of-service parameter, solved numerically from the Erlang C target (e.g. $P(\text{wait} > 2\text{ min}) \le 0.2$). Floor at $r_t \ge 1$ during open hours.

This module is independent of the MILP and unit-tested against published Erlang C tables.

---

## 7. Sensitivity analysis

After the MILP solves:

1. Fix all $x_{e,s,d}$ to their integer values.
2. Re-solve as an LP.
3. Extract duals.

| Quantity | Interpretation shown to the user |
|---|---|
| Dual of C1 at $(t,k,d)$ | marginal weekly cost of requiring one more $k$ in that block |
| Dual of C6 | marginal cost of the supervisor rule in that block |
| Reduced cost of an unused $x_{e,s,d}$ | how much cheaper $e$ would need to be to enter the schedule |
| RHS ranging on C3 | range over which contracted hours can move without changing the basis |

**Caveat that must appear in the UI copy:** these are duals of the LP *at the fixed integer solution*, not of the MILP. They are valid locally and are a guide, not a guarantee. Do not let the interface imply otherwise.

---

## 8. Multi-objective — ε-constraint

To trace the cost–fairness frontier:

$$\min \;\text{COST} + \text{UNDERSTAFFING} \qquad \text{s.t.} \qquad F \;\le\; \varepsilon_i$$

where $F$ is the active mode's unfairness measure from §4 ($z$ under `MINMAX_HOURS`; $z+z^W+z^{cl}$ under `EQUITY_UNDESIRABLE`).

Procedure:
1. Solve with $\lambda_f = 0$ → cost-optimal point, gives $\varepsilon_{\max}$.
2. Solve pure fairness → fairness-optimal point, gives $\varepsilon_{\min}$.
3. Sweep $n$ (default 12) evenly spaced $\varepsilon_i$ on the band whose understaffing is no worse than the cost endpoint. This is zero understaffing when possible; a constrained business with unavoidable gaps retains its best attainable staffing level. Drop worse-coverage points rather than presenting them as fairness choices.
4. **Warm-start each solve from solution $i-1$.** Without this the sweep is 12× the cost of a single solve; with it, roughly 3×.
5. Drop dominated points; return the frontier sorted by cost. If only one valid point remains, return it so the interface can show the available schedule without an empty dial.

For modern staffing rosters, use a wider sweep of fairness weights instead of the legacy ε sweep. Keep only schedules at the smallest observed shortfall against the configured minimum people per shift. Remove duplicate rosters and choices dominated across pay, fairness, skill shortfall, and supervision gaps. A schedule that costs more and distributes hours less evenly may still be useful when it improves supervision. Show these coverage dimensions beside every choice. Every shown point is a real solver result; remaining gaps must be visible in review. Never pad the dial with duplicate or invented choices.

Each returned point is a feasible schedule with its remaining staffing gaps reported in review. The UI dial shows real solutions, never interpolations between them.

---

## 9. Repair mode

Given a published $\hat{x}$ and a disruption (employee unavailable, demand change):

$$\min \;\text{COST} + \text{UNDERSTAFFING} + \lambda_s \sum_{e,s,d} \left(\delta^+_{e,s,d} + \delta^-_{e,s,d}\right)$$

subject to all of §3 plus

$$x_{e,s,d} - \hat{x}_{e,s,d} = \delta^+_{e,s,d} - \delta^-_{e,s,d}$$

Default $\lambda_s = 60$ — roughly "one hour of wages per changed assignment." Warm-start from $\hat{x}$; these solve in well under a second because the incumbent is already near-optimal.

---

## 10. Scaling

### 10.1 Symmetry breaking
Partition employees into equivalence classes by (wage, skill set, availability pattern, contract bounds). Within a class, impose a lexicographic order on assignment vectors. Large branch-and-bound win on instances with many identical casual staff; measurable in the benchmark suite.

### 10.2 Column generation (stretch)
Reformulate over feasible weekly patterns $\Omega_e$ per employee:

$$\min \sum_{e}\sum_{\pi \in \Omega_e} c_{e\pi}\, y_{e\pi} \quad\text{s.t.}\quad \sum_{e}\sum_{\pi} a_{\pi,t,k}\, y_{e\pi} + u_{t,k,d} \ge r_{t,k,d}, \quad \sum_{\pi} y_{e\pi} = 1$$

**Pricing subproblem:** shortest path with resource constraints on a per-employee DAG whose nodes are (day, shift) and whose resources are cumulative hours and consecutive days. Solved by dynamic programming. Reduced cost of pattern $\pi$ uses the duals $\pi_{t,k}$ of coverage and $\sigma_e$ of convexity.

Regional rules are outside the app's scheduling model.

Branch on the original $x_{e,s,d} = \sum_{\pi \ni (s,d)} y_{e\pi}$, never on the $y$ variables.

---

## 11. Known modeling pitfalls

Recurring errors; check against this list before committing a constraint.

2. **Mean hours treated as a constant.** $\bar h$ depends on $x$ (assigned hours differ from contracted hours). Keep it an affine expression.
3. **One-sided fairness.** Both $z \ge h_e - \bar h$ *and* $z \ge \bar h - h_e$.
4. **Hard coverage.** Any formulation that can return INFEASIBLE for a realistic instance is a regression. **Any constraint that expresses a coverage requirement (skill headcount, supervisor presence, contracted minimum hours as a service promise) needs slack.** C2 and the manager-entered $H^{\max}$ cap stay hard.
6. **Overtime free-riding.** Without $c^{OT}_e \ge c_e$ and a cap, the solver will happily overtime one person to avoid a second hire.
7. **Generating variables for unavailable pairs.** Model size explodes and every solve slows for no benefit.
8. **Weight scales drifting.** After any objective change, re-run `bench/objective_scale_check.py`.
9. **Bare supervisor $\ge 1$.** Same failure mode as hard C1. Always pair C6 with $u^{\mathrm{sup}}$.
