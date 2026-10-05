"""Pydantic models for the solver ↔ web JSON boundary.

Mirrors docs/data-contract.md exactly. Instance invariants from the
Invariants section are enforced on ingest.
"""

from __future__ import annotations

from datetime import date
from enum import Enum
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class Shift(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    label: str
    start_period: int = Field(ge=0, le=95)
    end_period: int = Field(ge=1, le=96)
    paid_hours: float = Field(gt=0)
    undesirable: bool = False
    closing: bool = False

    @model_validator(mode="after")
    def _shift_invariants(self) -> Shift:
        if self.end_period <= self.start_period:
            raise ValueError(
                f"shift {self.id!r}: end_period must be > start_period "
                "(overnight shifts are two entries, not wraparound)"
            )
        span_hours = (self.end_period - self.start_period) / 4.0
        if self.paid_hours > span_hours + 1e-9:
            raise ValueError(
                f"shift {self.id!r}: paid_hours ({self.paid_hours}) exceeds "
                f"span ({span_hours})"
            )
        return self


class PriorWork(BaseModel):
    """An assignment from the immediately preceding published week."""

    model_config = ConfigDict(extra="forbid")

    employee: str
    day: int = Field(ge=-7, le=-1)
    start_period: int = Field(ge=0, le=95)
    end_period: int = Field(ge=1, le=96)
    paid_hours: float = Field(gt=0)

    @model_validator(mode="after")
    def _valid_interval(self) -> PriorWork:
        if self.end_period <= self.start_period or self.paid_hours > (self.end_period - self.start_period) / 4:
            raise ValueError("previous work has invalid shift times or paid hours")
        return self


class AvailabilityEntry(BaseModel):
    model_config = ConfigDict(extra="forbid")

    day: int = Field(ge=0)
    shifts: list[str]


class PreferenceEntry(BaseModel):
    model_config = ConfigDict(extra="forbid")

    day: int = Field(ge=0)
    shift: str
    penalty: float = Field(gt=0)


class AbsenceEntry(BaseModel):
    model_config = ConfigDict(extra="forbid")

    day: int = Field(ge=0)
    reason: Literal["sick", "out"]


class Employee(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    name: str
    wage: float = Field(gt=0)
    ot_wage: float = Field(gt=0)
    monthly_salary: float | None = Field(default=None, gt=0, allow_inf_nan=False)
    shift_worker: bool = False
    skills: list[str]
    min_hours: float = Field(ge=0)
    max_hours: float = Field(ge=0)
    max_overtime: float = Field(ge=0)
    max_consecutive_days: int = Field(default=7, ge=1)  # legacy saved field; no longer enforced
    availability: list[AvailabilityEntry] = Field(default_factory=list)
    preferences: list[PreferenceEntry] = Field(default_factory=list)
    absences: list[AbsenceEntry] = Field(default_factory=list)

    @model_validator(mode="after")
    def _employee_invariants(self) -> Employee:
        if self.max_hours < self.min_hours:
            raise ValueError(
                f"employee {self.id!r}: max_hours ({self.max_hours}) < "
                f"min_hours ({self.min_hours})"
            )
        return self


class DemandEntry(BaseModel):
    model_config = ConfigDict(extra="forbid")

    day: int = Field(ge=0)
    period: int = Field(ge=0, le=95)
    skill: str
    required: int = Field(ge=1)
    criticality: float = 1.0

    @field_validator("criticality")
    @classmethod
    def _criticality_ge_one(cls, v: float) -> float:
        if v < 1.0:
            raise ValueError(f"criticality must be ≥ 1.0, got {v}")
        return v


class Rules(BaseModel):
    model_config = ConfigDict(extra="forbid")

    min_rest_hours: float = 0.0  # legacy saved field; no longer enforced
    min_people_per_shift: int = Field(default=1, ge=0)
    max_people_per_shift: int | None = Field(default=None, ge=1)
    supervision_required: bool | None = None
    weekend_days: list[int] = Field(default_factory=lambda: [5, 6])
    romania_policy: bool = False
    previous_week_known: bool = False
    previous_week_start: str | None = None
    previous_work: list[PriorWork] = Field(default_factory=list)

    @model_validator(mode="after")
    def _staffing_bounds(self) -> Rules:
        if self.max_people_per_shift is not None and self.min_people_per_shift > self.max_people_per_shift:
            raise ValueError("minimum people per shift exceeds maximum")
        if self.supervision_required is True and self.max_people_per_shift == 1:
            raise ValueError("mandatory supervision needs a shift maximum of at least two people")
        return self

    @property
    def requires_supervision(self) -> bool:
        return self.supervision_required if self.supervision_required is not None else self.max_people_per_shift != 1

    @property
    def modern_staffing(self) -> bool:
        return bool({"min_people_per_shift", "max_people_per_shift", "supervision_required"} & self.model_fields_set)


class Weights(BaseModel):
    model_config = ConfigDict(extra="forbid")

    understaffing: float = 500.0
    supervisor: float = 900.0
    min_hours: float = 400.0
    fairness: float = 100.0
    preference: float = 5.0
    stability: float = 60.0


class Instance(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    horizon_days: int = Field(ge=1)
    start_date: str
    currency: str = "EUR"
    pay_basis: Literal["hourly", "monthly_salary"] = "hourly"
    skills: list[str]
    supervisor_skill: str
    shifts: list[Shift]
    employees: list[Employee]
    demand: list[DemandEntry] = Field(default_factory=list)
    rules: Rules = Field(default_factory=Rules)
    weights: Weights = Field(default_factory=Weights)

    @model_validator(mode="after")
    def _instance_invariants(self) -> Instance:
        skill_set = set(self.skills)
        if not self.skills:
            raise ValueError("skills must be non-empty")
        if self.supervisor_skill not in skill_set:
            raise ValueError(
                f"supervisor_skill {self.supervisor_skill!r} not in skills"
            )

        shift_ids = {s.id for s in self.shifts}
        if len(shift_ids) != len(self.shifts):
            raise ValueError("duplicate shift ids")

        emp_ids = {e.id for e in self.employees}
        if len(emp_ids) != len(self.employees):
            raise ValueError("duplicate employee ids")

        for e in self.employees:
            if self.pay_basis == "hourly" and e.ot_wage < e.wage:
                raise ValueError(
                    f"employee {e.id!r}: ot_wage ({e.ot_wage}) < wage ({e.wage})"
                )
            if self.pay_basis == "monthly_salary" and e.monthly_salary is None:
                raise ValueError(f"employee {e.id!r}: monthly_salary is required")
            for sk in e.skills:
                if sk not in skill_set:
                    raise ValueError(
                        f"employee {e.id!r}: unknown skill {sk!r}"
                    )
            for av in e.availability:
                if not (0 <= av.day < self.horizon_days):
                    raise ValueError(
                        f"employee {e.id!r}: availability day {av.day} "
                        f"out of horizon [0, {self.horizon_days})"
                    )
                for sid in av.shifts:
                    if sid not in shift_ids:
                        raise ValueError(
                            f"employee {e.id!r}: unknown shift {sid!r} "
                            "in availability"
                        )
            for pref in e.preferences:
                if not (0 <= pref.day < self.horizon_days):
                    raise ValueError(
                        f"employee {e.id!r}: preference day {pref.day} "
                        f"out of horizon [0, {self.horizon_days})"
                    )
                if pref.shift not in shift_ids:
                    raise ValueError(
                        f"employee {e.id!r}: unknown shift {pref.shift!r} "
                        "in preferences"
                    )
            if len({absence.day for absence in e.absences}) != len(e.absences):
                raise ValueError(f"employee {e.id!r}: duplicate absence day")
            if any(absence.day >= self.horizon_days for absence in e.absences):
                raise ValueError(f"employee {e.id!r}: absence day outside schedule")

        for d in self.demand:
            if d.skill not in skill_set:
                raise ValueError(f"demand: unknown skill {d.skill!r}")
            if not (0 <= d.day < self.horizon_days):
                raise ValueError(
                    f"demand day {d.day} out of horizon "
                    f"[0, {self.horizon_days})"
                )

        for wd in self.rules.weekend_days:
            if not (0 <= wd < self.horizon_days):
                raise ValueError(
                    f"weekend_days entry {wd} out of horizon "
                    f"[0, {self.horizon_days})"
                )

        if self.pay_basis == "monthly_salary":
            try:
                parsed_start = date.fromisoformat(self.start_date)
                if parsed_start.isoformat() != self.start_date:
                    raise ValueError("start_date must use YYYY-MM-DD")
            except ValueError as exc:
                raise ValueError("monthly salary planning needs a valid start_date") from exc

        return self


class SolveMode(str, Enum):
    SOLVE = "solve"
    PARETO = "pareto"
    REPAIR = "repair"


class FairnessMode(str, Enum):
    MINMAX_HOURS = "minmax_hours"
    EQUITY_UNDESIRABLE = "equity_undesirable"
    LEXIMIN = "leximin"


class Pin(BaseModel):
    model_config = ConfigDict(extra="forbid")

    employee: str
    day: int = Field(ge=0)
    shift: str
    value: Literal[0, 1]


class Assignment(BaseModel):
    model_config = ConfigDict(extra="forbid")

    employee: str
    day: int
    shift: str


class ObjectiveBreakdown(BaseModel):
    model_config = ConfigDict(extra="forbid")

    total: float
    wages: float
    overtime: float
    understaffing: float
    supervisor_penalty: float
    supervisor_gap: int
    min_hours_penalty: float
    unfairness: float
    preference: float


class PerEmployeeStats(BaseModel):
    model_config = ConfigDict(extra="forbid")

    employee: str
    hours: float
    overtime_hours: float
    weekend_shifts: int
    closing_shifts: int
    cost: float
    preference_penalty: float


class FairnessReport(BaseModel):
    model_config = ConfigDict(extra="forbid")

    mode: FairnessMode
    max_deviation_hours: float
    gini: float
    jain: float
    weekend_spread: int
    closing_spread: int


class UncoveredEntry(BaseModel):
    model_config = ConfigDict(extra="forbid")

    day: int
    period: int
    skill: str
    shortfall: int


class DualProvenance(str, Enum):
    """Where shadow_price came from. Never mix these silently."""

    FIXED_LP = "fixed_lp"  # dual of the §7 LP with x fixed to the integer roster
    RELAXATION = "relaxation"  # dual of the LP relaxation (x ∈ [0,1])
    DEGENERATE = "degenerate"  # fixed-x row is tight but π≈0 (dual ray / empty basis)


class CoverageDual(BaseModel):
    model_config = ConfigDict(extra="forbid")

    day: int
    period: int
    skill: str
    shadow_price: float
    provenance: DualProvenance
    binding: bool
    # Always filled when the relaxation LP has a value; never silently copied
    # into shadow_price. Gutter may rank by this but must not quote it as €.
    relaxation_price: float | None = None


class ReducedCost(BaseModel):
    model_config = ConfigDict(extra="forbid")

    employee: str
    day: int
    shift: str
    reduced_cost: float


class Duals(BaseModel):
    model_config = ConfigDict(extra="forbid")

    coverage: list[CoverageDual] = Field(default_factory=list)
    supervisor: list[CoverageDual] = Field(default_factory=list)
    reduced_costs: list[ReducedCost] = Field(default_factory=list)
    note: str = (
        "LP duals at the fixed integer solution; locally valid guidance, "
        "not MILP-exact. Each dual carries a provenance tag "
        "(fixed_lp | relaxation | degenerate) — never substitute one for "
        "another silently. Supervisor duals are from a soft constraint "
        "(u_sup): a fully saturated unsupervised period prices at λ_sup "
        "rather than the true hard marginal cost of finding a keyholder."
    )


class GapTraceEntry(BaseModel):
    model_config = ConfigDict(extra="forbid")

    t: float
    incumbent: float
    bound: float


class SolutionStatus(str, Enum):
    OPTIMAL = "optimal"
    FEASIBLE = "feasible"
    INFEASIBLE = "infeasible"
    TIMEOUT = "timeout"


class Solution(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: SolutionStatus
    mip_gap: float
    solve_time_s: float
    solver: str
    assignments: list[Assignment] = Field(default_factory=list)
    objective: ObjectiveBreakdown
    per_employee: list[PerEmployeeStats] = Field(default_factory=list)
    fairness: FairnessReport
    # C1 only — not the same number as objective.understaffing (which is weighted).
    uncovered_entry_count: int = 0
    shortfall_person_periods: float = 0.0
    uncovered: list[UncoveredEntry] = Field(default_factory=list)
    duals: Duals | None = None
    gap_trace: list[GapTraceEntry] = Field(default_factory=list)


class SolveRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    instance: Instance
    mode: SolveMode = SolveMode.SOLVE
    fairness: FairnessMode = FairnessMode.MINMAX_HOURS
    time_limit_s: float = 5.0
    mip_gap: float = 0.01
    pins: list[Pin] = Field(default_factory=list)
    pareto_points: int = 12
    published: Solution | None = None


class ParetoPoint(BaseModel):
    model_config = ConfigDict(extra="forbid")

    epsilon: float
    cost: float
    max_deviation_hours: float
    solution: Solution


class ParetoResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    frontier: list[ParetoPoint]
    total_solve_time_s: float
    # "cache" = served from data/frontiers/ for an unmodified committed instance.
    # "live" = computed now (pins, edits, or no artifact). UI must not show a
    # cache hit against a modified instance — that is a staleness bug.
    source: Literal["cache", "live"] = "live"
    cache_note: str | None = None


class ConflictKind(str, Enum):
    NO_QUALIFIED_STAFF = "no_qualified_staff"
    REST_CONFLICT = "rest_conflict"
    HOURS_CAP = "hours_cap"
    CONSECUTIVE_DAYS = "consecutive_days"
    AVAILABILITY_GAP = "availability_gap"
    SUPERVISOR_GAP = "supervisor_gap"


class ConflictCandidate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    employee: str
    reason: str
    fix: str | None = None


class Conflict(BaseModel):
    model_config = ConfigDict(extra="forbid")

    kind: ConflictKind
    day: int | None = None
    periods: list[int] = Field(default_factory=list)
    skill: str | None = None
    message: str
    candidates: list[ConflictCandidate] = Field(default_factory=list)


class InfeasibilityExplanation(BaseModel):
    model_config = ConfigDict(extra="forbid")

    conflicts: list[Conflict]


class ArrivalEntry(BaseModel):
    """One period of an arrival-rate forecast for /demand."""

    model_config = ConfigDict(extra="forbid")

    day: int = Field(ge=0)
    period: int = Field(ge=0, le=95)
    arrival_rate: float = Field(ge=0)  # customers per hour


class DemandRequest(BaseModel):
    """Arrival forecast + QoS target → sparse demand[] (docs/model.md §6)."""

    model_config = ConfigDict(extra="forbid")

    arrivals: list[ArrivalEntry]
    skill: str
    mean_service_h: float = Field(gt=0)
    target_p_wait: float = Field(default=0.2, gt=0, le=1)
    wait_threshold_h: float = Field(default=2.0 / 60.0, gt=0)
    beta: float | None = Field(default=None, ge=0)
    criticality: float = 1.0

    @field_validator("criticality")
    @classmethod
    def _criticality_ge_one(cls, v: float) -> float:
        if v < 1.0:
            raise ValueError(f"criticality must be ≥ 1.0, got {v}")
        return v


class SavedRoster(BaseModel):
    """Published roster persisted as JSON under data/saved/."""

    model_config = ConfigDict(extra="forbid")

    instance: Instance
    solution: Solution | None = None


class MarginsRequest(BaseModel):
    """Batch exact coverage marginals for the gutter (async from the UI)."""

    model_config = ConfigDict(extra="forbid")

    instance: Instance
    solution: Solution
    fairness: FairnessMode = FairnessMode.MINMAX_HOURS
    pins: list[Pin] = Field(default_factory=list)
    top_n: int = Field(default=10, ge=1, le=40)
    perturb_time_limit_s: float = Field(default=2.5, gt=0, le=30)


class ExactMarginEntry(BaseModel):
    model_config = ConfigDict(extra="forbid")

    day: int
    period: int
    skill: str
    delta: float  # exact MILP objective change — the only euro the gutter quotes
    provenance: DualProvenance
    binding: bool
    required: int
    # LP duals for the provenance badge only — never quote as €.
    shadow_price: float
    message: str


class MarginsResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    margins: list[ExactMarginEntry]
    compute_time_s: float
    # exact_precomputed = data/margins/ cache (true |Δ| ranking).
    # sampled = |π_relax| shortlist (chance-level selection — benchmarks.md).
    source: Literal["exact_precomputed", "sampled"] = "sampled"
    note: str = (
        "Sampled marginal costs: exact MILP Δ on a |relaxation dual| "
        "shortlist. Selection is chance-level for the true costliest rows "
        "(recall 1/5 vs ~0.58 expected random on retail_40). Provenance "
        "badges are LP dual tags only — never quote them as euros."
    )
