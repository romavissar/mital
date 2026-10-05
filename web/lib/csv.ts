import { convertMoney, isCurrency, type CurrencySettings } from "./currency.ts";
import type { Instance, Solution } from "./types";

function cell(value: string | number): string {
  const raw = String(value);
  const safe = /^[=+@-]/.test(raw) && typeof value === "string" ? `'${raw}` : raw;
  return `"${safe.replaceAll('"', '""')}"`;
}

export function rosterCsv(instance: Instance, solution: Solution, settings: CurrencySettings, businessName = instance.id): string {
  const accounting = instance.currency;
  if (!isCurrency(accounting)) throw new Error("Unsupported accounting currency.");
  const headers = [
    "business_name", "employee_id", "employee_name", "week_start", "scheduled_hours", "overtime_hours",
    "pay_basis", "regular_pay_accounting", "overtime_accounting", "total_accounting",
    "accounting_currency", "regular_pay_display", "overtime_display", "total_display",
    "display_currency", "rate_date", "rate_source", "planning_only",
  ];
  const byEmployee = new Map(solution.per_employee.map((row) => [row.employee, row]));
  const rows = instance.employees.map((employee) => {
    const stats = byEmployee.get(employee.id);
    const overtime = (stats?.overtime_hours ?? 0) * employee.ot_wage;
    const total = stats?.cost ?? 0;
    const regular = total - overtime;
    return [
      businessName, employee.id, employee.name, instance.start_date, stats?.hours ?? 0,
      stats?.overtime_hours ?? 0, instance.pay_basis ?? "hourly",
      regular, overtime, total, accounting,
      convertMoney(regular, accounting, settings),
      convertMoney(overtime, accounting, settings),
      convertMoney(total, accounting, settings),
      settings.display_currency, settings.fx.date, settings.fx.source, "Not payroll",
    ];
  });
  return `\uFEFF${[headers, ...rows].map((row) => row.map(cell).join(",")).join("\r\n")}\r\n`;
}
