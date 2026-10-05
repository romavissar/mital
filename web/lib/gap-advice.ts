import type { Instance, Solution } from "./types";
import { emptyOpenPeriods, shiftsBelowMinimum } from "./coverage.ts";

export type AvailabilityIdea = { id: string; employee: string; day: number; shift: string; skill: string; weight: number };
/** Shortlist changes worth testing with the solver. A shortlist is never presented as a verified fix. */
export function availabilityIdeas(instance: Instance, solution: Solution): AvailabilityIdea[] {
  const scores = new Map<string, { day: number; shift: string; skill: string; weight: number }>();
  for (const gap of solution.uncovered) {
    for (const shift of instance.shifts) {
      const covers = gap.period >= shift.start_period && gap.period < shift.end_period;
      if (!covers) continue;
      const key = `${gap.day}|${shift.id}|${gap.skill}`;
      const row = scores.get(key) ?? { day: gap.day, shift: shift.id, skill: gap.skill, weight: 0 };
      row.weight += gap.shortfall;
      scores.set(key, row);
    }
  }
  const assigned = new Set(solution.assignments.map((a) => `${a.employee}|${a.day}`));
  const ideas = [...scores.values()].flatMap((row) => instance.employees
    .filter((e) => e.skills.includes(row.skill) && !assigned.has(`${e.id}|${row.day}`)
      && !e.absences?.some((absence) => absence.day === row.day)
      && !e.availability.some((a) => a.day === row.day && a.shifts.includes(row.shift)))
    .map((e) => ({ ...row, employee: e.id, id: `${e.id}|${row.day}|${row.shift}`, weight: row.weight })))
    .sort((a, b) => b.weight - a.weight);
  return ideas.filter((idea, index) => ideas.findIndex((other) => other.id === idea.id) === index).slice(0, 6);
}

export function withAvailability(instance: Instance, idea: AvailabilityIdea): Instance {
  const next = structuredClone(instance);
  const employee = next.employees.find((e) => e.id === idea.employee);
  if (!employee) return next;
  let day = employee.availability.find((a) => a.day === idea.day);
  if (!day) { day = { day: idea.day, shifts: [] }; employee.availability.push(day); }
  if (!day.shifts.includes(idea.shift)) day.shifts.push(idea.shift);
  return next;
}

export function closesGaps(before: Solution, after: Solution, instance?: Instance): boolean {
  const beforeEmpty = instance ? emptyOpenPeriods(instance, before).size : 0;
  const afterEmpty = instance ? emptyOpenPeriods(instance, after).size : 0;
  const beforeThin = instance ? shiftsBelowMinimum(instance, before) : 0;
  const afterThin = instance ? shiftsBelowMinimum(instance, after) : 0;
  return ["optimal", "feasible"].includes(after.status)
    && afterEmpty <= beforeEmpty && afterThin <= beforeThin
    && after.uncovered_entry_count <= before.uncovered_entry_count
    && after.shortfall_person_periods <= before.shortfall_person_periods + 1e-6
    && after.objective.supervisor_gap <= before.objective.supervisor_gap
    && after.objective.min_hours_penalty <= before.objective.min_hours_penalty + 1e-6
    && (afterEmpty < beforeEmpty || afterThin < beforeThin || after.uncovered_entry_count < before.uncovered_entry_count || after.objective.supervisor_gap < before.objective.supervisor_gap);
}

export function hiringNeeds(instance: Instance, solution: Solution): { skill: string; hours: number }[] {
  const periods = new Map<string, number>();
  for (const gap of solution.uncovered) {
    const max = instance.rules?.max_people_per_shift;
    if (max != null && instance.shifts.filter((shift) => shift.start_period <= gap.period && gap.period < shift.end_period).every((shift) =>
      solution.assignments.filter((a) => a.day === gap.day && a.shift === shift.id).length >= max)) continue;
    const key = `${gap.skill}|${gap.day}|${gap.period}`;
    periods.set(key, Math.max(periods.get(key) ?? 0, gap.shortfall));
  }
  const hours = new Map<string, number>();
  for (const [key, count] of periods) {
    const skill = key.split("|")[0];
    hours.set(skill, (hours.get(skill) ?? 0) + count / 4);
  }
  return [...hours].sort((a, b) => Number(b[0] === instance.supervisor_skill) - Number(a[0] === instance.supervisor_skill) || b[1] - a[1]).slice(0, 2)
    .map(([skill, total]) => ({ skill, hours: Math.round(total * 10) / 10 }));
}
