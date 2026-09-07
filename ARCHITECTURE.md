# Aureon Terminal — engine architecture

## Module boundaries

```text
index.html + styles.css
          │
       app.js ──────────── workspace, provenance, UI state, persistence
       │  │  │
       │  │  └─ data.js ─ REST / WebSocket / IndexedDB adapters
       │  └──── compute.js ─ indicator-worker.js ─ indicators.js
       └─────── chart.js ─ renderer.js ─ native WebGPU or Canvas fallback
                         
core.js ─ validated bars, resampling, drawing history, paper ledger, alerts
```

`core.js` and `indicators.js` have no DOM dependencies. The numerical tests import the same functions as the app. The distribution builder packs these modules without replacing their algorithms. The worker uses the same indicator and backtest implementations as the synchronous fallback.

## Data contract and time

A canonical bar is `{t,o,h,l,c,v}`. Time is nonnegative integer Unix seconds. Prices are quote currency per base asset, and volume is base-asset volume. A `partial` flag marks provisional bars. Bars are unique and sorted ascending by time. A high contains the entire OHLC range, a low bounds it from below, all entries are finite, and volume is nonnegative. Import validation runs before installation.

The nominal interval is independent of a bar's array index. Gaps remain missing; no volume or executions are invented. Most intervals use `floor(t / interval) * interval`; weekly bars offset that calculation to ISO Monday 00:00 UTC. UTC is the only session/calendar convention in this build.

`CandleSeries.merge` is a sorted linear merge, with authoritative incoming bars replacing same-time bars. Untouched live bars retain first/last execution metadata. `tick` rejects invalid values, observations before the snapshot cutoff, duplicate trade IDs within the bounded deduplication window, and late observations for finalized older buckets. Within the active bucket it updates open/close by execution time, high/low by extrema, and volume by accepted size. A new bucket creates a provisional bar.

A REST snapshot and a ticker stream do not form an atomic exchange snapshot. The recorded REST cutoff avoids double counting the already represented interval; it can omit trades that race the handoff. The implementation repairs finalized bars with later REST reconciliation instead of claiming exactly-once, lossless capture. This distinction also matters because this is a ticker-driven feed adapter, not an exchange matching-engine log.

The application carries provenance separately from socket state. A connected socket is not proof that a synthetic or imported chart has become authoritative. Cached/imported/demo data are never relabeled as provider candles merely because a ticker arrives.

## Rendering pipeline

Each GPU instance is 48 bytes:

| Float offsets | Field | Meaning |
| --- | --- | --- |
| 0–3 | `bounds: vec4f` | Rectangle x/y/width/height or line start-x/start-y/end-x/end-y |
| 4–7 | `color: vec4f` | RGBA |
| 8 | `meta.x` | Line thickness |
| 9 | `meta.y` | Rectangle (0) or line (1) |
| 10–11 | Reserved | Zero-filled |

The vertex shader expands each instance into two triangles using `vertex_index`. A 16-byte viewport uniform maps local pixels into clip space. Lines compute a normalized perpendicular and extrude by half the width. Rectangles directly expand their bounds. The fragment shader outputs instance color with ordinary alpha blending. This is one pipeline and one instanced draw for the chart's submitted geometry, not one API call per candle.

All financial/time-to-screen transforms occur in float64 on the CPU. Only small viewport-local coordinates enter the float32 instance buffer. This avoids precision problems caused by uploading full timestamp magnitudes or large price offsets as shader floats. Charts share a device acquisition promise but have independent canvases, instance buffers, uniforms, and presentation contexts.

`Geometry` uses a reusable Float32Array. CPU and GPU capacities grow geometrically; used prefixes are uploaded. The chart rebuilds only on invalidation. Visible index ranges bound candle work. When multiple candles fit in a screen pixel, open and close are taken from the first/last constituent and extrema/volume are preserved. Dense indicator paths preserve excursions through min/max decimation.

The overlay is intentionally Canvas 2D: text, crosshair, labels, handles, and inspection details stay independent of the geometric GPU batch. CPU clipping limits line segments to the appropriate price/indicator panes. The fallback uses a separate Canvas surface because a single HTML canvas cannot simultaneously own independent WebGPU and 2D contexts. Device loss or uncaptured GPU failure hides the GPU surface and activates the fallback.

This is a GPU drawing engine, not a GPU indicator compute implementation. The indicators execute in JavaScript, normally off the main thread. CPU status timings must not be interpreted as timestamp-query GPU measurements. GPU shader validation and performance require a separate run on a real WebGPU-capable browser/device.

## Study definitions

All numerical output arrays use float64. Undefined warm-up values are NaN and are not plotted.

- **SMA(n):** rolling sum over n finite values divided by n.
- **EMA(n):** seed with the first n-value SMA, then `E[t] = (2/(n+1))*x[t] + (1-2/(n+1))*E[t-1]`.
- **Wilder RMA(n):** n-value SMA seed, then `(R[t-1]*(n-1)+x[t])/n`.
- **RSI(n):** Wilder averages of positive and negative close deltas. Zero loss gives 100; a flat window with zero gain and loss gives 50.
- **Bollinger:** SMA center and plus/minus multiplier times population standard deviation, using a removable rolling mean/M2 calculation rather than directly subtracting large raw squared sums.
- **MACD:** fast EMA minus slow EMA, followed by a signal EMA; histogram is line minus signal.
- **ATR:** Wilder average of `max(high-low, abs(high-prevClose), abs(low-prevClose))`; first-bar range is high-low.
- **VWAP:** cumulative `(high+low+close)/3 * volume` divided by volume, reset at UTC midnight. On daily data this reset makes each daily value its own typical price; it is not a multi-day anchored VWAP.
- **Stochastic:** raw %K from rolling highest high and lowest low; flat range gives 50; %D is a simple average of %K. Monotonic queues maintain extrema.
- **OBV:** starts at zero, then adds signed bar volume according to close movement.

Studies operate on canonical OHLCV even when Heikin-Ashi is selected. Heikin-Ashi changes the display, not trade prices or imported source data. All functions are causal. Live recalculation coalesces pending work, but the study set is recomputed in O(n); this build does not claim a constant-time incremental accumulator for every study.

## Worker protocol

`ComputeClient.run(type, bars, options)` assigns a request id and returns a promise. The worker supports indicator calculation and backtesting. Output Float64Array buffers transfer rather than copying their numeric payload back. Input bar objects use structured cloning. Error replies preserve identity. The client times out stalled work, terminates an unusable worker, and invokes the same pure functions synchronously. Application-level load identity guards prevent stale study results from being installed after a symbol change.

## Drawing model

A drawing has a persistent id, a supported type, one or two `{t,p}` anchors, a validated color, text metadata when relevant, and a locked/visible state. Geometry is stored in data coordinates, not screen pixels. Selection uses screen-space distance so hit tolerance remains usable at different zoom levels. Dragging converts pixels back to data coordinates; endpoint editing and translation are distinct operations. Snapping searches local candle OHLC candidates.

Drawing transactions snapshot before/after arrays with structuredClone and a bounded 150-step undo stack. This favors simple, auditable immutable drawing history rather than a binary delta format. Undo/redo applies to drawing edits, not external market events or executed paper fills. Each symbol owns its own drawing collection.

## Backtest and paper engines

The backtest evaluates a crossover at bars `i-2` and `i-1`, then executes at bar `i` open. A buy price includes positive slippage, a sell price negative slippage. Entry sizing divides allocated cash by `price*(1+fee)`, so allocated cash includes the fee. Exit proceeds subtract the exit fee. Equity is cash plus inventory marked at the bar close. Drawdown is measured against the running equity peak. Remaining inventory is reported as an open position, not a fictitious closing trade.

Paper accounting is event-driven from fresh bid/ask snapshots. It has cash, cost basis, quantities, realized results, submitted orders, and fills. Buys use ask, sells use bid. Selling removes average cost proportionally. Insufficient cash/inventory causes rejection; short positions are forbidden. Limit/stop tests apply to the relevant quote side. No depth consumption, latency simulation, queue priority, partial fills, cash reservation, or server-side execution is implemented. Quotes and decisions stop when the browser stops executing.

Financial arithmetic here is IEEE-754 float64 with small comparison tolerances, appropriate to this analytical/paper implementation. It is not a decimal/fixed-point exchange ledger and does not claim exchange-specific tick/lot rounding or settlement precision.

## Storage and trust boundaries

LocalStorage stores chart preferences/drawings, alert state, and the local paper ledger. IndexedDB caches candles and imported source history. JSON workspace export includes chart state and source bars, but not alerts or paper state. CSV and workspace input is validated and bounded. Text shown in HTML templates is escaped; supported drawing names and geometry schemas are whitelisted.

The localhost server accepts GET/HEAD only, rejects hidden/path-traversal targets, and binds to loopback. Its optional data proxy permits only fixed Coinbase product endpoints and a small query allowlist. It does not accept an arbitrary upstream URL, expose API keys, trade, or relay arbitrary WebSocket traffic. There is no user authentication because there is no cloud account service in this project. The server is a development/local-use server, not a production multi-tenant reverse proxy.

The single-file build uses inline scripts and a Blob worker. A strict hosted Content Security Policy must explicitly accommodate those or serve the modular build with an appropriate policy. Do not add secrets to a static client.

## Extension points and deliberately unsupported contracts

A new market adapter should normalize candles/quotes to the existing contracts and carry its own provenance and exchange-session rules. Corporate actions, non-UTC trading calendars, futures rolls, adjusted prices, and entitlement checks need explicit contracts rather than silently reusing 24/7 crypto semantics.

Additional studies can extend the pure indicator module and worker protocol without changing the renderer. A fully configurable study editor, streaming incremental study caches, GPU text, richer chart layouts, and a typed strategy language are separate extensions, not implied existing features. Real brokerage execution requires authenticated server-side custody, order-lifecycle reconciliation, fixed-point rules, risk limits, and a substantially different trust model; it is intentionally absent.
