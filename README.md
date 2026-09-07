# Aureon Terminal 2.0

A dependency-free, original trading/charting workspace using plain JavaScript, HTML and CSS. Native WebGPU geometry with Canvas fallback; configurable analysis; an original bounded scripting interpreter; raw-price strategy testing; local simulation; and optional private Node services.

**This release is not complete TradingView parity and does not implement Pine Script v6.** It is runnable software, not a static screen reproduction. See [FEATURE_MATRIX.md](FEATURE_MATRIX.md) for implemented features, approximation boundaries, provider requirements and functionality still absent.

## Run

Requires Node.js 22 or newer for the included server. No npm packages need installation.

```sh
npm start
# Open http://localhost:4173
```

Use `http://localhost:4173/?demo` for an explicit deterministic synthetic demonstration. Normal startup attempts the public Coinbase connection. An unavailable provider produces a visibly labeled cache or synthetic preview, never counterfeit live quotes.

```sh
npm run build  # Regenerate dist/AureonTerminal.html from canonical source modules
npm test      # Engine, protocol, worker and private-server tests
npm run check # JavaScript syntax validation followed by all tests
```

`dist/AureonTerminal.html` is a self-contained client with both worker bundles. It has no UI framework, external charting library, CDN runtime or build dependency. Serve the application from localhost or HTTPS for suitable origin/security behavior. File/opaque origins may disable workers, storage or WebGPU. The bounded synchronous computation fallback is limited to 10,000 bars for advanced jobs. The private account, persistent monitor, shared-ideas and external paper-adapter features require the included Node server; static hosting cannot supply those services.

## What changed from v1

| Subsystem | v2 implementation |
|---|---|
| Charts | 15 display styles: candlesticks, hollow candles, OHLC, line, area, Heikin-Ashi, step, baseline, columns, HLC, close-derived Renko, line break, Kagi, point-and-figure and range. |
| Studies | 33 configurable study types, up to 32 independent instances, independent colors/periods/pane placement, templates and the nine original quick studies. |
| Drawings | 37 tools including channels, pitchfork, regression, Fibonacci constructions, Gann fan, brush, polyline, risk/reward boxes and manually placed pattern annotations; grouping, layering, locking, hiding and numeric anchor editing. |
| Workspace | 1/2/4/6/8 chart layouts, linked time navigation/crosshairs, independent secondary symbols/intervals, IANA display zones and session shading. Secondary views are read-only historical views, not independent full editors or live subscriptions. |
| Scripting | AureonScript parser/interpreter, real computed plots, input controls, alerts and strategy signals. No JavaScript evaluation or network access. Explicit grammar and limits in SCRIPTING.md. |
| Strategy testing | Long/short, next-open signals, fees/slippage, leverage, protective stops/takes, equity/drawdown/trade statistics, CSV trades and a training-only parameter search with a separate holdout. |
| Execution | Signed-position local ledger, market/limit/stop/stop-limit/trailing orders, reduce-only, GTC/IOC, amendments in the engine, expiry, partial liquidity fills in the engine, OCO/brackets, accounting and maintenance checks. |
| Order flow | Public Coinbase L2 batch snapshot/update adapter, observed aggressor-side footprint, delta/CVD and observed tick profile. Live connection is explicit; disconnected books are invalidated. |
| Analysis | Visible-range OHLC volume-profile approximation; OHLC TPO approximation; comparisons/spreads; computed multi-symbol screener and weighted heatmap; imported research and observed seasonality. |
| Private server | Hashed/salted accounts, opaque sessions, CSRF, owner-isolated revisioned workspaces, SSE, persistent polled alerts, shared chart ideas/comments/likes and a fixed-host Alpaca **paper-only** adapter. |

## First workflows

**Studies and drawings.** Open **Studies**, add an instance, and change its parameters immediately. Save a template to reuse the set. **Drawing tools** opens the complete palette: two-anchor tools support dragging or click–click, multi-anchor tools use successive clicks, brush uses dragging, and polyline finishes with a double-click. **Object manager** edits anchors, groups, locks, visibility and order. Existing undo/redo remains available.

**Scripts.** Open **Script editor**, choose an example, edit its source, and press **Run** or Ctrl/Cmd+Enter. Inputs become real controls in the side panel. The interpreter recomputes series sequentially and reports source-location errors. Script definitions persist locally, but imported/reloaded source is not automatically executed merely because it exists in a project.

**Testing.** Open **Advanced tester**, select the EMA-cross strategy or the current script, set execution assumptions, and run. Changing chart display to Renko or Heikin-Ashi does not change the raw execution dataset. The train/holdout action selects one of 12 EMA pairs on the first 70% of loaded history and evaluates that selected pair on the remaining 30%, starting flat.

**Replay execution.** Start replay before placing a local simulated order on synthetic or imported history. Orders submitted after the currently shown close first encounter the next replayed bar. Rewinding invalidates the running replay account and requires reset; the software does not pretend to roll an already executed ledger backward. Live local simulation requires a recent bid/ask. The original simple spot-paper panel remains a separate ledger for backward compatibility; **Execution SIM** is the new long/short ledger.

**Data and screening.** CSV supplies raw OHLCV. Portable workspace JSON includes the selected raw history, studies, scripts and research but excludes execution accounts and credentials. Research JSON supplies a universe, events, fundamentals and news, with explicit source metadata. The screener computes its values from the supplied/loaded bars; it is not an exchange-wide fundamentals database.

## Private services

Start the server, open **Server**, and register a local account with a password of at least 12 characters. Accounts and services belong to your deployment, not TradingView. Workspaces are private to their owner. Publishing an idea deliberately shares its chart settings, annotations, scripts and imported research with other users of that server; review the payload before publishing.

The server stores its single-process state under `.aureon-data/` with restrictive file permissions. Set `AUREON_DATA_DIR` to a persistent private directory when needed. Never put real configuration or the private store into a public repository. `AUREON_REGISTRATION=0` disables new registrations. `AUREON_MONITOR=0` disables background alert polling. Default polling is 15 seconds and requires the process and provider to stay online. There is no hosted service or deployment included.

### Optional external paper brokerage and equity history

1. Start locally without broker credentials and create the intended owner account.
2. Stop the server. Configure **paper** credentials and that existing username in the process environment.
3. Restart and sign in as that user. Newly registered users cannot claim broker privileges during that server process lifetime.

```sh
export AUREON_BROKER_USER='your_existing_username'
export APCA_API_KEY_ID='your_paper_key'
export APCA_API_SECRET_KEY='your_paper_secret'
export ALPACA_DATA_FEED='iex'
npm start
```

Do not put keys in scripts, project JSON or browser code. Only the fixed `paper-api.alpaca.markets` order/account destination exists in this implementation; the history adapter uses the separate fixed data host. The client requires an explicit confirmation before submitting an external paper order. Data access remains subject to the account's actual entitlements. No external authenticated paper account was exercised during verification; provider behavior was tested with injected protocol fixtures.

For remote hosting, configure a TLS reverse proxy, a correct `AUREON_ORIGIN`, a private persistent volume and appropriate registration/access controls. The default listener is loopback. Read SECURITY.md before exposing services. The server is not a distributed database, audited brokerage gateway or regulated trading platform.

## Source map

```
src/
  core.js, data.js                  Raw OHLCV, cache, transport, v1 compatibility
  renderer.js, chart.js             GPU/Canvas geometry, interaction, visual projection
  chart-types.js, drawings.js       Derived bars and semantic drawing constructions
  studies.js, indicators.js         Float64 numerical kernels and registries
  script.js                        Lexer, parser and bounded bar interpreter
  execution.js                     Signed accounting, order state machine, raw-bar testing
  orderflow.js, analytics.js        L2/footprints, profiles, screener, sessions
  alerts-v2.js                     Shared condition/crossing engine
  jobs.js, engine-worker.js        Advanced worker protocol and bounded fallback
  workspace-v2.js                  Versioned portable extension/research validation
  server-client.js, ui.js          Same-origin service client and escaped UI helpers
  app.js, workbench.js             Base application and v2 workspace orchestration
server/
  app.mjs, store.mjs               Auth, ownership, revisions, SSE, atomic storage
  providers.mjs, monitor.mjs       Fixed-host data/paper adapters and persistent monitors
scripts/                           Standalone builder, checks, browser verifier
examples/                          AureonScript and explicitly labeled research fixture
```

## Verification and boundaries

The release test report records **226 passing automated tests** and **46 passing browser groups**, with zero captured page JavaScript errors. Browser verification used the **Canvas fallback and bounded synchronous fallback** because the environment denied WebGPU and even a minimal blob worker. The actual worker handler was independently exercised in Node worker threads, and the generated standalone worker bundle was executed and compared with the numerical reference.

No GPU performance claim or end-to-end live-provider certification is made. See TESTING.md for exact scope. Financial outputs are computations under declared assumptions, not trading recommendations or executable exchange quotes. No real-money order route is implemented.

## Documentation

- [FEATURE_MATRIX.md](FEATURE_MATRIX.md): exact delivered scope and remaining gaps.
- [ARCHITECTURE.md](ARCHITECTURE.md): module boundaries, semantics and execution model.
- [SCRIPTING.md](SCRIPTING.md): original language, examples and explicit incompatibilities.
- [DATA_PROVIDERS.md](DATA_PROVIDERS.md): data contracts, provenance and provider references.
- [SECURITY.md](SECURITY.md): credentials, ownership, deployment and limitations.
- [TESTING.md](TESTING.md): reproducible verification and environment restrictions.

Original application source is MIT licensed. Market data, service access and third-party names remain subject to their respective rights and terms. No TradingView source, widgets, proprietary charting library, Pine runtime or branding assets are included.
