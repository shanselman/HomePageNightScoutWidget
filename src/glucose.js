import { WidgetError } from "./config.js";

const arrows = new Map([
  ["TripleUp", "\u290a"], ["DoubleUp", "\u21c8"], ["SingleUp", "\u2191"],
  ["FortyFiveUp", "\u2197"], ["Flat", "\u2192"], ["FortyFiveDown", "\u2198"],
  ["SingleDown", "\u2193"], ["DoubleDown", "\u21ca"], ["TripleDown", "\u290b"],
]);
const earliestTimestamp = Date.UTC(2000, 0, 1);

function invalidData() {
  return new WidgetError("invalid_data", "Nightscout returned invalid glucose data.");
}

function timestamp(entry) {
  if (entry.date !== undefined) {
    if (!Number.isFinite(entry.date) || entry.date < earliestTimestamp ||
        entry.date > 8_640_000_000_000_000) throw invalidData();
    return Math.trunc(entry.date);
  }
  if (typeof entry.dateString !== "string" ||
      !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(entry.dateString)) {
    throw invalidData();
  }
  const value = Date.parse(entry.dateString);
  if (!Number.isFinite(value) || value < earliestTimestamp) throw invalidData();
  return value;
}

function ageText(ageMs) {
  const minutes = Math.floor(ageMs / 60_000);
  if (minutes < 1) return "<1m ago";
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 1_440) return `${Math.floor(minutes / 60)}h ${minutes % 60}m ago`;
  return `${Math.floor(minutes / 1_440)}d ${Math.floor(minutes % 1_440 / 60)}h ago`;
}

function formatted(value, units) {
  const number = units === "mmol/L" ? Number((value / 18).toFixed(1)) : value;
  return units === "mmol/L" ? number.toFixed(1) : String(number);
}

export function summarize(entries, config, now = Date.now()) {
  if (!Array.isArray(entries) || entries.length > 100) throw invalidData();
  const readings = [];
  for (const entry of entries) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw invalidData();
    if (entry.type !== undefined && entry.type !== "sgv") continue;
    const date = timestamp(entry);
    if (!Number.isSafeInteger(entry.sgv) || entry.sgv < 1 || entry.sgv > 1_000) throw invalidData();
    if (date > now + 60_000) {
      throw new WidgetError("future_data", "Nightscout reading is in the future. Check the uploader clock.");
    }
    readings.push({ date, sgv: entry.sgv, direction: entry.direction });
  }
  if (!readings.length) throw new WidgetError("no_data", "Nightscout has no sensor glucose readings.", 503);
  readings.sort((a, b) => b.date - a.date);
  const unique = [];
  for (const reading of readings) {
    const previous = unique.at(-1);
    if (previous?.date === reading.date) {
      if (previous.sgv !== reading.sgv) throw invalidData();
    } else {
      unique.push(reading);
    }
  }
  const latest = unique[0];
  const ageMs = Math.max(0, now - latest.date);
  const age = ageText(ageMs);
  const stale = ageMs >= config.staleMs;
  if (stale || latest.sgv < 39) {
    return {
      glucose: stale ? "STALE" : "Sensor error",
      trend: "-",
      delta: "-",
      age,
      status: stale ? "Stale data" : "Sensor error",
      stale,
    };
  }
  const arrow = arrows.get(latest.direction) || "?";
  const previous = unique[1];
  const gap = previous ? latest.date - previous.date : 0;
  let delta = "-";
  let trend = arrow;
  // A change is between actual adjacent readings, not an assumed five-minute rate.
  if (previous && previous.sgv >= 39 && gap >= 120_000 && gap <= 600_000) {
    const change = formatted(latest.sgv - previous.sgv, config.units);
    const signed = Number(change) > 0 ? `+${change}` : change;
    delta = `${signed} ${config.units}`;
    const interval = Number((gap / 60_000).toFixed(1));
    trend = `${arrow} ${signed} (${interval}m)`;
  }
  return {
    glucose: `${formatted(latest.sgv, config.units)} ${config.units}`,
    trend,
    delta,
    age,
    status: "Current",
    stale: false,
  };
}
