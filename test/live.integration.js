import test from "node:test";
import { readConfig } from "../src/config.js";
import { createNightscoutClient } from "../src/nightscout.js";
import { createApp } from "../src/server.js";
import { listen } from "./helpers.js";

test("opt-in live Nightscout to adapter HTTP contract (no readings logged)", {
  skip: process.env.NIGHTSCOUT_LIVE_TEST !== "1",
}, async (t) => {
  // Do not use assertions with raw actual/expected payloads: failures must stay private too.
  const config = readConfig();
  const client = createNightscoutClient(config, { log: () => {} });
  const server = createApp(config, { client, log: () => {} });
  const url = await listen(server, t);
  const response = await fetch(`${url}/api/homepage`, {
    headers: config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {},
  });
  if (!response.ok) throw new Error(`Live adapter check failed (HTTP ${response.status}); response withheld.`);
  const summary = await response.json();
  const fields = ["age", "delta", "glucose", "stale", "status", "trend"];
  if (Object.keys(summary).sort().join() !== fields.join()) {
    throw new Error("Live adapter response has an unexpected field set; response withheld.");
  }
  if (!fields.filter((key) => key !== "stale").every((key) => typeof summary[key] === "string") ||
      typeof summary.stale !== "boolean") {
    throw new Error("Live adapter response has incorrect field types; response withheld.");
  }
  if (!["Current", "Stale data", "Sensor error"].includes(summary.status)) {
    throw new Error("Live adapter response has an unknown status; response withheld.");
  }
  if (summary.status === "Current" && !/^\d+(?:\.\d)? (?:mg\/dL|mmol\/L)$/.test(summary.glucose)) {
    throw new Error("Live adapter glucose formatting is invalid; response withheld.");
  }
  if (response.headers.get("cache-control") !== "no-store") {
    throw new Error("Live adapter response was not marked no-store.");
  }
});
