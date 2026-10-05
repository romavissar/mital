import assert from "node:assert/strict";
import test from "node:test";

import { emptyOpenPeriods, shiftStaffingGaps, shiftsBelowMinimum } from "./coverage.ts";

test("uncovered means nobody working, even when a skill is missing", () => {
  const instance = {
    horizon_days: 1, rules: { min_people_per_shift: 2 },
    shifts: [{ id: "day", start_period: 40, end_period: 42 }],
    demand: [40, 41, 42].map((period) => ({ day: 0, period, skill: "barista", required: 2 })),
  };
  const solution = {
    assignments: [{ employee: "a", day: 0, shift: "day" }],
    uncovered: [{ day: 0, period: 40, skill: "barista", shortfall: 1 }],
  };
  assert.deepEqual([...emptyOpenPeriods(instance, solution)], ["0:42"]);
  assert.equal(shiftsBelowMinimum(instance, solution), 1);
  assert.deepEqual(shiftStaffingGaps(instance, solution).map(({ day, shift, missing }) => [day, shift.id, missing]), [[0, "day", 1]]);
});
