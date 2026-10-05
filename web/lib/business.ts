import type { DemandEntry, Instance, Shift } from "./types";

export function demandAfterShiftEdit(instance: Instance, shifts: Shift[]): DemandEntry[] {
  if (!shifts.length) return [];
  const old = new Map(instance.shifts.map((shift) => [shift.id, shift]));
  const offset = shifts[0].start_period - (old.get(shifts[0].id)?.start_period ?? shifts[0].start_period);
  const movedTogether = shifts.length === instance.shifts.length && shifts.every((shift) => {
    const before = old.get(shift.id);
    return before && shift.start_period - before.start_period === offset && shift.end_period - before.end_period === offset;
  }) && instance.demand.every((entry) => entry.period + offset >= 0 && entry.period + offset < 96);
  return movedTogether ? instance.demand.map((entry) => ({ ...entry, period: entry.period + offset })) : [];
}

export function mondayOf(value: string): string {
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) throw new Error("Choose a valid week date.");
  date.setDate(date.getDate() - (date.getDay() + 6) % 7);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function localToday(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

export function nextWeek(value: string): string {
  const date = new Date(`${value}T12:00:00`);
  date.setDate(date.getDate() + 7);
  return mondayOf(`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`);
}

export function previousWeek(value: string): string {
  const date = new Date(`${value}T12:00:00`);
  date.setDate(date.getDate() - 7);
  return mondayOf(`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`);
}

export function withoutWorkRules(instance: Instance): Instance {
  if (!instance.rules.min_rest_hours && !instance.rules.romania_policy && !instance.rules.previous_week_known
      && !instance.rules.previous_week_start && !instance.rules.previous_work?.length) return instance;
  return { ...instance, rules: { ...instance.rules, min_rest_hours: 0, romania_policy: false,
    previous_week_known: false, previous_week_start: null, previous_work: [] } };
}

export function clockPeriod(value: string): number {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) throw new Error("Use HH:MM for shift times.");
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 24 || minute > 59 || minute % 15 || (hour === 24 && minute)) {
    throw new Error("Shift times must use 15-minute steps between 00:00 and 24:00.");
  }
  return hour * 4 + minute / 15;
}

export function createBusiness(name: string, week: string, skills: string[], supervisor: string, shifts: Shift[]): Instance {
  if (!name.trim()) throw new Error("Enter a business name.");
  if (!skills.length || !supervisor || !skills.includes(supervisor)) throw new Error("Choose a supervisor skill.");
  if (!shifts.length || new Set(shifts.map((s) => s.id)).size !== shifts.length) throw new Error("Add shifts with distinct names.");
  for (const shift of shifts) {
    if (shift.end_period <= shift.start_period || shift.paid_hours <= 0 || shift.paid_hours > (shift.end_period - shift.start_period) / 4) {
      throw new Error(`Check the times and paid hours for ${shift.label}.`);
    }
  }
  return {
    id: `b_${crypto.randomUUID().slice(0, 8)}`,
    start_date: mondayOf(week),
    horizon_days: 7,
    currency: "RON",
    pay_basis: "monthly_salary",
    skills,
    supervisor_skill: supervisor,
    shifts,
    employees: [],
    demand: [],
    rules: { min_rest_hours: 0, min_people_per_shift: 1, max_people_per_shift: null, weekend_days: [5, 6] },
    weights: { understaffing: 500, supervisor: 900, min_hours: 400, fairness: 100, preference: 5, stability: 60 },
  };
}
