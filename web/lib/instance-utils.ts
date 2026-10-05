/** Shared helpers for manager workflow. */

import type { Assignment, Instance, Pin, Solution } from "./types";

export function cloneInstance(inst: Instance): Instance {
  return structuredClone(inst);
}

export function instancesEqual(a: Instance, b: Instance): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function assignmentKey(a: Assignment): string {
  return `${a.employee}|${a.day}|${a.shift}`;
}

export function changedAssignments(
  before: Solution,
  after: Solution,
): Set<string> {
  const a = new Set(before.assignments.map(assignmentKey));
  const b = new Set(after.assignments.map(assignmentKey));
  const out = new Set<string>();
  for (const k of a) if (!b.has(k)) out.add(k);
  for (const k of b) if (!a.has(k)) out.add(k);
  return out;
}

export function pinKey(p: Pin): string {
  return `${p.employee}|${p.day}|${p.shift}`;
}

export function nextEmployeeId(inst: Instance): string {
  const nums = inst.employees
    .map((e) => /^e_(\d+)$/.exec(e.id))
    .filter(Boolean)
    .map((m) => Number(m![1]));
  const n = nums.length ? Math.max(...nums) + 1 : inst.employees.length;
  return `e_${String(n).padStart(3, "0")}`;
}

/** Expand a required headcount across all periods of a shift on a day. */
export function setDemandForShiftBand(
  inst: Instance,
  day: number,
  skill: string,
  shiftId: string,
  required: number,
  criticality = 1.0,
): Instance {
  const shift = inst.shifts.find((s) => s.id === shiftId);
  if (!shift) return inst;
  const next = cloneInstance(inst);
  next.demand = next.demand.filter(
    (d) =>
      !(
        d.day === day &&
        d.skill === skill &&
        d.period >= shift.start_period &&
        d.period < shift.end_period
      ),
  );
  if (required > 0) {
    for (let p = shift.start_period; p < shift.end_period; p++) {
      next.demand.push({
        day,
        period: p,
        skill,
        required,
        criticality,
      });
    }
  }
  return next;
}

/** Modal required for a skill on a day within a shift's periods (sparse). */
export function demandForShiftBand(
  inst: Instance,
  day: number,
  skill: string,
  shiftId: string,
): number {
  const shift = inst.shifts.find((s) => s.id === shiftId);
  if (!shift) return 0;
  const vals: number[] = [];
  for (const d of inst.demand) {
    if (
      d.day === day &&
      d.skill === skill &&
      d.period >= shift.start_period &&
      d.period < shift.end_period
    ) {
      vals.push(d.required);
    }
  }
  if (vals.length === 0) return 0;
  return Math.max(...vals);
}

export function wipeAvailability(
  inst: Instance,
  employeeId: string,
  days: number[],
): Instance {
  const next = cloneInstance(inst);
  const emp = next.employees.find((e) => e.id === employeeId);
  if (!emp) return next;
  const drop = new Set(days);
  emp.availability = emp.availability.filter((a) => !drop.has(a.day));
  return next;
}

export function setAbsence(inst: Instance, employeeId: string, day: number, reason: "sick" | "out" | null): Instance {
  const next = cloneInstance(inst);
  const employee = next.employees.find((e) => e.id === employeeId);
  if (!employee) return next;
  employee.absences = (employee.absences ?? []).filter((item) => item.day !== day);
  if (reason) employee.absences.push({ day, reason });
  return next;
}

/** Manager-confirmed availability for a specific cover shift. */
export function allowCoverShift(inst: Instance, employeeId: string, day: number, shiftId: string): Instance {
  const next = cloneInstance(inst);
  const employee = next.employees.find((item) => item.id === employeeId);
  if (!employee || employee.absences?.some((item) => item.day === day)) return next;
  const availability = employee.availability.find((item) => item.day === day);
  if (availability) {
    if (!availability.shifts.includes(shiftId)) availability.shifts.push(shiftId);
  } else employee.availability.push({ day, shifts: [shiftId] });
  return next;
}
