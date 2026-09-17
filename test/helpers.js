export const now = Date.UTC(2026, 0, 15, 12, 0);

export function entry(sgv = 123, minutesAgo = 2, extra = {}) {
  return { type: "sgv", sgv, date: now - minutesAgo * 60_000, direction: "Flat", ...extra };
}

export function settings(extra = {}) {
  return {
    url: new URL("https://nightscout.example.com/api/v1/entries.json"),
    headers: { Accept: "application/json" },
    units: "mg/dL",
    staleMs: 600_000,
    pollMs: 30_000,
    timeoutMs: 1_000,
    host: "127.0.0.1",
    port: 3001,
    apiKey: "",
    ...extra,
  };
}

export function json(data, init = {}) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: { "content-type": "application/json", ...init.headers },
  });
}

export async function listen(server, t) {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  t.after(() => new Promise((resolve) => {
    server.closeAllConnections();
    server.close(resolve);
  }));
  return `http://127.0.0.1:${server.address().port}`;
}
