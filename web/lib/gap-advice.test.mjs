import test from "node:test";
import assert from "node:assert/strict";

import { availabilityIdeas, closesGaps, hiringNeeds, withAvailability } from "./gap-advice.ts";

const instance = {
  supervisor_skill: "lead",
  shifts: [{ id: "day", start_period: 36, end_period: 68 }],
  employees: [
    { id: "a", skills: ["staff"], availability: [] },
    { id: "b", skills: ["lead"], availability: [] },
  ],
};
const solution = {
  assignments: [], uncovered_entry_count: 2, shortfall_person_periods: 3,
  uncovered: [
    { day: 0, period: 36, skill: "staff", shortfall: 2 },
    { day: 0, period: 37, skill: "staff", shortfall: 1 },
    { day: 0, period: 36, skill: "lead", shortfall: 1 },
  ],
  objective: { supervisor_gap: 1, min_hours_penalty: 0 },
};

test("shortlists matching people and does not change the original availability", () => {
  const ideas = availabilityIdeas(instance, solution);
  assert.equal(ideas[0].employee, "a");
  assert.equal(ideas[0].skill, "staff");
  assert.equal(ideas[1].employee, "b");
  const next = withAvailability(instance, ideas[0]);
  assert.deepEqual(next.employees[0].availability, [{ day: 0, shifts: ["day"] }]);
  assert.deepEqual(instance.employees[0].availability, []);
  const absent = { ...instance, employees: instance.employees.map((e) => e.id === "a" ? { ...e, absences: [{ day: 0, reason: "sick" }] } : e) };
  assert.equal(availabilityIdeas(absent, solution).some((idea) => idea.employee === "a"), false);
});

test("only verified improvements can be offered and hiring hours use C1 shortfall", () => {
  assert.equal(closesGaps(solution, { ...solution, status: "feasible", uncovered_entry_count: 1, shortfall_person_periods: 2 }), true);
  assert.equal(closesGaps(solution, { ...solution, status: "feasible", uncovered_entry_count: 1, shortfall_person_periods: 2, objective: { supervisor_gap: 2, min_hours_penalty: 0 } }), false);
  assert.equal(closesGaps(solution, { ...solution, status: "feasible", uncovered_entry_count: 1, shortfall_person_periods: 2, objective: { supervisor_gap: 1, min_hours_penalty: 1 } }), false);
  assert.deepEqual(hiringNeeds(instance, solution), [{ skill: "lead", hours: 0.3 }, { skill: "staff", hours: 0.8 }]);
  assert.deepEqual(hiringNeeds({ ...instance, rules: { max_people_per_shift: 1 } }, {
    ...solution, assignments: [{ employee: "a", day: 0, shift: "day" }],
  }), []);
});

test("coverage improvements count even when skill and supervisor totals stay level", () => {
  const roster = { ...instance, horizon_days: 1, rules: { min_people_per_shift: 1 }, demand: [{ day: 0, period: 36, skill: "staff", required: 1 }] };
  const after = { ...solution, status: "feasible", assignments: [{ employee: "a", day: 0, shift: "day" }] };
  assert.equal(closesGaps(solution, after, roster), true);
});
