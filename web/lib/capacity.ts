import type { Instance, Solution } from "./types";

/** A conservative surplus check: even every shift filled to its cap cannot fit all contracts. */
export function contractedCapacity(instance: Instance, solution: Solution) {
  const cap = instance.rules.max_people_per_shift;
  if (cap == null) return null;
  const availableHours = instance.horizon_days * cap * instance.shifts.reduce((sum, shift) => sum + shift.paid_hours, 0);
  const contractedHours = instance.employees.reduce((sum, employee) => sum + employee.min_hours, 0);
  if (contractedHours <= availableHours + 1e-6) return null;
  const scheduled = new Map(solution.per_employee.map((row) => [row.employee, row]));
  const candidates = instance.employees.map((employee) => {
    const row = scheduled.get(employee.id);
    const missing = Math.max(0, employee.min_hours - (row?.hours ?? 0));
    const grossWeeklySaving = row?.cost ?? 0;
    return { id: employee.id, name: employee.name, missing, grossWeeklySaving };
  }).filter((item) => item.missing > 1e-6).sort((a, b) => b.missing - a.missing || b.grossWeeklySaving - a.grossWeeklySaving);
  return { availableHours, contractedHours, excessHours: contractedHours - availableHours, candidates };
}
