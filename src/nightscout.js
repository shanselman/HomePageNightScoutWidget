import { WidgetError } from "./config.js";
import { summarize } from "./glucose.js";

const maxBytes = 128 * 1_024;

async function readJson(response) {
  if (!/^application\/json(?:\s*;|$)/i.test(response.headers.get("content-type") || "")) {
    await response.body?.cancel();
    throw new WidgetError("invalid_response", "Nightscout did not return JSON.");
  }
  if (Number(response.headers.get("content-length")) > maxBytes || !response.body) {
    await response.body?.cancel();
    throw new WidgetError("invalid_response", "Nightscout response was empty or too large.");
  }
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        throw new WidgetError("invalid_response", "Nightscout response was too large.");
      }
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new WidgetError("invalid_response", "Nightscout returned malformed JSON.");
  }
}

export function safeError(error) {
  return error instanceof WidgetError
    ? error
    : new WidgetError("unexpected_error", "The Nightscout adapter encountered an unexpected error.", 500);
}

export function createNightscoutClient(config, {
  fetchImpl = fetch,
  now = Date.now,
  log = (code) => console.error(`Nightscout adapter: ${code}`),
} = {}) {
  let snapshot;
  let failure;
  let expires = 0;
  let inFlight;

  async function refresh() {
    try {
      const response = await fetchImpl(config.url, {
        method: "GET",
        headers: config.headers,
        redirect: "error",
        signal: AbortSignal.timeout(config.timeoutMs),
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw new WidgetError("upstream_http", `Nightscout request failed (HTTP ${response.status}).`);
      }
      const entries = await readJson(response);
      summarize(entries, config, now());
      snapshot = entries;
      failure = undefined;
    } catch (error) {
      snapshot = undefined;
      failure = error instanceof WidgetError ? error : new WidgetError(
        error?.name === "TimeoutError" || error?.name === "AbortError" ? "upstream_timeout" : "upstream_network",
        error?.name === "TimeoutError" || error?.name === "AbortError"
          ? "Nightscout request timed out."
          : "Cannot reach Nightscout. Check connectivity, TLS, and URL configuration.",
      );
      log(failure.code);
    } finally {
      expires = now() + config.pollMs;
    }
  }

  return {
    async getSummary() {
      if (now() >= expires && !inFlight) {
        inFlight = refresh().finally(() => { inFlight = undefined; });
      }
      if (inFlight) await inFlight;
      if (failure) throw failure;
      return summarize(snapshot, config, now());
    },
  };
}
