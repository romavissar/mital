import assert from "node:assert/strict";
import { test } from "node:test";
import { clockPeriod, demandAfterShiftEdit, withoutWorkRules } from "./business.ts";

test("midnight can end a shift without moving it to the next day", () => {
  assert.equal(clockPeriod("24:00"), 96);
  assert.throws(() => clockPeriod("24:15"));
});

test("moving every shift together moves demand, while changing one clears it", () => {
  const shifts = [
    { id: "day", start_period: 36, end_period: 68 },
    { id: "night", start_period: 68, end_period: 92 },
  ];
  const instance = { shifts, demand: [{ day: 0, period: 36, skill: "staff", required: 1 }] };
  const moved = shifts.map((shift) => ({ ...shift, start_period: shift.start_period + 4, end_period: shift.end_period + 4 }));
  assert.deepEqual(demandAfterShiftEdit(instance, moved), [{ day: 0, period: 40, skill: "staff", required: 1 }]);
  assert.deepEqual(demandAfterShiftEdit(instance, [moved[0], shifts[1]]), []);
  assert.equal(instance.demand[0].period, 36);
});

test("older saved work rules are cleared without changing staffing settings", () => {
  const instance = { rules: { romania_policy: true, min_rest_hours: 12, previous_week_known: true,
    previous_week_start: "2026-09-28", previous_work: [{ employee: "a" }], min_people_per_shift: 2 } };
  const next = withoutWorkRules(instance);
  assert.equal(next.rules.min_rest_hours, 0);
  assert.equal(next.rules.romania_policy, false);
  assert.deepEqual(next.rules.previous_work, []);
  assert.equal(next.rules.min_people_per_shift, 2);
  assert.equal(instance.rules.min_rest_hours, 12);
});
