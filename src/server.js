import { createHash, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { pathToFileURL } from "node:url";
import { readConfig } from "./config.js";
import { createNightscoutClient, safeError } from "./nightscout.js";

function digest(value) {
  return createHash("sha256").update(value).digest();
}

export function createApp(config, {
  client = createNightscoutClient(config),
  log = (code) => console.error(`Nightscout adapter: ${code}`),
} = {}) {
  const expectedAuth = config.apiKey ? digest(`Bearer ${config.apiKey}`) : undefined;
  return createServer(async (request, response) => {
    const send = (status, body) => {
      response.writeHead(status, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
      });
      response.end(JSON.stringify(body));
    };
    if (request.method !== "GET") {
      response.setHeader("Allow", "GET");
      send(405, { error: "Only GET is supported.", code: "method_not_allowed" });
      return;
    }
    if (request.url === "/healthz") {
      send(200, { status: "ok" });
      return;
    }
    if (request.url !== "/api/homepage") {
      send(404, { error: "Not found.", code: "not_found" });
      return;
    }
    if (expectedAuth && !timingSafeEqual(expectedAuth, digest(request.headers.authorization || ""))) {
      response.setHeader("WWW-Authenticate", "Bearer");
      send(401, { error: "Adapter authorization required.", code: "unauthorized" });
      return;
    }
    try {
      send(200, await client.getSummary());
    } catch (error) {
      const safe = safeError(error);
      log(safe.code);
      send(safe.status, { error: safe.message, code: safe.code });
    }
  });
}

function main() {
  let config;
  try {
    config = readConfig();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
    return;
  }
  const server = createApp(config);
  server.on("error", () => {
    console.error("Nightscout adapter could not listen. Check HOST and PORT.");
    process.exitCode = 1;
  });
  server.listen(config.port, config.host, () => {
    console.log(`Nightscout adapter listening on port ${config.port}.`);
  });
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.once(signal, () => {
      server.close();
      setTimeout(() => { server.closeAllConnections(); }, 2_000).unref();
    });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
