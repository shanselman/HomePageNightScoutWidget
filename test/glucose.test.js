import assert from "node:assert/strict";
import test from "node:test";
import { summarize } from "../src/glucose.js";
import { entry, now, settings } from "./helpers.js";

test("formats the four Homepage fields and optional fields using synthetic data", () => {
  assert.deepEqual(summarize([entry(), entry(118, 7)], settings(), now), {
    glucose: "123 mg/dL", trend: "\u2192 +5 (5m)", delta: "+5 mg/dL",
    age: "2m ago", status: "Current", stale: false,
  });
});

test("converts mg/dL to mmol/L once, rounding glucose and signed delta independently", () => {
  assert.deepEqual(summarize([entry(123), entry(118, 7)], settings({ units: "mmol/L" }), now), {
    glucose: "6.8 mmol/L", trend: "\u2192 +0.3 (5m)", delta: "+0.3 mmol/L",
    age: "2m ago", status: "Current", stale: false,
  });
});

test("handles falling, zero, and rounded-zero changes without negative zero", () => {
  assert.equal(summarize([entry(100), entry(118, 7)], settings(), now).delta, "-18 mg/dL");
  assert.equal(summarize([entry(100), entry(100, 7)], settings(), now).delta, "0 mg/dL");
  assert.equal(summarize([entry(100), entry(100, 7)], settings({ units: "mmol/L" }), now).delta,
    "0.0 mmol/L");
});

test("sorts unsorted readings, does not mutate input, and ignores fingerstick data", () => {
  const entries = [entry(118, 7), entry(160, 0, { type: "mbg" }), entry()];
  const original = structuredClone(entries);
  assert.equal(summarize(entries, settings(), now).trend, "\u2192 +5 (5m)");
  assert.deepEqual(entries, original);
});

test("supports legacy entries without type and timezone-qualified dateString", () => {
  assert.equal(summarize([{ sgv: 123, dateString: "2026-01-15T13:58:00+02:00" }],
    settings(), now).age, "2m ago");
});

test("accepts fractional epoch milliseconds from Nightscout uploaders", () => {
  const fractional = entry(123, 2, { date: now - 120_000 + 0.875 });
  assert.equal(summarize([fractional, entry(118, 7)], settings(), now).glucose, "123 mg/dL");
  assert.equal(summarize([fractional, entry(118, 7)], settings(), now).trend, "\u2192 +5 (5m)");
});

test("deduplicates equal readings without losing the previous interval", () => {
  assert.equal(summarize([entry(), entry(), entry(118, 7)], settings(), now).delta, "+5 mg/dL");
});

for (const [direction, arrow] of [
  ["TripleUp", "\u290a"], ["DoubleUp", "\u21c8"], ["SingleUp", "\u2191"],
  ["FortyFiveUp", "\u2197"], ["Flat", "\u2192"], ["FortyFiveDown", "\u2198"],
  ["SingleDown", "\u2193"], ["DoubleDown", "\u21ca"], ["TripleDown", "\u290b"],
  ["NONE", "?"], ["NOT COMPUTABLE", "?"], ["RATE OUT OF RANGE", "?"], ["invalid", "?"], [null, "?"],
]) {
  test(`maps ${direction} without inventing a trend`, () => {
    assert.equal(summarize([entry(123, 2, { direction })], settings(), now).trend, arrow);
  });
}

test("hides the number, trend and delta at the exact freshness boundary", () => {
  const entries = [entry(123, 10), entry(118, 15)];
  assert.equal(summarize(entries, settings(), now - 1).status, "Current");
  assert.deepEqual(summarize(entries, settings(), now), {
    glucose: "STALE", trend: "-", delta: "-", age: "10m ago", status: "Stale data", stale: true,
  });
});

test("honors a configured threshold and formats long ages", () => {
  const entries = [entry(123, 15)];
  assert.equal(summarize(entries, settings({ staleMs: 1_200_000 }), now).status, "Current");
  assert.equal(summarize([entry(123, 61)], settings(), now).age, "1h 1m ago");
  assert.equal(summarize([entry(123, 1_500)], settings(), now).age, "1d 1h ago");
  assert.equal(summarize([entry(123, 0)], settings(), now).age, "<1m ago");
});

test("tolerates at most 60 seconds of uploader clock skew", () => {
  assert.equal(summarize([entry(123, -1)], settings(), now).age, "<1m ago");
  assert.throws(() => summarize([entry(123, -1.01)], settings(), now),
    { code: "future_data" });
});

test("never displays a sensor error code as glucose or falls back to an older reading", () => {
  for (const code of [1, 2, 3, 5, 6, 9, 10, 12, 38]) {
    const summary = summarize([entry(code), entry(118, 7)], settings(), now);
    assert.equal(summary.glucose, "Sensor error");
    assert.equal(summary.trend, "-");
    assert.equal(summary.delta, "-");
    assert.equal(summary.status, "Sensor error");
  }
  assert.equal(summarize([entry(39)], settings(), now).glucose, "39 mg/dL");
});

test("does not use an old sensor error to compute a delta", () => {
  assert.equal(summarize([entry(), entry(5, 7)], settings(), now).delta, "-");
});

test("reports an actual interval and suppresses changes outside 2-10 minutes", () => {
  for (const gap of [2, 3, 5, 7.5, 10]) {
    assert.equal(summarize([entry(), entry(118, 2 + gap)], settings(), now).trend,
      `\u2192 +5 (${gap}m)`);
  }
  for (const gap of [1, 1.99, 10.01, 60]) {
    assert.equal(summarize([entry(), entry(118, 2 + gap)], settings(), now).trend, "\u2192");
  }
});

for (const [name, data] of [
  ["object instead of array", {}],
  ["null entry", [null]],
  ["array entry", [[]]],
  ["too many entries", Array(101).fill(entry())],
  ["missing timestamp", [{ sgv: 123 }]],
  ["seconds instead of milliseconds", [entry(123, 2, { date: Math.floor(now / 1_000) })]],
  ["invalid date", [entry(123, 2, { date: NaN })]],
  ["infinite date", [entry(123, 2, { date: Infinity })]],
  ["string timestamp", [entry(123, 2, { date: String(now) })]],
  ["out of range date", [entry(123, 2, { date: 9_000_000_000_000_000 })]],
  ["timezone-free date", [{ sgv: 123, dateString: "2026-01-15T11:58:00" }]],
  ["unparseable ISO date", [{ sgv: 123, dateString: "2026-99-15T11:58:00Z" }]],
  ["ambiguous invalid primary date", [{ sgv: 123, date: 0, dateString: "2026-01-15T11:58:00Z" }]],
  ["missing glucose", [{ date: now }]],
  ["string glucose", [entry("123")]],
  ["negative glucose", [entry(-1)]],
  ["zero glucose", [entry(0)]],
  ["fractional glucose", [entry(123.5)]],
  ["unbounded glucose", [entry(1001)]],
  ["conflicting duplicate", [entry(123), entry(124)]],
  ["invalid newest data", [entry(null, 0), entry(123, 5)]],
]) {
  test(`rejects ${name} rather than displaying misleading data`, () => {
    assert.throws(() => summarize(data, settings(), now), { code: "invalid_data" });
  });
}

test("empty and non-sensor responses are explicitly unavailable", () => {
  assert.throws(() => summarize([], settings(), now), { code: "no_data", status: 503 });
  assert.throws(() => summarize([{ type: "mbg", mbg: 123 }], settings(), now), { code: "no_data" });
});

test("summary does not disclose upstream identifiers, notes, device, or raw entries", () => {
  const summary = summarize([entry(123, 2, {
    _id: "synthetic-private-id", device: "synthetic-private-device", notes: "synthetic-private-notes",
    token: "synthetic-private-token",
  })], settings(), now);
  assert.deepEqual(Object.keys(summary).sort(), ["age", "delta", "glucose", "stale", "status", "trend"]);
  assert.equal(JSON.stringify(summary).includes("synthetic-private"), false);
});
