import assert from "node:assert/strict";
import test from "node:test";

import { contractedCapacity } from "./capacity.ts";

test("reports unavoidable contracted-hour surplus under a shift cap", () => {
  const instance = { horizon_days: 1, pay_basis: "hourly", rules: { max_people_per_shift: 1 },
    shifts: [{ paid_hours: 8 }], employees: [
      { id: "a", name: "A", min_hours: 8, wage: 20 },
      { id: "b", name: "B", min_hours: 8, wage: 10 },
    ] };
  const solution = { per_employee: [{ employee: "a", hours: 8, cost: 160 }, { employee: "b", hours: 0, cost: 0 }] };
  assert.deepEqual(contractedCapacity(instance, solution), { availableHours: 8, contractedHours: 16, excessHours: 8,
    candidates: [{ id: "b", name: "B", missing: 8, grossWeeklySaving: 0 }] });
  assert.equal(contractedCapacity({ ...instance, rules: { max_people_per_shift: 2 } }, solution), null);
});
