import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { readConfig } from "../src/config.js";

const base = { NIGHTSCOUT_URL: "https://nightscout.example.com" };

test("defaults and units are explicit", () => {
  const config = readConfig(base);
  assert.equal(config.url.pathname, "/api/v1/entries.json");
  assert.equal(config.url.searchParams.get("count"), "12");
  assert.equal(config.url.searchParams.get("find[type]"), "sgv");
  assert.equal(config.units, "mg/dL");
  assert.equal(config.staleMs, 600_000);
  assert.equal(config.pollMs, 30_000);
  assert.equal(config.timeoutMs, 8_000);
  assert.equal(config.host, "127.0.0.1");
  assert.equal(config.port, 3001);
  assert.deepEqual(config.headers, { Accept: "application/json" });
});

for (const path of [
  "", "/", "/api/v1/entries", "/api/v1/entries.json", "/api/v1/entries/sgv.json",
  "/api/v1/entries/sgv", "/api/v1/entries.json/",
]) {
  test(`normalizes supported URL path: ${path || "(root)"}`, () => {
    assert.equal(readConfig({ NIGHTSCOUT_URL: `${base.NIGHTSCOUT_URL}${path}` }).url.pathname,
      "/api/v1/entries.json");
  });
}

test("preserves a reverse-proxy subpath and overwrites query filters", () => {
  const config = readConfig({
    NIGHTSCOUT_URL: `${base.NIGHTSCOUT_URL}/nightscout/api/v1/entries.json?count=999&find[type]=mbg&token=synthetic-token`,
  });
  assert.equal(config.url.pathname, "/nightscout/api/v1/entries.json");
  assert.equal(config.url.searchParams.get("count"), "12");
  assert.equal(config.url.searchParams.get("find[type]"), "sgv");
  assert.equal(config.url.searchParams.get("token"), "synthetic-token");
  assert.equal(readConfig({ NIGHTSCOUT_URL: `${base.NIGHTSCOUT_URL}/nightscout/` }).url.pathname,
    "/nightscout/api/v1/entries.json");
});

test("supports read-only tokens and encodes reserved characters", () => {
  const config = readConfig({ ...base, NIGHTSCOUT_TOKEN: "synthetic+token&value" });
  assert.equal(config.url.searchParams.get("token"), "synthetic+token&value");
  assert.equal([...config.url.searchParams].length, 3);
});

test("hashes the raw API secret for legacy Nightscout authentication", () => {
  const config = readConfig({ ...base, NIGHTSCOUT_API_SECRET: "synthetic-secret" });
  assert.equal(config.headers["api-secret"], createHash("sha1").update("synthetic-secret").digest("hex"));
  assert.equal(config.url.searchParams.has("token"), false);
});

test("accepts custom settings and explicit trusted-network HTTP", () => {
  const config = readConfig({
    NIGHTSCOUT_URL: "http://127.0.0.1:1234", ALLOW_HTTP: "true",
    NIGHTSCOUT_UNITS: "mmol/L", HOST: "0.0.0.0", PORT: "4000",
    STALE_AFTER_MINUTES: "15", POLL_INTERVAL_SECONDS: "60", REQUEST_TIMEOUT_SECONDS: "3",
    WIDGET_API_KEY: "synthetic-widget-key",
  });
  assert.equal(config.units, "mmol/L");
  assert.equal(config.staleMs, 900_000);
  assert.equal(config.pollMs, 60_000);
  assert.equal(config.timeoutMs, 3_000);
  assert.equal(config.apiKey, "synthetic-widget-key");
  assert.equal(config.host, "0.0.0.0");
  assert.equal(config.port, 4000);
});

for (const [name, env] of [
  ["missing URL", { NIGHTSCOUT_URL: "" }],
  ["invalid URL", { NIGHTSCOUT_URL: "not a URL" }],
  ["HTTP by default", { NIGHTSCOUT_URL: "http://nightscout.example.com" }],
  ["non-HTTP scheme", { NIGHTSCOUT_URL: "file:///private", ALLOW_HTTP: "true" }],
  ["basic auth", { NIGHTSCOUT_URL: "https://user:synthetic-secret@nightscout.example.com" }],
  ["fragment", { NIGHTSCOUT_URL: `${base.NIGHTSCOUT_URL}/#synthetic-secret` }],
  ["API v3 URL", { NIGHTSCOUT_URL: `${base.NIGHTSCOUT_URL}/api/v3/entries` }],
  ["unsupported query", { NIGHTSCOUT_URL: `${base.NIGHTSCOUT_URL}/?secret=synthetic-secret` }],
  ["duplicate token", { NIGHTSCOUT_URL: `${base.NIGHTSCOUT_URL}/?token=a&token=b` }],
  ["two token sources", { NIGHTSCOUT_URL: `${base.NIGHTSCOUT_URL}/?token=a`, NIGHTSCOUT_TOKEN: "b" }],
  ["two auth methods", { NIGHTSCOUT_TOKEN: "a", NIGHTSCOUT_API_SECRET: "b" }],
  ["newline token", { NIGHTSCOUT_TOKEN: "a\nb" }],
  ["newline adapter key", { WIDGET_API_KEY: "a\rb" }],
  ["invalid units", { NIGHTSCOUT_UNITS: "mmol" }],
  ["invalid boolean", { ALLOW_HTTP: "yes" }],
  ["non-numeric port", { PORT: "abc" }],
  ["port zero", { PORT: "0" }],
  ["port too large", { PORT: "65536" }],
  ["negative timeout", { REQUEST_TIMEOUT_SECONDS: "-1" }],
  ["fractional interval", { POLL_INTERVAL_SECONDS: "5.5" }],
  ["short interval", { POLL_INTERVAL_SECONDS: "1" }],
  ["long stale threshold", { STALE_AFTER_MINUTES: "61" }],
  ["polling exceeds freshness", { STALE_AFTER_MINUTES: "2", POLL_INTERVAL_SECONDS: "120" }],
]) {
  test(`rejects ${name} without revealing values`, () => {
    assert.throws(() => readConfig({ ...base, ...env }), (error) => {
      assert.equal(error.message.includes("synthetic-secret"), false);
      assert.equal(error.message.includes("nightscout.example.com"), false);
      return true;
    });
  });
}
