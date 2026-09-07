# v3 architecture delta

The retained v2 core description follows; where scope differs, FEATURE_MATRIX.md and the following v3 boundaries govern.

`chart-pro` and `tick-charts` generate observed-print geometry without inventing a tape. `chart-workspace` gives tiles their own series/history/studies/drawing commands while sharing a quote connection. `studies-extra`, `drawings-extra`, `patterns`, and `market-analytics` remain pure numerical/geometry modules. Raw execution data is separate from model/derived display data.

`script-collections` exposes typed heap handles rather than JavaScript objects. The interpreter clones bar-boundary roots with a shared memo to preserve aliases; kernels and argument histories are keyed by call site. The realtime session API distinguishes ordinary rollback from varip state. Re-evaluation is bounded, not promised O(1) per tick.

`execution-pro` extends the broker with conservative pending reservations, entry-ID/FIFO lots and explicit cash/corporate actions. Lot P&L adjusts the aggregate accounting to the chosen closing basis. The trade magnifier verifies print OHLCV and shares one liquidity budget across old/new orders. Queue and funding inputs are supplied assumptions, not exchange data.

`services-pro` sits behind the existing Host/Origin/session/CSRF gate. Isolated Node script workers never receive provider credentials. Closed-bar monitor results recheck rule identity/revision before durable state and outbox commit. Delivery has leases/backoff and at-least-once semantics; push cryptography and fixed provider transports are independent of frontend code.

`security-pro` encrypts MFA/VAPID secrets with purpose-bound AES-GCM; TOTP counters/recovery hashes prevent reuse. The private store fsyncs and atomically renames one-process transactions. Shared rooms use CAS, not CRDT. `live-gateway` is a distinct default-disabled authority; scripts and simulator code have no references to it. A manual preview/confirmation is consumed atomically before one provider submission, and uncertainty requires read-only client-ID reconciliation.

The PWA caches only a public standalone shell. Docker/Caddy configuration is supplied, not deployed. The encrypted backup utility includes state plus vault key and requires an explicitly stopped server/new restore directory.

---

# Aureon Terminal 3.0 — architecture and semantics

## 1. Runtime boundaries

The browser client is plain ES modules, HTML and CSS. No framework, hosted chart widget, third-party chart runtime or CDN dependency is present. `scripts/build-standalone.mjs` links local named imports into explicit module factories, embeds CSS/SVG, and constructs two worker bundles. The builder does not fetch dependencies or evaluate source dynamically.

`server.mjs` is an optional native Node 22 server. It serves the client and implements private accounts, workspace storage, monitoring, chart ideas and the existing paper-only provider adapter. v3 adds separately gated private services and a disabled-by-default manual production gateway (see SECURITY.md). Static hosting serves only the client; it cannot supply server accounts, an always-running monitor or secret-bearing brokerage integration.

Primary module boundaries:

| Layer | Modules | Responsibilities |
|---|---|---|
| Market data | core, data | Validated raw OHLCV, sorted merge, time buckets, cache, pagination, connection lifecycle and explicit provenance. |
| Display | renderer, chart, chart-types, drawings | Viewport transforms, derived display bars, instanced primitives, text overlays, hit testing and editing. |
| Numerical | indicators, studies, analytics, orderflow | Float64 study arrays, profiles, screening, sessions, aligned data, observed trades and order book. |
| Language | script | Lexer, AST, sequential interpreter, bounded stateful kernels and declarative plot/signal output. |
| Execution | execution | Order state machine, signed-position ledger, raw-price historical execution and statistics. |
| Jobs | worker, jobs, engine-worker | Legacy jobs and advanced computation; transferable typed outputs; cancellation and fallback. |
| Persistence | workspace-v2, core | Versioned schemas, bounded import validation, immutable identities and compatible v1 workspace fields. |
| UI | app, workbench, ui, server-client | DOM controls, interactions, revision ownership, panel state and same-origin service transport. |
| Server | app, store, providers, monitor under server/ | Authentication, access control, atomic state replacement, fixed-host transport and polled rules. |

Pure numerical modules do not import the DOM. The rendering layer does not submit brokerage orders. Worker outputs do not execute arbitrary callbacks. Credentials are not part of portable workspace schemas.

## 2. Price, time and source identity

Raw candles have the shape:

```js
{ t: 1704067200, o: 100, h: 105, l: 98, c: 103, v: 120 }
```

`t` is UTC seconds at bucket open. Prices and volume are finite JavaScript numbers. OHLC ordering and nonnegative volume are validated; imported times are normalized and sorted. `partial` identifies an unfinished market bucket where available. No price precision is inferred from a chart's screen coordinates.

The chart retains raw market bars independently from display bars. Non-time transforms carry `sourceIndex`, `sourceTime` and `synthetic: true`. Repeated derived bricks may refer to the same source candle. They are not assigned invented unique market timestamps. Indicators are computed on raw bars and projected into derived display coordinates.

Close-derived Renko, line-break, Kagi, point-and-figure and range are explicit approximations to missing tick paths. Changing the visual style never switches the execution dataset to those derived prices. `runBacktest` rejects bars flagged `synthetic`; explicitly labeled deterministic demonstration bars are still accepted as a demonstration raw dataset, not claimed to be market observations.

Replay uses a prefix of raw history and recomputes the corresponding display/study prefix. Signals from a partial final bar do not become historical executions. An imported source label is user-supplied metadata, not cryptographic proof of origin.

## 3. Geometry pipeline

CPU prices, dates, statistics and studies stay in Float64 arithmetic. The chart converts world values to viewport-relative pixel coordinates before writing Float32 GPU instance data. This avoids placing epoch timestamps or large raw prices directly into low-precision shader coordinates.

Rectangles and line segments share a WGSL render pipeline. Each instance occupies 48 bytes. A reusable CPU geometry buffer is uploaded to a growable GPU vertex buffer and submitted as one instanced geometry draw for that renderer's submitted stream. There is still per-frame upload and CPU geometry construction; “one draw” does not mean all application rendering is free or that every chart shares one device submission.

Canvas supplies labels, crosshair, annotation text and the independent fallback geometry path. Rendering is invalidation-driven; changes schedule frames instead of redrawing an unchanged chart continuously. Main-bar culling, candle LOD aggregation and plot decimation reduce visible work. Some colored/script paths still process every visible bar. This release does not claim universal O(pixel-count) rendering or a measured hardware throughput.

Shared drawing geometry feeds painting and picking. Drawings persist semantic anchors rather than screenshots. Selection/dragging edits anchors; committed changes enter the existing undo stack. Objects retain stable IDs and have visibility, lock, group and ordering state. Manual pattern annotations are not pattern-recognition algorithms.

## 4. Numerical studies and jobs

`STUDIES` is a registry of 73 study types (the v3 extension adds 40 to the original 33), each with parameter validation and plot metadata. A workspace allows 32 independent instances. Warm-up or missing values use `NaN`, not invented zero prices. Recursive smoothing, rolling windows and oscillator degeneracies have explicit tested behavior. Prefix-causality tests verify that later bars do not alter earlier computed values for every registry type.

Ichimoku does not backpaint future information into earlier execution bars. Prior-day pivots use the previous UTC day. Anchored and session VWAP use specified anchors/sessions, not hidden vendor calendars.

Computation is currently batch-per-job, not an incremental streaming DAG and not GPU compute. The advanced job protocol is `{id, type, bars, options}`. Replies contain `{id, result}` or `{id, error}`. Typed output buffers are transferred with duplicate ArrayBuffers removed from the transfer list. Job IDs and workspace context reject stale results after data changes.

A 30-second worker timeout terminates the worker, rejects pending work and starts a new worker. Cancellation does not return a fabricated partial result. When workers are unavailable, advanced jobs may run synchronously on at most 10,000 bars. The synchronous fallback cannot be preempted by a timer while JavaScript is executing; interpreter budgets still apply. This is an explicit fallback limitation.

## 5. AureonScript

The interpreter accepts a documented original language, not full external scripting languages. It tokenizes input, parses expressions with operator precedence, builds statement blocks from indentation, audits stateful call placement, and evaluates sequentially by bar.

Source is never passed to JavaScript `eval` or `Function`. Calls use a fixed dispatch table and cannot access DOM, network, modules or arbitrary object properties. Memory/work limits constrain source length, AST nodes, AST-by-bars, variables, plots, history, recursion, loop iterations and evaluation operations. SCRIPTING.md is the normative language boundary.

Higher/equal-timeframe `request.security` reads only explicitly supplied datasets. A source value is available only after its source candle closes. Nested or lower-timeframe data requests and lookahead overrides are rejected. Plot arrays and strategy commands are declarative results. Strategy commands do not call a broker while the script is being evaluated.

## 6. Simulation and historical execution

`SimulationBroker` tracks cash, signed positions, marks, orders and fills in quote-currency units. Equity is cash plus signed marked holdings; exposure is the sum of absolute marked holdings. Short sale proceeds increase cash while the short holding remains a negative asset value.

Fills use the supplied ask for buys and bid for sells, explicit slippage and commission. Limit prices cap fills; triggered stop-limits may remain unfilled after a gap. Partial fills consume the supplied observation's liquidity in order sequence. Weighted average cost, proportional entry-fee allocation, realized P&L and reversal accounting are reconciled by tests.

Bracket children protect only the newly opened portion of a fill. An OCO partial exit reduces its sibling quantity by exactly that exit quantity; it does not prematurely cancel protection for the remaining position. Trailing stops move only in the favorable direction. Reduce-only orders cannot reverse a position. Pending orders do not reserve capital; buying power is checked at fill time. Maintenance handling liquidates only against an actual supplied quote for that symbol, without fabricating quotes for other holdings.

Historical testing uses these conventions:

1. A command formed at confirmed close `i` first becomes executable at open `i + 1`.
2. Existing gap-through protective orders are processed at the next open before new entry signals.
3. The assumed intrabar path is open, adverse extreme, favorable extreme, close, relative to the held direction.
4. A stop crossed between those observations fills at the observed path point plus slippage, not a retroactively guaranteed stop price.
5. Raw OHLCV cannot establish tick sequence, depth or queue position. The tester assumes unlimited observation liquidity and has no borrow, funding, realistic impact, corporate actions or FX conversion.
6. A final open position remains marked unless `liquidateEnd` is explicitly requested.

UI optimization selects among 12 EMA pairs by training net profit only. Holdout execution starts flat; preceding bars may warm indicators but a signal before the holdout boundary cannot enter it. Selection on one holdout is not evidence of predictive profitability.

Sharpe assumes zero risk-free rate and annualizes using observed average bar spacing. CAGR uses elapsed observed time. Undefined profit factor/Sharpe are represented as non-finite values internally and displayed as unavailable; they are not forced to zero.

## 7. Order flow, profiles, screening and research

The L2 adapter subscribes to Coinbase public `level2_batch`, accepts a complete valid snapshot atomically and applies absolute-size price-level changes; zero size deletes a level. Reconnection invalidates the previous book until a new snapshot. No disconnect is disguised as a fresh book. The adapter is not a certified lossless order-book archive.

Observed trades use exchange trade IDs for bounded deduplication. Coinbase match side identifies the maker, so aggressor direction is inverted when classifying buy/sell flow. Footprints retain a bounded window of actual observed trades. Their delta and CVD describe that retained observation set, not an unknown pre-connection market history.

OHLC volume profiles distribute total bar volume over its price range and are labeled approximations. TPO uses occupancy inferred from OHLC, not the exact time spent at each price. Tick profiles use observed prices and sizes only.

The screener computes values from explicit bars, preferring imported research universe data, then the watchlist. It uses bounded concurrent loading, not an invented global market catalogue. Fundamental/news/event records are imported data and are escaped before UI display. Only HTTP/HTTPS links become navigable. The heatmap weights loaded symbols by computed turnover. Spread OHLC bounds are conservative envelopes, not guaranteed realizable pairs of simultaneous prices.

## 8. Persistence and concurrency

Browser extensions use version 2; research uses version 1. Validation limits record counts, script sizes, nested layout depth, source bars, symbols, duplicate identities and field types. Reserved object keys are rejected where input becomes indexed state. Named layouts omit full raw history and nested saved layouts to avoid recursive expansion. Portable workspace export includes active raw history but excludes execution account ledgers and credentials. Browser rule engines and local execution ledgers are separately persisted.

The server store is a single-process copy-on-transaction queue. A validated replacement state is written to a temporary file and atomically renamed before the new in-memory state is published. Workspace revisions are compared inside this serialized transaction, not before it. Two concurrent writes to one revision cannot both succeed.

This is not a distributed database: no cross-process lock, replication, fsync-based power-loss guarantee, automatic backup or encryption at rest is implemented. Only one server process may own a data directory.

## 9. Private service boundary

Authentication uses scrypt password hashes and random opaque sessions whose hashes are stored. Writes require same-origin request checks plus CSRF. Workspaces, server alerts, private event streams and broker access enforce ownership server-side. Chart ideas are intentionally shared only on explicit publication.

Broker access resolves the configured owner to an already existing user ID when the server starts. Registering that username while the process runs does not grant paper-account control. Credentials stay in process environment and go only to fixed provider hosts. No real-money brokerage destination exists in the adapter.

The monitor groups enabled alerts by symbol/interval, polls fixed sources, keeps crossing baselines, checks each rule revision again before committing, and persists firing state/logs. Provider failures are exposed rather than treated as zero prices. SSE carries events only to the authenticated owner; expired/revoked sessions close streams. No external notification delivery, hosted availability or historical gap recovery is implied.

See SECURITY.md, DATA_PROVIDERS.md and TESTING.md for operational boundaries and exact verification.
