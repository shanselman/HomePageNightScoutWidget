# Homepage Nightscout Widget: Blood Glucose and CGM Dashboard

Display your **Nightscout blood sugar (blood glucose) readings on the
[Homepage dashboard](https://gethomepage.dev/)**. This free, open-source
Nightscout integration brings continuous glucose monitoring (CGM) data to your
self-hosted homelab dashboard using Homepage's **built-in Custom API widget**
(`customapi`).

Show the latest sensor glucose, trend arrow, change, and reading age in mg/dL
or mmol/L. Run the small adapter with **Docker Compose or Node.js**, connect
your existing [Nightscout](https://nightscout.github.io/) server, and add the
provided `services.yaml` configuration. No Homepage fork, custom build, or
browser-side Nightscout credentials.

This project is for **[gethomepage/homepage](https://github.com/gethomepage/homepage)**
at **gethomepage.dev**, not a browser start-page extension or Home Assistant card.

**Setup:** [Docker Compose](#docker-alongside-an-existing-homepage) |
[Node.js](#quick-start-nodejs) |
[Homepage widget configuration](#add-the-homepage-service) |
[Compatibility FAQ](#nightscout-and-homepage-faq)

**Synthetic example, not a real reading:**

| Glucose | Trend / change | Updated | Status |
| --- | --- | --- | --- |
| 123 mg/dL | &#8594; +5 (5m) | 2m ago | Current |

The same reading in mmol/L displays `6.8 mmol/L` and a change of `+0.3`.
After ten minutes without a new reading, the glucose becomes **STALE**,
the trend/change disappears, and the status becomes **Stale data**.

> **An informational dashboard, not a medical device or an alerting system.**
> Do not use this widget for treatment decisions. It does not issue alarms,
> control insulin delivery, or replace your CGM, Nightscout, or their alerts.
> Like any web page, a disconnected or suspended browser can retain an old
> display. "Current" means recently uploaded, not clinically safe or in range.

## What this is

A small, dependency-free Node.js service that reads Nightscout and returns only
the fields needed by Homepage:

```text
Homepage browser -> Homepage server -> this adapter -> Nightscout API v1
                     customapi         credentials      GET entries only
```

Homepage does not currently support installing external native widgets.
This project uses `type: customapi`, **not** `type: nightscout`. It works with
stock Homepage. The container and browser flow have been verified with
Homepage **v2.3.0**, and the component/proxy integration suite targets **v2.4.0**.

Features:

- mg/dL or mmol/L; trend arrows and change over the actual reading interval.
- Freshness recalculated on every request, even when upstream data is cached.
- Explicit stale, sensor-error, empty-data, and connection-error handling.
- HTTPS verification, request timeout, bounded responses, no redirects.
- Server-side read-only token or legacy API-secret authentication.
- No runtime packages, database, telemetry, stored readings, or background polling.
- Synthetic unit/HTTP tests and a separate, opt-in live test that withholds readings.

This is a service-card widget, not a header widget. It has no graph, adaptive
glucose-range colors, or dosing/pump features. Those are deliberately outside
this small adapter's scope.

## Nightscout and Homepage FAQ

### How do I show blood sugar readings on my Homepage dashboard?

Run this Nightscout adapter, set `NIGHTSCOUT_URL` and any required read-only
token, then add the [Homepage Custom API configuration](#add-the-homepage-service)
to `services.yaml`. The widget displays glucose, trend/change, last-reading age,
and a current/stale status. A complete
[Docker Compose setup](#docker-alongside-an-existing-homepage) is included.

### Do I need a native Nightscout widget or a custom Homepage build?

No. This is an unofficial **Homepage Nightscout widget** built on the existing
`type: customapi` integration. It works with stock Homepage without installing
a plugin or changing Homepage's source code.

### Does this connect directly to Dexcom or FreeStyle Libre?

No. Your CGM readings must already be available from a compatible Nightscout
server. The adapter reads the **Nightscout API v1**, not Dexcom Share,
LibreLinkUp, a manufacturer's cloud account, or CGM hardware directly.
It does not collect your CGM account credentials.

### Can the widget display mmol/L instead of mg/dL?

Yes. Set `NIGHTSCOUT_UNITS=mmol/L` to display glucose and changes in mmol/L.
The default is mg/dL. See [configuration](#configuration) for all options,
including polling and stale-reading thresholds.

## Quick start: Node.js

Install **Node.js 24 or later**. There is no `npm install` step.

```powershell
git clone https://github.com/shanselman/HomePageNightScoutWidget.git
Set-Location HomePageNightScoutWidget
Copy-Item .env.example .env
```

Edit `.env`: set your Nightscout URL and, for a protected site, a token with the
**readable** role. Then:

```powershell
npm run start:env
```

The service listens on `127.0.0.1:3001` by default. For a liveness check:

```powershell
Invoke-RestMethod http://127.0.0.1:3001/healthz
```

If `NIGHTSCOUT_URL` is **already in your environment**, you can skip the `.env`
file entirely and use `npm start`. Node's environment-file loading gives
already-set process environment variables precedence over the file; unset an
old variable before expecting `.env` to replace it.

Only `/api/homepage` fetches data; `/healthz` reports process liveness and never
requests glucose. A healthy process does **not** guarantee a current reading.

## Docker alongside an existing Homepage

The included [compose.yaml](compose.yaml) builds a small Node image and joins
an **existing** Homepage Docker network. It does not replace or restart Homepage,
publish a host port, or mount the Docker socket.

1. Copy `.env.example` to `.env` and configure Nightscout.
2. Set `HOMEPAGE_NETWORK` in `.env` to the network your Homepage container uses
   (for example, `homepage_default`). Find it in your existing Compose project or
   container's network settings.
3. Start the adapter:

```powershell
docker compose up -d --build
docker compose logs --tail 20 nightscout-widget
```

The container runs as a non-root user with a read-only filesystem, all Linux
capabilities dropped, and no new privileges. Compose overrides `HOST` and `PORT`
to `0.0.0.0:3001` **inside the container** so Homepage can reach it over the
shared network. This does not bind a host port.

The Docker health check is liveness-only. After modifying `.env`, recreate the
adapter with `docker compose up -d --force-recreate nightscout-widget`.
Build locally; this repository does not publish a prebuilt container image.

## Add the Homepage service

Merge [examples/services.yaml](examples/services.yaml) into your Homepage
`services.yaml` (do not replace your existing services):

```yaml
- Health:
    - Nightscout:
        description: Glucose at a glance
        widget:
          type: customapi
          url: http://nightscout-widget:3001/api/homepage
          refreshInterval: 30000
          mappings:
            - field: glucose
              label: Glucose
              format: text
            - field: trend
              label: Trend / change
              format: text
            - field: age
              label: Updated
              format: text
            - field: status
              label: Status
              format: text
```

`refreshInterval` is in **milliseconds**. Keep all four mappings as `text`;
the adapter has already applied units, precision, and freshness handling.
Homepage block layout displays at most four fields. You can substitute the
optional `delta` field for `trend` if you prefer the change without an arrow.

The URL is resolved by the **Homepage server**, not your browser:

| Deployment | Adapter URL / configuration |
| --- | --- |
| Both containers on the shared network | `http://nightscout-widget:3001/api/homepage` |
| Both processes on the same host, without containers | `http://127.0.0.1:3001/api/homepage` |
| Homepage in Docker, adapter on its host | Use a reachable host address, e.g. `host.docker.internal` on Docker Desktop; set adapter `HOST` appropriately and restrict the firewall |
| Separate machines | Use a private-network address or HTTPS reverse proxy, restrict access, and configure the adapter key below |

`localhost` inside Homepage's container refers to **Homepage's container**,
not the adapter or your workstation. On native Linux, `host.docker.internal`
may require an explicit `host-gateway` entry.

If you add an `href` to the service, use your **token-free** Nightscout address.
An `href` is sent to the browser; it is not a secret configuration field.
Never enable Homepage's `hideErrors` option for this widget.

### Optional adapter authentication

The adapter key is separate from your Nightscout token. Configure
`WIDGET_API_KEY` with a random value in the adapter environment. In Homepage's
environment, set `HOMEPAGE_VAR_NIGHTSCOUT_WIDGET_KEY` to that same value, then add
these lines under the widget in `services.yaml`:

```yaml
headers:
  Authorization: "Bearer {{HOMEPAGE_VAR_NIGHTSCOUT_WIDGET_KEY}}"
```

Do not paste the key into a committed YAML file. `/api/homepage` then requires
that bearer key; `/healthz` remains unauthenticated and exposes no readings.
Use HTTPS or an isolated trusted container network for this connection:
a bearer key alone does not encrypt traffic.

## Configuration

| Environment variable | Default | Meaning |
| --- | --- | --- |
| `NIGHTSCOUT_URL` | Required | Base URL or API v1 entries URL; reverse-proxy subpaths supported |
| `NIGHTSCOUT_TOKEN` | Empty | Recommended: Nightscout access token with the `readable` role |
| `NIGHTSCOUT_API_SECRET` | Empty | Alternative raw API secret; SHA-1 hashed into the `api-secret` header |
| `NIGHTSCOUT_UNITS` | `mg/dL` | Exactly `mg/dL` or `mmol/L` |
| `STALE_AFTER_MINUTES` | `10` | Reading becomes stale at this age; integer 2-60 |
| `POLL_INTERVAL_SECONDS` | `30` | Minimum interval between upstream requests; integer 5-300, shorter than stale threshold |
| `REQUEST_TIMEOUT_SECONDS` | `8` | Whole upstream request/body deadline; integer 1-30 |
| `HOST` | `127.0.0.1` | Listen address; Compose overrides to `0.0.0.0` inside the container |
| `PORT` | `3001` | Listen port; Compose overrides to `3001` |
| `ALLOW_HTTP` | `false` | Set exactly `true` only for a trusted local HTTP Nightscout server |
| `WIDGET_API_KEY` | Empty | Optional bearer key protecting the adapter's glucose endpoint |
| `HOMEPAGE_NETWORK` | `homepage_default` | Existing external Docker network; Compose only |

Accepted URLs include `https://nightscout.example.com`,
`https://nightscout.example.com/api/v1/entries.json`, and
`https://nightscout.example.com/cgm/api/v1/entries/sgv.json`.
An existing URL with `?token=...` is supported, but a separate token variable
is preferable. Do not configure both token locations or combine a token with
an API secret. Supply the **raw**, not pre-hashed, API secret if using that
legacy option; it may grant more privileges than this read-only service needs.

The adapter always requests `count=12` and `find[type]=sgv`, replacing these
two parameters if supplied. Other query parameters, URL basic credentials,
fragments, and API v3 URLs are rejected to avoid ambiguous configuration.

## Data and failure behavior

Nightscout API v1 stores `sgv` in mg/dL, regardless of your Nightscout site's
display preference. This adapter explicitly converts mmol/L by dividing by 18
and displaying one decimal place; it does not infer units from the site.

The latest **sensor** reading is selected by timestamp, not array order.
Fractional epoch milliseconds are accepted and truncated to milliseconds.
Legacy timezone-qualified `dateString` timestamps are accepted when `date`
is absent. Duplicate readings are collapsed; conflicting duplicates, malformed
sensor entries, and timestamps more than 60 seconds in the future are errors,
not excuses to silently show an older reading.

| Condition | Result |
| --- | --- |
| Recent valid reading | Glucose, arrow/change, age, `Current` |
| Age at or above the configured threshold | `STALE`, no numeric glucose/trend/change, age, `Stale data` |
| Latest fresh `sgv` below 39 | `Sensor error`, no glucose/trend/change; follows Nightscout's error-code convention |
| Unknown/missing direction | `?`; a valid change may still be shown, but direction is not inferred |
| No previous reading, sensor error in previous reading, or gap outside 2-10 minutes | No calculated change; never assumes a five-minute sample interval |
| No sensor readings | HTTP 503 with sanitized `no_data` error |
| Invalid data, HTTP/auth failure, network/TLS failure, or timeout | HTTP 502 with a sanitized error; Homepage displays its error widget |
| Unexpected internal failure | HTTP 500 with a generic error; no exception details |

Changes are between the newest two distinct readings, not a fitted trend or a
rate prediction. For example, `+5 (7m)` means an increase of five in the selected
display units across seven actual minutes. The separate `delta` field includes
units, while `trend` uses the units shown in `glucose`.

Successful and failed upstream attempts are cached in memory for the poll
interval to limit load; concurrent requests share one attempt. **Any refresh
failure discards the previous good result.** Age and stale state are recomputed
on every adapter response, so a cached reading can become stale before the next
upstream fetch. No requests run while nobody is querying the adapter.

All responses use `Cache-Control: no-store`. Browser/ Homepage polling still
limits update frequency, and a frozen/disconnected dashboard cannot be made
into a reliable medical display by server-side checks.

### JSON endpoint

`GET /api/homepage` returns this fixed six-field shape on current/stale/sensor
states. This example is entirely synthetic:

```json
{
  "glucose": "123 mg/dL",
  "trend": "\u2192 +5 (5m)",
  "delta": "+5 mg/dL",
  "age": "2m ago",
  "status": "Current",
  "stale": false
}
```

An unavailable response is non-2xx, for example
`{"error":"Nightscout has no sensor glucose readings.","code":"no_data"}`.
Only GET is allowed; request query parameters cannot select another upstream
URL. The adapter is not a general-purpose proxy.

## Privacy

Keep both Homepage and this adapter **private**. Homepage's server-side proxy
hides Nightscout credentials, but **anyone who can view your Homepage can read
the widget's glucose data**. Anyone who can reach an unkeyed adapter endpoint
can also read it. Host allowlists and CORS are not user authentication.

The adapter sends only six normalized fields to Homepage. Its Custom API
mappings are presentation rules, not server-side response filtering, so directly
mapping a raw Nightscout response would disclose the whole response to viewers.
This adapter omits raw entries, device names, record IDs, notes, and URLs.

Logs contain static error codes, not URLs, tokens, response bodies, or readings.
Your Nightscout server/reverse proxy may still log incoming query-token URLs;
protect those logs. `.env`, logs, local checkouts, keys, and test output directories
are gitignored, and the Docker build context includes only source, manifest,
and license. Do not upload personal screenshots or real-data fixtures in issues.

## Development and tests

```powershell
npm run check
npm test
npm run test:coverage
```

Tests use Node's built-in runner, assertions, HTTP server, and fetch.
They do not require npm packages, Docker, Nightscout, or credentials, and do not
load `.env` or use your live URL.

Coverage includes normalization, unit conversion, all direction arrows, actual
delta intervals, duplicate/out-of-order data, freshness at the exact threshold,
fractional timestamps, sensor errors, malformed payloads, timeouts against a
real local server, redirect refusal, response-size limits, concurrency, cache
failure/recovery, HTTP routes, bearer authentication, redaction, and the four
published Homepage mappings.

### Stock Homepage component and proxy checks

[test/homepage/INTEGRATION.md](test/homepage/INTEGRATION.md) documents a
reproducible check against the pinned Homepage v2.4.0 release. Seven tests
exercise its actual Custom API component, API hook, configuration cleaner,
request router, and generic proxy using this adapter's summary and example YAML.
They verify both units, the stale transition, HTTP/transport errors, and
server-side URL/header handling. External transport and SWR delivery are mocked;
this is not a browser end-to-end test or a Docker deployment test.

The upstream checkout and its dependencies stay in the ignored `.local`
directory, separate from this dependency-free adapter.

The Docker deployment has also been exercised with stock Homepage v2.3.0:
shared-network connectivity, adapter authentication, the real Homepage proxy,
four rendered fields, and automatic 30-second refresh were verified in a
browser. No private configuration, readings, or screenshots are included here.

### Optional live smoke test

Live checks are **excluded from `npm test`** and also require an explicit flag.
Use your existing Nightscout environment:

```powershell
$env:NIGHTSCOUT_LIVE_TEST = "1"
npm run test:live
Remove-Item Env:NIGHTSCOUT_LIVE_TEST
```

Or use `npm run test:live:env` instead to load `.env`. The test makes one
read-only request through a temporary loopback adapter, verifies the normalized
HTTP contract, and closes the server. It neither prints nor saves actual
readings, URLs, tokens, or upstream bodies, including on failure.
Stale data and sensor-error states can pass the contract check; passing does
**not** certify that data is fresh or medically accurate.

Never use live glucose in CI, committed fixtures, screenshots, or public logs.
Use synthetic data for repeatable unit/component tests.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Homepage shows a missing widget | Use `type: customapi`, not `type: nightscout` |
| Connection refused / cannot resolve adapter | Shared Docker network, URL as seen from Homepage, listen address and firewall |
| HTTP 401 from adapter | `WIDGET_API_KEY` matches Homepage's bearer header |
| Nightscout HTTP 401 or 403 | Readable token, expired token, or API secret; changing Nightscout's secret changes its tokens |
| `upstream_network` | Exact URL, trusted HTTPS certificate, DNS, connectivity; redirects are deliberately refused |
| `invalid_response` | API path and JSON content type; HTML login pages and responses over 128 KiB are rejected |
| `invalid_data` / `future_data` | Uploader payloads/timestamps and clock synchronization; do not weaken validation to hide a sensor problem |
| `STALE` | Last sensor timestamp, uploader connection, and refresh interval; restarting the adapter does not make old data current |
| Compose network not found | Set `HOMEPAGE_NETWORK` to Homepage's existing network |

If using a private CA, configure Node's trust with `NODE_EXTRA_CA_CERTS`
and a read-only mounted CA file. Do not disable TLS certificate verification.

## Design references and license

The integration follows Homepage's server-side proxy and text-mapping model.
Upstream's native-widget examples separate loading/error/data states and mock
API boundaries; this project's standalone tests exercise the equivalent
boundaries without copying Homepage's frontend or requiring its toolchain.

- [Homepage Custom API widget](https://gethomepage.dev/widgets/services/customapi/)
- [Homepage widget authoring](https://gethomepage.dev/widgets/authoring/tutorial/)
- [Homepage v2.4.0 Custom API implementation](https://github.com/gethomepage/homepage/blob/v2.4.0/src/widgets/customapi/component.jsx)
- [Homepage Gatus widget tests](https://github.com/gethomepage/homepage/blob/v2.4.0/src/widgets/gatus/component.test.jsx)
- [Nightscout security and readable tokens](https://nightscout.github.io/nightscout/security/)
- [Nightscout API v1 entries](https://github.com/nightscout/cgm-remote-monitor/blob/master/lib/api/entries/index.js)

Original adapter code is [MIT licensed](LICENSE). Homepage and Nightscout are
separate open-source projects with their own licenses. This repository does not
bundle their implementations and is not an official component of either project.
