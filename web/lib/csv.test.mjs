import assert from "node:assert/strict";
import { test } from "node:test";
import { rosterCsv } from "./csv.ts";
import { defaultCurrencySettings } from "./currency.ts";

test("CSV includes salary and overtime in accounting and display currency without spreadsheet formulas", () => {
  const instance = {
    start_date: "2026-10-05", currency: "RON", pay_basis: "monthly_salary",
    employees: [{ id: "e1", name: '=HYPERLINK("bad")', ot_wage: 30 }],
  };
  const solution = { per_employee: [{ employee: "e1", hours: 40, overtime_hours: 2, cost: 1060 }] };
  const settings = {
    ...defaultCurrencySettings("RON", "ro"), display_currency: "EUR",
    fx: { date: "2026-10-01", source: "test", ron_per_eur: 5, ron_per_usd: null },
  };
  const csv = rosterCsv(instance, solution, settings, "Test SRL");
  assert.ok(csv.startsWith("\uFEFF"));
  assert.match(csv, /"'=HYPERLINK\(""bad""\)"/);
  assert.match(csv, /"Test SRL","e1"/);
  assert.match(csv, /"1000","60","1060","RON","200","12","212","EUR"/);
  assert.match(csv, /"Not payroll"/);
  assert.equal(solution.per_employee[0].cost, 1060);
});
