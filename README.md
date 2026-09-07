# Aureon Terminal 3.0

Plain HTML/CSS/JavaScript market workbench with native WebGPU geometry and an independent Canvas fallback. The v3 upgrade extends the merged v2 application with 26 chart styles, 73 configurable studies, 66 drawing tools, editable 16-chart layouts, bounded scripting, causal pattern scans, financial models and opt-in private services.

This is original runnable software, **not complete TradingView or Pine compatibility**. The precise implementation inventory, model approximations, engine-only surfaces and remaining provider/product gaps are in [FEATURE_MATRIX.md](FEATURE_MATRIX.md).

## Run and verify

Node.js 22 or newer. No npm dependency installation is required.

```sh
npm run build
npm run check
npm start
# http://localhost:4173
# http://localhost:4173/?demo — explicitly synthetic deterministic demonstration
```

`npm test` runs 400 numerical, protocol, worker, state-machine, security and private-service tests. `npm run build` regenerates `dist/AureonTerminal.html`, including both worker bundles. Build before testing a source archive that omits the distribution; bundle tests intentionally require the real generated worker code.

## Start with Pro tools

The **Pro tools** analysis tab contains Analytics, Patterns, Actual trades, Script tools, Execution tools, Research feeds, Security & delivery, Collaboration and Accessible data. The existing chart, editor, tester, order simulator, screener, alert and workspace panels remain available.

Use Analytics to edit model assumptions as JSON and compute option Greeks/IV, bond analytics, curves, actions/rolls, FX or AMM results. Null is unavailable/undefined, not a fabricated zero. Patterns scans the currently loaded history with confirmation-delayed pivots. Actual trades imports `{symbol, source, trades}` with ascending UTC-second `t`, positive `price`/`size`, and aggressor `side: "buy" | "sell" | "unknown"`; this data powers footprint/TPO and tick/volume/range views. Imported trades must match the selected symbol and are never relabeled live.

**Layout** selects up to 16 charts. Each secondary tile has its own drawing/scale/study controls, undo/redo and history. Drawing replication is opt-in and only between matching symbols. Primary chart selection remains the execution instrument; focusing another tile does not silently reroute orders.

The script editor supports bounded collections, typed records/methods, local versioned libraries and named strategy commands. Pro Script tools exposes executed-line profiling and local script screening. The portfolio tester uses named lots and next-raw-bar execution; its magnifier refuses print data that fails OHLCV reconciliation. See [SCRIPTING.md](SCRIPTING.md).

## Static hosting versus private server

GitHub Pages and the standalone HTML serve only the client. Accounts, research credentials, persistent script/drawing monitors, notification delivery, shared rooms and external brokerage require the included Node process. The PWA caches only the public self-contained shell, icon and manifest, never private API responses or broker data. Prepare offline installation through Pro → Accessible data on localhost/HTTPS. PWA/notification support is browser-dependent.

Default startup has **no real-money route enabled and no provider credentials**. The ordinary tickets are simulations. The existing external paper account remains paper-only. v3 also contains a separately disabled production adapter with a narrow manually confirmed whole-share DAY-limit workflow; it must not be mistaken for an enabled brokerage service.

## Configure private services

`.env.example` documents all variables. Node reads process.env; on Node 22, `node --env-file=.env server.mjs` loads a local environment file explicitly. Do not commit real `.env` files, keys, private state or backups.

Bootstrap named owner/moderator accounts on localhost **without credentials**, stop the process, then restart with the desired owner usernames and provider variables. Privileged roles bind only to pre-existing account IDs at startup; registration cannot claim them in the current process. Disable public registration for private installations. Network binding requires an explicit `AUREON_ORIGIN` and an HTTPS reverse proxy.

Research supports fixed destinations: Alpaca data snapshots/news, FRED vintage observations and SEC facts. External notifications require operator-bound recipients or signed webhook aliases, followed by the user’s explicit channel consent. Email/SMS may incur provider charges. No credentials or recipients are provisioned by this repository.

Read [SECURITY.md](SECURITY.md) before configuring any remote or live service, [deployment/README.md](deployment/README.md) for the optional Docker/Caddy installation, and [TESTING.md](TESTING.md) for what was actually exercised. Browser testing requires separately installed Python Playwright/Chromium; these are development tools, not application dependencies.

## Source map

`src/renderer.js` and `chart*.js` implement rendering and viewports. `studies*.js`, `patterns.js`, `market-analytics.js` and `tick-charts.js` are numerical modules. `script*.js` implement the interpreter; `execution*.js` implement simulation. `pro-workbench.js` connects v3 workflows to the DOM. `server/*-pro.mjs`, `live-gateway.mjs` and `script-runner.mjs` implement gated private services. `scripts/backup.mjs` creates authenticated encrypted offline backups, including the MFA vault key.

MIT licensed. TradingView and other product/provider names identify scope references and integrations, not affiliation or equivalence.
