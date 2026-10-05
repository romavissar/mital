import assert from "node:assert/strict";
import test from "node:test";

import { allowCoverShift, setAbsence } from "./instance-utils.ts";

test("sick/out days preserve ordinary availability and can be cleared", () => {
  const original = { employees: [{ id: "ana", availability: [{ day: 2, shifts: ["day"] }] }] };
  const sick = setAbsence(original, "ana", 2, "sick");
  assert.deepEqual(sick.employees[0].absences, [{ day: 2, reason: "sick" }]);
  assert.deepEqual(sick.employees[0].availability, original.employees[0].availability);
  assert.deepEqual(setAbsence(sick, "ana", 2, null).employees[0].absences, []);
  assert.equal(original.employees[0].absences, undefined);
});

test("confirmed cover updates the existing day without changing the original or overriding sickness", () => {
  const original = { employees: [
    { id: "cover", availability: [{ day: 6, shifts: [] }], absences: [] },
    { id: "sick", availability: [{ day: 6, shifts: [] }], absences: [{ day: 6, reason: "sick" }] },
  ] };
  const covered = allowCoverShift(original, "cover", 6, "night");
  assert.deepEqual(covered.employees[0].availability[0].shifts, ["night"]);
  assert.deepEqual(original.employees[0].availability[0].shifts, []);
  assert.deepEqual(allowCoverShift(covered, "cover", 6, "night").employees[0].availability[0].shifts, ["night"]);
  assert.deepEqual(allowCoverShift(original, "sick", 6, "night").employees[1].availability[0].shifts, []);
});
