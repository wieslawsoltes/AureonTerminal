# Aureon Terminal 2.0 — verification report

## Recorded result

The release was checked with Node.js 22.16.0 and Chromium 144 on Linux.

| Verification | Result |
|---|---|
| JavaScript/module syntax check | Passed |
| Automated Node tests | **226 passed, 0 failed, 0 skipped, 0 TODO** |
| Browser interaction groups | **46 passed, 0 failed** |
| Captured browser page JavaScript errors | **0** |
| Standalone source build | Passed; client embeds both workers without runtime package/CDN dependencies |
| Actual WebGPU device/shader execution | **Not exercised in this environment** |
| GPU performance / production throughput | **Not measured** |
| Actual authenticated external paper provider | **Not exercised** |
| End-to-end production Coinbase transport | **Not established by this test run** |

The Node runner reports 211 top-level tests and 15 nested subtests, for 226 total. Some browser groups make several assertions; 46 is a group count, not a claim about exhaustive UI coverage. Reports are under `verification/v2/`.

## Reproduce numerical and server checks

```sh
npm run build
npm run check
```

No npm dependencies are required. The tests use native Node test/assert/http/worker APIs. Server tests bind ephemeral loopback ports and use temporary private directories that are deleted after the test. Provider tests inject deterministic protocol fixtures; no credentials, external order placement or live quote availability are required.

| Test file | Coverage |
|---|---|
| `core.test.js` | v1 OHLCV, merging/aggregation, CSV/schema, study reference behavior, accounting and undo compatibility. |
| `data.test.js` | v1 provider normalization/protocol behavior and source handling. |
| `worker.test.js` | v1 worker calculations and error identity. |
| `v2-studies.test.js` | Configurable numerical studies, reference calculations, warm-up and all 33 registry types' prefix causality. |
| `v2-script.test.js` | Lexer/parser, assignments/branches/history/functions/loops, input types, indicators/strategy output, higher-timeframe no-lookahead alignment, budgets and unsupported-access diagnostics. |
| `v2-execution.test.js` | Long/short economics, fees/reversals, partial fills, partial OCO reduction, brackets, stops/limits/trailing, IOC/expiry, amendments, maintenance, stale quotes, restore validation, next-open execution and holdout isolation. |
| `v2-protocol.test.js` | Derived bars, 37 drawing constructions, profiles/order flow, L2 snapshots/updates, aggressor classification, research/workspace validation, sessions and alert frequency/crossing semantics. |
| `v2-server.test.js` | Password/session behavior, same-origin/CSRF/Host protection, private paths, ownership, revision races, ideas, SSE isolation, persistence, paper-owner bootstrap, fixed provider hosts, monitor state and provider failure handling. |
| `v2-worker.test.js` | Actual advanced module worker handler in a Node worker-thread transport shim; study/script/backtest/error protocol and generated standalone worker-bundle equivalence. |

Tests are deterministic examples/invariants, not proof against every numerical, financial, security or browser failure. Generated UUID values differ between runs; economic assertions compare deterministic quantities rather than requiring identical random IDs.

## Browser verification

A development machine with Python Playwright and Chromium can run:

```sh
npm run build
python scripts/verify-browser-v2.py
```

Set `CHROMIUM` to a different browser executable when required. Python/Playwright are test-only dependencies and are not needed to run the application. The harness uses an explicit deterministic demo flag and never represents fixture prices as live quotes.

The groups exercise startup/provenance, nine new panels, actual study-parameter controls, all 15 chart render styles, a three-anchor channel and freehand stroke, undo/redo, grouping/locking, editor execution and input changes, script rejection/recovery, profiles, IANA settings, multi-chart layouts, comparisons, computed strategy results, train/holdout selection, replay order timing and rewind invalidation, screener/heatmap filtering, escaped research import, portable workspace provenance, PNG export, themes and retained v1 panels.

Some chart styles/layout operations use the exposed application/component API to select a state before drawing; other groups use real pointer, form and button interactions. This is functional browser regression, not a claim that every menu path, accessibility gesture, mobile layout and browser engine was exercised.

### Restricted browser environment

The available browser denied ordinary localhost navigation and blob worker execution. The harness therefore loaded the standalone document into an opaque `about:blank` document using `set_content`. The environment report records:

- `renderer: "Canvas 2D"`, with WebGPU unavailable;
- `secureContext: false`;
- `workerActive: false`, with an explicit policy-blocked fallback reason;
- deterministic synthetic demonstration data.

An independent minimal blob worker was also blocked. Consequently, browser tests exercised the bounded synchronous advanced-job fallback, not a functioning browser worker. The worker handler and generated bundle were separately tested through Node transport/VM execution. That does not certify browser worker startup, hardware WGSL compilation, resource lifetime under a real GPU, device-loss handling, authenticated Services UI or remote provider behavior.

Local storage/IndexedDB are also restricted in an opaque document. Portable serialization and backend persistence were tested, but cross-restart browser storage on a secure deployed origin still warrants a real-environment test.

## Visual evidence

`workspace-browser.png` shows the chart, computed custom script, configurable studies and a labeled synthetic source. `strategy-browser.png` shows the computed advanced tester. The images are browser captures of the executable application, not generated interface illustrations. Prices/performance visible in those captures are deterministic demonstration results, not live prices or investment results.

## Additional deployment validation still needed

On the intended machine/origin, verify native WebGPU initialization and shader compilation, browser workers, HTTPS storage, live Coinbase connectivity/recovery, actual broker entitlements, explicit paper order/cancel behavior with the owner's test account, concurrent long-running monitor load, browser memory, mobile/accessibility behavior, reverse-proxy origin settings, backups and security controls. No benchmark or production certification is inferred from the passing offline suite.
