import { createHash } from "node:crypto";

export class WidgetError extends Error {
  constructor(code, message, status = 502) {
    super(message);
    this.name = "WidgetError";
    this.code = code;
    this.status = status;
  }
}

function integer(env, name, fallback, min, max) {
  const value = env[name] || String(fallback);
  if (!/^\d+$/.test(value) || Number(value) < min || Number(value) > max) {
    throw new Error(`${name} must be an integer from ${min} to ${max}.`);
  }
  return Number(value);
}

export function readConfig(env = process.env) {
  let url;
  try {
    url = new URL(env.NIGHTSCOUT_URL);
  } catch {
    throw new Error("Set NIGHTSCOUT_URL to an absolute Nightscout URL.");
  }
  if (env.ALLOW_HTTP && !["true", "false"].includes(env.ALLOW_HTTP)) {
    throw new Error("ALLOW_HTTP must be true or false.");
  }
  if (url.protocol !== "https:" && !(url.protocol === "http:" && env.ALLOW_HTTP === "true")) {
    throw new Error("NIGHTSCOUT_URL requires HTTPS. ALLOW_HTTP=true is for trusted local networks only.");
  }
  if (url.username || url.password || url.hash) {
    throw new Error("NIGHTSCOUT_URL must not contain basic credentials or a fragment.");
  }
  const allowedParams = new Set(["token", "count", "find[type]"]);
  for (const key of url.searchParams.keys()) {
    if (!allowedParams.has(key) || url.searchParams.getAll(key).length !== 1) {
      throw new Error("NIGHTSCOUT_URL accepts only a single token, count, and find[type] query parameter.");
    }
  }
  const urlToken = url.searchParams.get("token") || "";
  if (urlToken && env.NIGHTSCOUT_TOKEN) {
    throw new Error("Set a token in NIGHTSCOUT_TOKEN or NIGHTSCOUT_URL, not both.");
  }
  const token = env.NIGHTSCOUT_TOKEN || urlToken;
  if (token && env.NIGHTSCOUT_API_SECRET) {
    throw new Error("Use a read-only token or NIGHTSCOUT_API_SECRET, not both.");
  }
  if (/[\r\n]/.test(token || "") || /[\r\n]/.test(env.WIDGET_API_KEY || "")) {
    throw new Error("Tokens and API keys must not contain line breaks.");
  }
  const path = url.pathname.replace(/\/+$/, "");
  if (/\/api\/v1\/entries(?:\/sgv)?(?:\.json)?$/.test(path)) {
    url.pathname = path.replace(/(?:\/sgv)?(?:\.json)?$/, ".json");
  } else {
    if (/\/api(?:\/|$)/.test(path)) {
      throw new Error("Use a Nightscout base URL or its /api/v1/entries.json endpoint.");
    }
    url.pathname = `${path}/api/v1/entries.json`;
  }
  url.search = "";
  url.searchParams.set("count", "12");
  url.searchParams.set("find[type]", "sgv");
  if (token) url.searchParams.set("token", token);

  const units = env.NIGHTSCOUT_UNITS || "mg/dL";
  if (!["mg/dL", "mmol/L"].includes(units)) {
    throw new Error("NIGHTSCOUT_UNITS must be mg/dL or mmol/L.");
  }
  const staleMinutes = integer(env, "STALE_AFTER_MINUTES", 10, 2, 60);
  const pollSeconds = integer(env, "POLL_INTERVAL_SECONDS", 30, 5, 300);
  if (pollSeconds >= staleMinutes * 60) {
    throw new Error("POLL_INTERVAL_SECONDS must be shorter than STALE_AFTER_MINUTES.");
  }
  const headers = { Accept: "application/json" };
  if (env.NIGHTSCOUT_API_SECRET) {
    headers["api-secret"] = createHash("sha1").update(env.NIGHTSCOUT_API_SECRET).digest("hex");
  }
  return {
    url,
    headers,
    units,
    staleMs: staleMinutes * 60_000,
    pollMs: pollSeconds * 1_000,
    timeoutMs: integer(env, "REQUEST_TIMEOUT_SECONDS", 8, 1, 30) * 1_000,
    port: integer(env, "PORT", 3001, 1, 65535),
    host: env.HOST || "127.0.0.1",
    apiKey: env.WIDGET_API_KEY || "",
  };
}
