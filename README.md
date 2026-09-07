# Aureon Terminal 4.2

Plain HTML/CSS/JavaScript market workbench with native WebGPU geometry and an independent Canvas fallback. The application includes 26 chart styles, 84 configurable studies, 66 drawing tools, editable 16-chart layouts, bounded scripting, causal pattern scans, financial models and opt-in private services.

This is an independent implementation, with explicitly documented supported APIs and operating limits. The precise implementation inventory, model approximations, engine-only surfaces and remaining provider/product gaps are in [FEATURE_MATRIX.md](FEATURE_MATRIX.md).

## Run and verify

Node.js 22.16 or newer. No npm dependency installation is required.

```sh
npm run build
npm run check
npm start
# http://localhost:4173
# http://localhost:4173/?demo — explicitly synthetic deterministic demonstration
```

`npm test` runs 546 numerical, protocol, worker, state-machine, security and private-service tests. `npm run build` regenerates `dist/AureonTerminal.html`, including both worker bundles. Build before testing a source archive that omits the distribution; bundle tests intentionally require the real generated worker code.

## New in 4.2

**Studies** adds rolling median, quantile channels, interquartile range and normalized median deviation, residual-RMS regression channels, regression R²/error, log-return autocorrelation, return/volume-change correlation, directional efficiency and UTC-session VWAP deviation bands. New statistical kernels use a bounded float64 moment tree and an AVL order-statistics multiset; they do not fill gaps or read future samples.

**Pro tools → Script tools → Parallel script screener** executes the selected editor indicator over your imported research universe, not an implicit exchange-wide dataset. Choose one UTC cutoff and 1–4 workers. Each scan captures source, inputs, libraries and fully closed raw bars; later input edits cannot change an in-flight scan. Current and previous values of all named plots support threshold and crossing filters, stable sorting, pagination, saved queries and CSV/JSON report export. Cancellation terminates only the screener's workers. Every dataset error stays visible; missing values are never fabricated as zeros. Clicking an eligible result opens the exact closed dataset used in that scan.

Start with `examples/distribution-screen.aureon`. Use **Research → Import JSON** with the documented version-1 universe format; all supplied provenance labels remain visible. Screening accepts up to 100 datasets and 500,000 input bars, with a per-symbol interpreter budget. A workerless environment has a separate 10,000-bar/250,000-operation limit. Opening a row in the chart requires a supported chart interval and at most 100,000 bars; other rows remain analyzable/exportable.

```sh
npm run benchmark:statistics
# Optional workload: node scripts/benchmark-statistics.mjs 20000 512
```

The benchmark compares float64 results with explicit reference implementations before reporting median-of-three CPU times. Results are specific to the machine and synthetic workload, not browser/GPU or tick-throughput guarantees.

## New in v4

Shared drawing rooms now merge concurrent property edits and provide authored selective undo, duplicate-safe retries and recovery of pending operations after tab reload. Script output can create retained lines, boxes, labels and tables in the chart. Named function arguments, nested versioned libraries and causal position/equity feedback extend the bounded interpreter.

An opt-in SQLite backend allows multiple Node processes on one host to share sessions and transactional state. Monitor leases, persistent crossing baselines, shared rate limits, fenced notification attempts, atomic vault initialization and SQLite-aware encrypted backup support that deployment mode. This is not multi-node high availability.

## Start with Pro tools

The **Pro tools** analysis tab contains Analytics, Patterns, Actual trades, Script tools, Execution tools, Research feeds, Security & delivery, Collaboration and Accessible data. The existing chart, editor, tester, order simulator, screener, alert and workspace panels remain available.

Use Analytics to edit model assumptions as JSON and compute option Greeks/IV, bond analytics, curves, actions/rolls, FX or AMM results. Null is unavailable/undefined, not a fabricated zero. Patterns scans the currently loaded history with confirmation-delayed pivots. Actual trades imports `{symbol, source, trades}` with ascending UTC-second `t`, positive `price`/`size`, and aggressor `side: "buy" | "sell" | "unknown"`; this data powers footprint/TPO and tick/volume/range views. Imported trades must match the selected symbol and are never relabeled live.

**Layout** selects up to 16 charts. Each secondary tile has its own drawing/scale/study controls, undo/redo and history. Drawing replication is opt-in and only between matching symbols. Primary chart selection remains the execution instrument; focusing another tile does not silently reroute orders.

The script editor supports bounded collections, typed records/methods, local versioned libraries and named strategy commands. Pro Script tools exposes executed-line profiling and local script screening. The portfolio tester uses named lots and next-raw-bar execution; its magnifier refuses print data that fails OHLCV reconciliation. See [SCRIPTING.md](SCRIPTING.md).

## Shared drawing workflow

Run the private server, sign in from each browser, and create a room with the intended members in **Pro tools → Collaboration**. Load the room, then explicitly join its drawing document. Edits merge per property; undo disables only the author's operation instead of overwriting another member's work. Same-symbol tile participation uses the existing opt-in drawing synchronization setting.

Pending operations stay in tab session storage until acknowledged. Reloading and explicitly rejoining recovers them; **Flush and leave** refuses to discard failed writes. Closing the tab can clear that storage. Membership is checked server-side, including at commit time. Document capacity is bounded rather than silently truncating history.

## Static hosting versus private server

GitHub Pages and the standalone HTML serve only the client. Accounts, research credentials, persistent script/drawing monitors, notification delivery, shared rooms and external brokerage require the included Node process. The PWA caches only the public self-contained shell, icon and manifest, never private API responses or broker data. Prepare offline installation through Pro → Accessible data on localhost/HTTPS. PWA/notification support is browser-dependent.

Default startup has **no real-money route enabled and no provider credentials**. The ordinary tickets are simulations. The existing external paper account remains paper-only. The source also contains a separately disabled production adapter with a narrow manually confirmed whole-share DAY-limit workflow; it must not be mistaken for an enabled brokerage service.

## Configure private services

`.env.example` documents all variables. Node reads process.env; on Node 22, `node --env-file=.env server.mjs` loads a local environment file explicitly. Do not commit real `.env` files, keys, private state or backups.

Bootstrap named owner/moderator accounts on localhost **without credentials**, stop the process, then restart with the desired owner usernames and provider variables. Privileged roles bind only to pre-existing account IDs at startup; registration cannot claim them in the current process. Disable public registration for private installations. Network binding requires an explicit `AUREON_ORIGIN` and an HTTPS reverse proxy.

Research supports fixed destinations: Alpaca data snapshots/news, FRED vintage observations and SEC facts. External notifications require operator-bound recipients or signed webhook aliases, followed by the user’s explicit channel consent. Email/SMS may incur provider charges. No credentials or recipients are provisioned by this repository.

Read [SECURITY.md](SECURITY.md) before configuring any remote or live service, [deployment/README.md](deployment/README.md) for the optional Docker/Caddy installation, and [TESTING.md](TESTING.md) for what was actually exercised. Browser testing requires separately installed Python Playwright/Chromium; these are development tools, not application dependencies.

## Same-host shared storage

Default `AUREON_STORAGE=json` remains one-process-only. For several processes on the same host, set `AUREON_STORAGE=sqlite` and point each process at the same `AUREON_DATA_DIR` on a **local filesystem**. Use distinct ports and the same configured public origin behind your proxy. Keep operator/provider configuration consistent. The first SQLite startup migrates existing JSON only when initializing an empty database.

Do not place a WAL database on shared network storage or run this configuration across hosts. Transaction callbacks serialize writes to a bounded logical payload; this favors a small private service, not horizontal database scaling. Shared monitor leases prevent stale commits, but notifications remain at-least-once and event streams replay a bounded shared journal across local processes. The drawing client polls committed operations so a reconnect can reach another local process.

Before changing storage mode, stop the service and make an encrypted backup with `scripts/backup.mjs`. Set `AUREON_STORAGE=json` or `AUREON_STORAGE=sqlite` on the backup command to select the active store. If both storage files exist without an explicit choice, backup refuses to guess. SQLite backups read a committed logical snapshot, including current WAL commits. Restore to a new directory and rehearse startup before routing users there.

## Source map

`src/renderer.js` and `chart*.js` implement rendering and viewports. `studies*.js`, `patterns.js`, `market-analytics.js` and `tick-charts.js` are numerical modules. `script*.js` implement the interpreter; `execution*.js` implement simulation. `pro-workbench.js` connects the Pro workflows to the DOM. `server/*-pro.mjs`, `live-gateway.mjs` and `script-runner.mjs` implement gated private services. `scripts/backup.mjs` creates authenticated encrypted offline backups, including the MFA vault key.

`src/drawing-crdt.js` and `drawing-sync.js` implement collaborative drawing state and transport. `script-graphics*.js` implements retained script objects and rendering. `server/sqlite-store.mjs`, `lease.mjs`, `rate-limit.mjs` and `drawing-rooms.mjs` implement the new shared persistence and authorization boundaries.

MIT licensed. Provider names identify optional integrations, not affiliation or endorsement.

## New in 4.1

**Script editor → Realtime** starts an indicator-only worker session from the selected market history. Accepted trade observations retain `varip` state while ordinary state rolls back to the confirmed prefix. Stop/cancel, replay, context changes, authoritative history changes, reconnects and queue errors require an explicit restart. This is a bounded correctness-oriented re-evaluation engine, not a claim of incremental or exchange-tick throughput. No strategy order is sent from realtime mode.

**Shared drawing rooms** now save each unacknowledged operation in IndexedDB, scoped to account/room/symbol. Closing a tab no longer intentionally deletes that queue; explicitly rejoin the room to recover it. New tabs use independent replica identities. Acknowledgement removes only the exact operation IDs and contents returned by the server. Browser eviction, clearing site data or closing before a write commits can still lose edits; the UI reports unsaved recovery writes.

**Pro tools → Actual trades** exposes diagonal or same-row imbalances, minimum classified volume, stacked consecutive rows and a volume value area. Missing rows remain unknown rather than zero-volume evidence. Retained script objects are rebuilt on the initial replay seek and on rewind, and stale worker completions cannot restore explicitly removed plots.

**Shared event delivery** stores alert/message/workspace/room notifications in the same transaction as the source mutation. SQLite processes read the same bounded journal. EventSource reconnects use `Last-Event-ID`; expired history signals an explicit resync rather than pretending nothing was missed. See [ARCHITECTURE.md](ARCHITECTURE.md) for retention and delivery limits.

## 4.3 renderer reliability and verification

The primary chart Settings now expose Auto/WebGPU or Canvas, 1x/4x GPU
antialiasing, an explicit WebGPU retry, downloadable diagnostics, and a six-case
GPU pixel check. Diagnostics never contain account credentials or market data.
The pixel check creates a separate temporary device and sends no external traffic.

The renderer retains the last accepted geometry independently of the chart's
mutable build buffer. Device loss immediately repaints that frame using Canvas.
Switching backends does not recreate analysis workers or mutate drawings/prices.
GPU devices and compiled pipelines are shared across charts; canvas targets and
buffers are owned and released by each individual chart.

Geometry is capped at 262,144 primitives per chart, with omissions reported.
Backing stores (including the text overlay) are capped at 8,388,608 pixels and
8,192 pixels per side; adapter limits can reduce GPU resolution further.
Diagnostic pixel capture is limited to 4,194,304 pixels. Size limits reduce
rendering resolution, never the underlying financial dataset.

Run `node --test tests/v43-renderer.test.js` for isolated lifecycle/bounds tests.
Run `python scripts/verify-browser-v43.py` with Playwright and Chromium installed
for real WGSL, MSAA, texture readback and simulated device-loss checks using the
explicitly selected SwiftShader software adapter. That suite fails, rather than
claiming a Canvas fallback as GPU verification, if WebGPU is unavailable.
Physical GPU throughput and driver-crash recovery are separate, unverified targets.

The actual-device renderer verifier requires a graphical display. On a Linux test
host, run `xvfb-run -a python scripts/verify-browser-v43.py` after installing the
Playwright Chromium test dependencies. GitHub CI provisions this virtual display
automatically. Its software-adapter flags belong only to the isolated deterministic
test browser, not a recommended configuration for browsing untrusted sites.
