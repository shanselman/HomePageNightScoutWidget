import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { WidgetError } from "../src/config.js";
import { summarize } from "../src/glucose.js";
import { createApp } from "../src/server.js";
import { entry, listen, now, settings } from "./helpers.js";

function app(options = {}) {
  const config = settings({ apiKey: options.apiKey || "" });
  return createApp(config, {
    log: options.log || (() => {}),
    client: options.client || { getSummary: async () => summarize([entry()], config, now) },
  });
}

test("serves only the summary, without cache, CORS, or credential disclosure", async (t) => {
  const url = await listen(app(), t);
  const response = await fetch(`${url}/api/homepage`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("access-control-allow-origin"), null);
  assert.match(response.headers.get("content-type"), /application\/json/);
  assert.deepEqual(await response.json(), summarize([entry()], settings(), now));
});

test("health is liveness only and does not request or expose glucose", async (t) => {
  let calls = 0;
  const url = await listen(app({
    apiKey: "synthetic-key",
    client: { getSummary: async () => { calls++; throw new Error("should not run"); } },
  }), t);
  assert.deepEqual(await (await fetch(`${url}/healthz`)).json(), { status: "ok" });
  assert.equal(calls, 0);
});

test("requires the adapter bearer key when configured, before querying Nightscout", async (t) => {
  let calls = 0;
  const url = await listen(app({
    apiKey: "synthetic-key",
    client: { getSummary: async () => { calls++; return { status: "Current" }; } },
  }), t);
  for (const auth of ["", "Bearer wrong", "Basic synthetic-key", "Bearer synthetic-key-extra"]) {
    const response = await fetch(`${url}/api/homepage`, { headers: { Authorization: auth } });
    assert.equal(response.status, 401);
    assert.equal(response.headers.get("www-authenticate"), "Bearer");
    assert.equal((await response.json()).code, "unauthorized");
  }
  assert.equal(calls, 0);
  const response = await fetch(`${url}/api/homepage`, {
    headers: { Authorization: "Bearer synthetic-key" },
  });
  assert.equal(response.status, 200);
  assert.equal(calls, 1);
});

test("rejects mutations and arbitrary paths/query destinations", async (t) => {
  const url = await listen(app(), t);
  for (const method of ["POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"]) {
    const response = await fetch(`${url}/api/homepage`, { method });
    assert.equal(response.status, 405);
    assert.equal(response.headers.get("allow"), "GET");
  }
  for (const path of ["/", "/.env", "/api/homepage?url=https://other.example", "/healthz?token=private"]) {
    assert.equal((await fetch(`${url}${path}`)).status, 404);
  }
});

test("returns explicit safe errors instead of a successful-looking cached number", async (t) => {
  const codes = [];
  const url = await listen(app({
    log: (code) => codes.push(code),
    client: { getSummary: async () => { throw new WidgetError("no_data", "No sensor readings.", 503); } },
  }), t);
  const response = await fetch(`${url}/api/homepage`);
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: "No sensor readings.", code: "no_data" });
  assert.deepEqual(codes, ["no_data"]);
});

test("never returns or logs unexpected exception contents", async (t) => {
  const codes = [];
  const url = await listen(app({
    log: (code) => codes.push(code),
    client: { getSummary: async () => { throw new Error("private-token and private-reading"); } },
  }), t);
  const response = await fetch(`${url}/api/homepage`);
  assert.equal(response.status, 500);
  assert.equal((await response.json()).code, "unexpected_error");
  assert.deepEqual(codes, ["unexpected_error"]);
});

test("the published Homepage example maps four existing text fields", async () => {
  const yaml = await readFile(new URL("../examples/services.yaml", import.meta.url), "utf8");
  const mappings = [...yaml.matchAll(/^\s+- field: (\w+)$/gm)].map((match) => match[1]);
  assert.deepEqual(mappings, ["glucose", "trend", "age", "status"]);
  assert.equal([...yaml.matchAll(/format: text/g)].length, 4);
  assert.match(yaml, /type: customapi/);
  assert.match(yaml, /refreshInterval: 30000/);
  for (const entries of [[entry()], [entry(123, 20)], [entry(5)]]) {
    const summary = summarize(entries, settings(), now);
    assert.ok(mappings.every((field) => typeof summary[field] === "string"));
  }
});
