# Stock Homepage integration check

This optional check uses Homepage **v2.4.0**
(`6b6926108e35c3902dd23f6bc337162b7289450b`), Node 24 and pnpm. It adds
no adapter dependencies. Run these PowerShell commands from the adapter root.
The clone command refuses to overwrite an existing checkout; reuse only the
dedicated checkout created by this procedure.

```powershell
if (Test-Path .local\homepage) { throw "Checkout already exists; do not overwrite it." }
git clone --depth 1 --branch v2.4.0 https://github.com/gethomepage/homepage.git .local\homepage
```

```powershell
Copy-Item test\homepage\customapi.adapter.test.jsx .local\homepage\src\test-utils\customapi.adapter.test.jsx
Push-Location .local\homepage
try {
    if ((git rev-parse HEAD) -ne "6b6926108e35c3902dd23f6bc337162b7289450b") {
        throw "Unexpected upstream revision."
    }
    pnpm exec vitest run src\test-utils\customapi.adapter.test.jsx --reporter=verbose
} finally {
    Pop-Location
}
```

Try the test command before installing dependencies. Some pnpm versions
automatically install a missing dependency tree. If dependencies are missing,
run `pnpm install --frozen-lockfile` inside `.local\homepage`, then retry the
test command. If the default registry warns or fails, use
`pnpm install --frozen-lockfile --registry=https://packagefeedproxy.microsoft.io/npm/`.

The seven tests import the adapter's actual `summarize()` and read the four
mappings directly from `examples\services.yaml`. They execute upstream Custom
API rendering, its real API hook, configuration cleaner, request router and
generic proxy. Current mg/dL and mmol/L, transition to stale, explicit HTTP
failure, retained-data transport failure, and server-side URL/header handling
are checked. Homepage's own Vitest setup supplies translation/authentication
mocks and Testing Library cleanup.

Boundaries are mocked: SWR delivery, outbound `httpProxy`, and service lookup.
Only Custom API is registered; Docker/Kubernetes/config discovery and logging
are disabled. This is component/proxy-contract integration, not a running
Next.js site, browser end-to-end, real HTTP transport, Docker, or a Nightscout
availability check. All readings and authorization values are synthetic; the
test never calls `readConfig()`, reads Nightscout environment variables, or
contacts Nightscout. The upstream checkout and dependency tree stay under the
ignored `.local` directory.

## Verified run

On 2026-09-17, Windows with Node **24.14.0**, pnpm **11.5.2**, and upstream
Vitest **4.1.10** completed **7 passed, 0 failed, 0 skipped** in 2.10 seconds.
The first command inside the fresh clone was `pnpm test -- --help`; this pnpm
version automatically installed the locked dependencies before showing help.
No separate install or registry fallback was needed. The final execution used
the `pnpm exec vitest run` command above.

The displayed current values were `180 mg/dL`, `→ +9 (5m)`, `2m ago`, `Current`
and `10.0 mmol/L`, `→ +0.5 (5m)`, `2m ago`, `Current`. Advancing the synthetic
clock to the 10-minute boundary displayed `STALE`, `-`, `10m ago`, `Stale data`.
Both explicit HTTP 502 and transport errors removed the previous glucose
blocks. The proxy retained the configured synthetic authorization server-side,
ignored client URL/header/body overrides, and forwarded GET only.

Two initial test-harness issues were corrected: Vite could not import an
out-of-root Windows file URL, and a rerender initially lost the settings
provider. Neither required upstream or adapter changes. Upstream emitted a
nonfatal esbuild/oxc configuration warning. Its tracked files remained
unchanged; the executed test copy matched the persistent test byte-for-byte.
