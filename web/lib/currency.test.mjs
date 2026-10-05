import assert from "node:assert/strict";
import { test } from "node:test";
import { convertMoney, defaultCurrencySettings, formatMoney, rateNote } from "./currency.ts";

const settings = {
  ...defaultCurrencySettings("RON"),
  fx: { date: "2026-10-01", source: "test bulletin", ron_per_eur: 5, ron_per_usd: 4 },
};

test("all six conversion directions and round trips use RON cross-rates", () => {
  const expected = {
    "RON-EUR": 20, "RON-USD": 25,
    "EUR-RON": 500, "EUR-USD": 125,
    "USD-RON": 400, "USD-EUR": 80,
  };
  for (const [pair, amount] of Object.entries(expected)) {
    const [from, to] = pair.split("-");
    const forward = convertMoney(100, from, { ...settings, display_currency: to });
    assert.equal(forward, amount, pair);
    assert.ok(Math.abs(convertMoney(forward, to, { ...settings, display_currency: from }) - 100) < 1e-9);
  }
});

test("rejects missing, invalid, future, and non-finite rates", () => {
  for (const patch of [
    { date: "" }, { date: "2026-02-30" }, { date: "2999-01-01" },
    { source: "" }, { ron_per_eur: null }, { ron_per_eur: 0 },
    { ron_per_eur: -2 }, { ron_per_eur: Infinity },
  ]) {
    assert.throws(() => convertMoney(100, "EUR", {
      ...settings, display_currency: "RON", fx: { ...settings.fx, ...patch },
    }), JSON.stringify(patch));
  }
});

test("display conversion formats and labels estimates without changing source values", () => {
  const objective = { total: 100, wages: 80 };
  const converted = { ...settings, display_currency: "USD" };
  assert.match(formatMoney(objective.total, "EUR", converted), /125[.,]00/);
  assert.equal(objective.total, 100);
  assert.match(rateNote("EUR", converted, new Date("2026-11-03T00:00:00Z")), /older than 30 days/);
  assert.equal(rateNote("EUR", { ...settings, display_currency: "EUR" }), null);
});
