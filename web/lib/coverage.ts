import type { Instance, Shift, Solution } from "./types";

/** Open 15-minute periods with nobody scheduled, regardless of skill. */
export function emptyOpenPeriods(instance: Instance, solution: Solution): Set<string> {
  const empty = new Set(instance.demand.filter((d) => d.required > 0).map((d) => `${d.day}:${d.period}`));
  const shifts = new Map(instance.shifts.map((s) => [s.id, s]));
  for (const assignment of solution.assignments) {
    const shift = shifts.get(assignment.shift);
    if (!shift) continue;
    for (let period = shift.start_period; period < shift.end_period; period++) empty.delete(`${assignment.day}:${period}`);
  }
  return empty;
}

export function shiftStaffingGaps(instance: Instance, solution: Solution): { day: number; shift: Shift; missing: number }[] {
  const min = instance.rules.min_people_per_shift ?? 1;
  const gaps: { day: number; shift: Shift; missing: number }[] = [];
  if (!min) return gaps;
  for (let day = 0; day < instance.horizon_days; day++) for (const shift of instance.shifts) {
    const active = instance.demand.some((d) => d.day === day && d.required > 0 && d.period >= shift.start_period && d.period < shift.end_period);
    const assigned = solution.assignments.filter((a) => a.day === day && a.shift === shift.id).length;
    if (active && assigned < min) gaps.push({ day, shift, missing: min - assigned });
  }
  return gaps;
}

export const shiftsBelowMinimum = (instance: Instance, solution: Solution) => shiftStaffingGaps(instance, solution).length;
