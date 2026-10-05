/** Mirrors docs/data-contract.md. Keep in sync with solver/schemas.py. */

export type SolveMode = "solve" | "pareto" | "repair";

export type FairnessMode =
  | "minmax_hours"
  | "equity_undesirable"
  | "leximin";

export type SolutionStatus =
  | "optimal"
  | "feasible"
  | "infeasible"
  | "timeout";

export interface Shift {
  id: string;
  label: string;
  start_period: number;
  end_period: number;
  paid_hours: number;
  undesirable: boolean;
  closing: boolean;
}

export interface Employee {
  id: string;
  name: string;
  wage: number;
  ot_wage: number;
  monthly_salary?: number | null;
  skills: string[];
  min_hours: number;
  max_hours: number;
  max_overtime: number;
  availability: { day: number; shifts: string[] }[];
  preferences: { day: number; shift: string; penalty: number }[];
  absences?: { day: number; reason: "sick" | "out" }[];
}

export interface DemandEntry {
  day: number;
  period: number;
  skill: string;
  required: number;
  criticality: number;
}

export interface Instance {
  id: string;
  horizon_days: number;
  start_date: string;
  currency: string;
  pay_basis?: "hourly" | "monthly_salary";
  skills: string[];
  supervisor_skill: string;
  shifts: Shift[];
  employees: Employee[];
  demand: DemandEntry[];
  rules: {
    min_rest_hours: number;
    min_people_per_shift?: number;
    max_people_per_shift?: number | null;
    supervision_required?: boolean | null;
    weekend_days: number[];
    romania_policy?: boolean;
    previous_week_known?: boolean;
    previous_week_start?: string | null;
    previous_work?: { employee: string; day: number; start_period: number; end_period: number; paid_hours: number }[];
  };
  weights: {
    understaffing: number;
    supervisor: number;
    min_hours: number;
    fairness: number;
    preference: number;
    stability: number;
  };
}

export interface Assignment {
  employee: string;
  day: number;
  shift: string;
}

export interface PerEmployeeStats {
  employee: string;
  hours: number;
  overtime_hours: number;
  weekend_shifts: number;
  closing_shifts: number;
  cost: number;
  preference_penalty: number;
}

export interface UncoveredEntry {
  day: number;
  period: number;
  skill: string;
  shortfall: number;
}

export interface ObjectiveBreakdown {
  total: number;
  wages: number;
  overtime: number;
  understaffing: number;
  supervisor_penalty: number;
  supervisor_gap: number;
  min_hours_penalty: number;
  unfairness: number;
  preference: number;
}

export interface Solution {
  status: SolutionStatus;
  mip_gap: number;
  solve_time_s: number;
  solver: string;
  assignments: Assignment[];
  objective: ObjectiveBreakdown;
  per_employee: PerEmployeeStats[];
  fairness: {
    mode: FairnessMode;
    max_deviation_hours: number;
    gini: number;
    jain: number;
    weekend_spread: number;
    closing_spread: number;
  };
  uncovered_entry_count: number;
  shortfall_person_periods: number;
  uncovered: UncoveredEntry[];
  duals: unknown | null;
  gap_trace: { t: number; incumbent: number; bound: number }[];
}

export interface ParetoPoint {
  epsilon: number;
  cost: number;
  max_deviation_hours: number;
  solution: Solution;
}

export interface ParetoResponse {
  frontier: ParetoPoint[];
  total_solve_time_s: number;
  source: "cache" | "live";
  cache_note: string | null;
}

/** Two distinct schedules are enough for a useful tradeoff. */
export const DIAL_MIN_POINTS = 2;

export type DualProvenance = "fixed_lp" | "relaxation" | "degenerate";

export interface ExactMarginEntry {
  day: number;
  period: number;
  skill: string;
  delta: number;
  provenance: DualProvenance;
  binding: boolean;
  required: number;
  shadow_price: number;
  message: string;
}

export interface MarginsResponse {
  margins: ExactMarginEntry[];
  compute_time_s: number;
  /** exact_precomputed = data/margins/ true ranking; sampled = |π_relax| shortlist. */
  source: "exact_precomputed" | "sampled";
  note: string;
}

/** Manager pin — docs/data-contract.md SolveRequest.pins */
export interface Pin {
  employee: string;
  day: number;
  shift: string;
  value: 0 | 1;
}

export interface SavedRoster {
  instance: Instance;
  solution: Solution | null;
}

export type ManagerPanel =
  | "welcome"
  | "setup"
  | "schedule"
  | "staff"
  | "shifts"
  | "demand"
  | "repair"
  | "publish"
  | "settings";
