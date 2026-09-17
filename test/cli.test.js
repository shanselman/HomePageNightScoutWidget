import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { listen } from "./helpers.js";

const script = fileURLToPath(new URL("../src/server.js", import.meta.url));
const env = {
  PATH: process.env.PATH,
  SystemRoot: process.env.SystemRoot,
  NIGHTSCOUT_URL: "https://nightscout.example.com",
  HOST: "127.0.0.1",
};

test("CLI rejects bad configuration without printing a private URL or token", () => {
  const result = spawnSync(process.execPath, [script], {
    env: {
      ...env,
      NIGHTSCOUT_URL: "https://synthetic-private.example/?token=synthetic-private-token",
      PORT: "invalid",
    },
    encoding: "utf8",
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /PORT must be an integer/);
  assert.equal(result.stderr.includes("synthetic-private"), false);
});

test("CLI reports a bind failure with no raw exception details", async (t) => {
  const occupied = createServer();
  await listen(occupied, t);
  const result = spawnSync(process.execPath, [script], {
    env: { ...env, PORT: String(occupied.address().port) },
    encoding: "utf8",
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /could not listen/);
  assert.equal(result.stderr.includes("EADDRINUSE"), false);
});

test("CLI starts a responsive health endpoint without querying Nightscout", async (t) => {
  const reservation = createServer();
  await listen(reservation, t);
  const port = reservation.address().port;
  await new Promise((resolve) => reservation.close(resolve));
  const child = spawn(process.execPath, [script], {
    env: { ...env, PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  t.after(async () => {
    if (child.exitCode === null) {
      child.kill();
      await once(child, "exit");
    }
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("CLI startup timed out.")), 5_000);
    child.once("error", (error) => { clearTimeout(timer); reject(error); });
    child.once("exit", () => { clearTimeout(timer); reject(new Error("CLI exited before becoming ready.")); });
    child.stdout.on("data", (data) => {
      if (data.toString().includes("listening on port")) {
        clearTimeout(timer);
        resolve();
      }
    });
  });
  const response = await fetch(`http://127.0.0.1:${port}/healthz`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: "ok" });
});
