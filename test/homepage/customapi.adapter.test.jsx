// @vitest-environment jsdom
// Run inside the pinned Homepage checkout; see INTEGRATION.md.

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";

import { screen, within } from "@testing-library/react";
import { load } from "js-yaml";
import { beforeEach, describe, expect, it, vi } from "vitest";

import handler from "pages/api/services/proxy";
import createMockRes from "test-utils/create-mock-res";
import { renderWithProviders } from "test-utils/render-with-providers";
import { cleanServiceGroups } from "utils/config/service-helpers";
import { SettingsContext } from "utils/contexts/settings";
import Component from "widgets/customapi/component";
import customapi from "widgets/customapi/widget";

const mocks = vi.hoisted(() => ({
  useSWR: vi.fn(),
  getServiceWidget: vi.fn(),
  httpProxy: vi.fn(),
  widgets: {},
}));

vi.mock("swr", () => ({ default: mocks.useSWR }));
vi.mock("utils/proxy/http", () => ({ httpProxy: mocks.httpProxy }));
vi.mock("widgets/widgets", () => ({ default: mocks.widgets }));
vi.mock("widgets/calendar/proxy", () => ({ default: vi.fn() }));
vi.mock("utils/logger", () => ({
  default: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));
// Keep the real cleaner, but never read host configuration or discover devices.
vi.mock("utils/config/service-helpers", async (importOriginal) => ({
  ...(await importOriginal()),
  default: mocks.getServiceWidget,
}));
vi.mock("utils/config/config", () => ({
  default: vi.fn(),
  CONF_DIR: ".",
  getSettings: () => ({}),
  substituteEnvironmentVars: (text) => text,
}));
vi.mock("utils/config/docker", () => ({ default: vi.fn() }));
vi.mock("utils/config/kubernetes", () => ({ getKubeConfig: vi.fn() }));
vi.mock("utils/kubernetes/export", () => ({ default: {} }));

const adapterRoot = resolve(process.cwd(), "..", "..");
// Node 24 loads the adapter's ESM outside Vite's upstream project root.
const { summarize } = createRequire(import.meta.url)(resolve(adapterRoot, "src", "glucose.js"));
const example = load(readFileSync(resolve(adapterRoot, "examples", "services.yaml"), "utf8"));
const exampleService = example[0].Health[0].Nightscout;
const now = Date.parse("2026-09-17T12:00:00Z");
const readings = [
  { type: "sgv", sgv: 180, direction: "Flat", date: now - 2 * 60_000 },
  { type: "sgv", sgv: 171, direction: "FortyFiveUp", date: now - 7 * 60_000 },
];
const config = { units: "mg/dL", staleMs: 10 * 60_000 };
const syntheticAuthorization = "Bearer integration-only-not-a-real-key";

let serverService;
let browserService;

function apiData(data, error) {
  mocks.useSWR.mockReturnValue({ data, error });
}

function renderWidget() {
  const settings = { hideErrors: false };
  const result = renderWithProviders(<Component service={browserService} />, { settings });
  // Upstream's helper wraps the initial element, not Testing Library's rerender.
  return {
    ...result,
    rerender: (ui) => result.rerender(
      <SettingsContext.Provider value={{ settings, setSettings: () => {} }}>{ui}</SettingsContext.Provider>,
    ),
  };
}

function expectBlocks(container, values) {
  expect(container.querySelectorAll(".service-block")).toHaveLength(4);
  for (const [label, value] of Object.entries(values)) {
    const block = screen.getByText(label, { exact: true }).closest(".service-block");
    expect(block).not.toBeNull();
    expect(within(block).getByText(value, { exact: true })).toBeVisible();
  }
}

function request(extra = {}) {
  return {
    method: "GET",
    query: { group: "Health", service: "Nightscout", index: "0" },
    ...extra,
  };
}

describe("Nightscout adapter with stock Homepage v2.4.0", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.widgets.customapi = customapi;
    serverService = { name: "Nightscout", ...structuredClone(exampleService) };
    serverService.widget.headers = { Authorization: syntheticAuthorization };
    const cleaned = cleanServiceGroups([{ name: "Health", services: [structuredClone(serverService)] }]);
    browserService = { ...cleaned[0].services[0], widget: cleaned[0].services[0].widgets[0] };
    mocks.getServiceWidget.mockResolvedValue(serverService.widget);
  });

  it("uses the pinned release and all four mappings from the actual example", () => {
    expect(JSON.parse(readFileSync("package.json", "utf8")).version).toBe("2.4.0");
    expect(exampleService.widget.type).toBe("customapi");
    expect(exampleService.widget.mappings).toEqual([
      { field: "glucose", label: "Glucose", format: "text" },
      { field: "trend", label: "Trend / change", format: "text" },
      { field: "age", label: "Updated", format: "text" },
      { field: "status", label: "Status", format: "text" },
    ]);
  });

  it.each([
    ["mg/dL", "180 mg/dL", "\u2192 +9 (5m)"],
    ["mmol/L", "10.0 mmol/L", "\u2192 +0.5 (5m)"],
  ])("renders current glucose, trend/change, age and status in %s", (units, glucose, trend) => {
    apiData(summarize(readings, { ...config, units }, now));
    const { container } = renderWidget();
    expectBlocks(container, { Glucose: glucose, "Trend / change": trend, Updated: "2m ago", Status: "Current" });
    expect(mocks.useSWR).toHaveBeenCalledWith(expect.any(String), { refreshInterval: 30_000 });
    expect(mocks.httpProxy).not.toHaveBeenCalled();
  });

  it("replaces current numbers with STALE at the configured age boundary", () => {
    apiData(summarize(readings, config, now));
    const { container, rerender } = renderWidget();
    expect(screen.getByText("180 mg/dL")).toBeVisible();
    apiData(summarize(readings, config, now + 8 * 60_000));
    rerender(<Component service={browserService} />);
    expectBlocks(container, { Glucose: "STALE", "Trend / change": "-", Updated: "10m ago", Status: "Stale data" });
    expect(screen.queryByText("180 mg/dL")).not.toBeInTheDocument();
    expect(screen.queryByText("\u2192 +9 (5m)")).not.toBeInTheDocument();
  });

  it("keeps the adapter URL and authorization server-side while retaining the mappings", async () => {
    const summary = summarize(readings, config, now);
    apiData(summary);
    const { container } = renderWidget();
    expect(browserService.widget).not.toHaveProperty("url");
    expect(browserService.widget).not.toHaveProperty("headers");
    expect(browserService.widget.mappings).toEqual(exampleService.widget.mappings);

    const proxyUrl = mocks.useSWR.mock.calls[0][0];
    const parsed = new URL(proxyUrl, "http://homepage.test");
    expect(parsed.pathname).toBe("/api/services/proxy");
    expect(Object.fromEntries(parsed.searchParams)).toEqual({
      group: "Health", service: "Nightscout", index: "0", query: '{"refreshInterval":30000}',
    });

    mocks.httpProxy.mockResolvedValue([200, "application/json", Buffer.from(JSON.stringify(summary))]);
    const res = createMockRes();
    await handler(request({
      method: "POST",
      body: "ignored-client-body",
      headers: { Authorization: "Bearer ignored-client-key" },
      query: { ...Object.fromEntries(parsed.searchParams), url: "https://not-requested.invalid" },
    }), res);

    expect(mocks.getServiceWidget).toHaveBeenCalledWith("Health", "Nightscout", "0");
    expect(mocks.httpProxy).toHaveBeenCalledTimes(1);
    const [url, options] = mocks.httpProxy.mock.calls[0];
    expect(url.href).toBe(exampleService.widget.url);
    expect(options).toEqual({ method: "GET", headers: { Authorization: syntheticAuthorization } });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body.toString())).toEqual(summary);
    for (const output of [JSON.stringify(browserService), proxyUrl, container.innerHTML, res.body.toString()]) {
      expect(output).not.toContain(syntheticAuthorization);
      expect(output).not.toContain(exampleService.widget.url);
    }
  });

  it("renders the real proxy's explicit upstream HTTP error instead of glucose blocks", async () => {
    apiData(summarize(readings, config, now));
    const { container, rerender } = renderWidget();
    mocks.httpProxy.mockResolvedValue([
      502,
      "application/json",
      Buffer.from(JSON.stringify({ error: "Nightscout is unavailable.", code: "upstream_error" })),
    ]);
    const res = createMockRes();
    await handler(request(), res);
    expect(res.statusCode).toBe(502);
    expect(res.body.error.message).toBe("HTTP Error");
    expect(res.body.error.url).toBe("nightscout-widget (see logs for details)");

    apiData(res.body);
    rerender(<Component service={browserService} />);
    expect(container.querySelector("summary")).toHaveTextContent("widget.api_error");
    expect(screen.getByText("HTTP Error")).toBeInTheDocument();
    expect(container).toHaveTextContent("Nightscout is unavailable.");
    expect(container.querySelectorAll(".service-block")).toHaveLength(0);
    expect(screen.queryByText("180 mg/dL")).not.toBeInTheDocument();
    expect(container.innerHTML).not.toContain(syntheticAuthorization);
    expect(container.innerHTML).not.toContain(exampleService.widget.url);
  });

  it("does not keep showing a previous reading after a transport error", () => {
    const summary = summarize(readings, config, now);
    apiData(summary);
    const { container, rerender } = renderWidget();
    apiData(summary, new Error("Synthetic adapter connection failure"));
    rerender(<Component service={browserService} />);
    expect(container.querySelector("summary")).toHaveTextContent("widget.api_error");
    expect(screen.getByText("Synthetic adapter connection failure")).toBeInTheDocument();
    expect(container.querySelectorAll(".service-block")).toHaveLength(0);
    expect(screen.queryByText("180 mg/dL")).not.toBeInTheDocument();
  });
});
