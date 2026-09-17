import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { createNightscoutClient } from "../src/nightscout.js";
import { entry, json, listen, now, settings } from "./helpers.js";

test("only uses read-only GET, JSON negotiation, bounded timeout and no redirects", async () => {
  let calls = 0;
  const config = settings();
  const client = createNightscoutClient(config, {
    now: () => now,
    fetchImpl: async (url, options) => {
      calls++;
      assert.equal(url, config.url);
      assert.equal(options.method, "GET");
      assert.equal(options.headers.Accept, "application/json");
      assert.equal(options.redirect, "error");
      assert.ok(options.signal instanceof AbortSignal);
      assert.equal(options.body, undefined);
      return json([entry()]);
    },
  });
  assert.equal((await client.getSummary()).glucose, "123 mg/dL");
  await client.getSummary();
  assert.equal(calls, 1);
});

test("coalesces concurrent requests and recalculates age/freshness from cached entries", async () => {
  let clock = now;
  let calls = 0;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const client = createNightscoutClient(settings(), {
    now: () => clock,
    fetchImpl: async () => {
      calls++;
      await gate;
      return json([entry(123, 9.9)]);
    },
  });
  const requests = Array.from({ length: 10 }, () => client.getSummary());
  release();
  assert.ok((await Promise.all(requests)).every((result) => result.status === "Current"));
  assert.equal(calls, 1);
  clock += 6_000;
  assert.equal((await client.getSummary()).glucose, "STALE");
  assert.equal((await client.getSummary()).age, "10m ago");
  assert.equal(calls, 1);
  clock += 24_000;
  await client.getSummary();
  assert.equal(calls, 2);
});

test("failure clears a previous successful result, is rate-limited, and recovers", async () => {
  let clock = now;
  let fail = false;
  let calls = 0;
  const codes = [];
  const client = createNightscoutClient(settings(), {
    now: () => clock,
    log: (code) => codes.push(code),
    fetchImpl: async () => {
      calls++;
      if (fail) throw new Error("https://private.example?token=private-token response: private-data");
      return json([entry()]);
    },
  });
  await client.getSummary();
  clock += 30_000;
  fail = true;
  await assert.rejects(client.getSummary(), { code: "upstream_network" });
  await assert.rejects(client.getSummary(), { code: "upstream_network" });
  assert.equal(calls, 2);
  assert.deepEqual(codes, ["upstream_network"]);
  clock += 30_000;
  fail = false;
  assert.equal((await client.getSummary()).status, "Current");
  assert.equal(calls, 3);
});

for (const status of [301, 401, 403, 429, 500, 503]) {
  test(`surfaces HTTP ${status} without the upstream body`, async () => {
    const client = createNightscoutClient(settings(), {
      now: () => now,
      log: () => {},
      fetchImpl: async () => new Response("private-upstream-body", { status }),
    });
    await assert.rejects(client.getSummary(), (error) => {
      assert.equal(error.code, "upstream_http");
      assert.equal(error.message, `Nightscout request failed (HTTP ${status}).`);
      return true;
    });
  });
}

for (const [name, response, code] of [
  ["HTML login page", () => new Response("<html>private</html>", { headers: { "content-type": "text/html" } }), "invalid_response"],
  ["malformed JSON", () => new Response("{private", { headers: { "content-type": "application/json" } }), "invalid_response"],
  ["empty body", () => new Response(null, { headers: { "content-type": "application/json" } }), "invalid_response"],
  ["large content length", () => json([], { headers: { "content-length": "200000" } }), "invalid_response"],
  ["oversize chunked data", () => json(["x".repeat(128 * 1024)]), "invalid_response"],
  ["invalid entries", () => json({ private: "not an array" }), "invalid_data"],
  ["missing entries", () => json([]), "no_data"],
]) {
  test(`rejects ${name} with a sanitized error`, async () => {
    const client = createNightscoutClient(settings(), {
      now: () => now,
      log: () => {},
      fetchImpl: async () => response(),
    });
    await assert.rejects(client.getSummary(), (error) => {
      assert.equal(error.code, code);
      assert.equal(error.message.includes("private"), false);
      return true;
    });
  });
}

test("timeout aborts an actual slow HTTP request", async (t) => {
  const upstream = createServer(() => {});
  const url = await listen(upstream, t);
  const client = createNightscoutClient(settings({ url: new URL(url), timeoutMs: 30 }), { log: () => {} });
  await assert.rejects(client.getSummary(), { code: "upstream_timeout" });
});

test("timeout also bounds a stalled streaming response body", async (t) => {
  const upstream = createServer((request, response) => {
    response.writeHead(200, { "content-type": "application/json" });
    response.write("[");
  });
  const url = await listen(upstream, t);
  const client = createNightscoutClient(settings({ url: new URL(url), timeoutMs: 100 }), { log: () => {} });
  await assert.rejects(client.getSummary(), { code: "upstream_timeout" });
});

test("does not follow a real redirect or transmit credentials to its target", async (t) => {
  let targetCalls = 0;
  const targetUrl = await listen(createServer((request, response) => {
    targetCalls++;
    response.end("[]");
  }), t);
  const sourceUrl = await listen(createServer((request, response) => {
    response.writeHead(302, { Location: targetUrl });
    response.end();
  }), t);
  const client = createNightscoutClient(settings({
    url: new URL(`${sourceUrl}/?token=synthetic-private-token`),
    headers: { "api-secret": "synthetic-private-secret" },
  }), { log: () => {} });
  await assert.rejects(client.getSummary(), { code: "upstream_network" });
  assert.equal(targetCalls, 0);
});

test("end-to-end fetch through a real synthetic Nightscout HTTP server", async (t) => {
  const upstream = createServer((request, response) => {
    assert.equal(request.method, "GET");
    assert.equal(request.headers.accept, "application/json");
    response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    response.end(JSON.stringify([entry(), entry(118, 7)]));
  });
  const url = await listen(upstream, t);
  const client = createNightscoutClient(settings({ url: new URL(url) }), { now: () => now });
  assert.equal((await client.getSummary()).trend, "\u2192 +5 (5m)");
});
