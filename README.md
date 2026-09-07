# Aureon Terminal

**A clearer view of the market.** An original, dependency-free HTML/CSS/JavaScript trading workspace with a native WebGPU geometry renderer, public market-data adapters, an auditable numerical core, editable chart drawings, historical analysis, and local paper execution.

This is runnable software, not a screenshot or a TradingView embed. No TradingView code, widgets, branding, proprietary charting libraries, or Pine runtime are included. The workspace follows familiar chart-terminal conventions while using its own visual identity.

## Run

Use Node.js 20 or newer. No dependency installation is necessary.

```sh
cd aureon-terminal
npm start
```

Open **http://localhost:4173**. The included server serves the ES modules and offers a read-only, fixed-host Coinbase REST proxy when direct REST access fails on localhost. It does not relay WebSockets or send orders.

```sh
npm test       # 51 numerical, protocol-fixture, and worker-handler tests
npm run check  # syntax checks plus the tests
npm run build  # regenerate dist/AureonTerminal.html
```

`dist/AureonTerminal.html` contains the entire application, styles, SVG icons, and worker implementation in one file. It can be opened directly for a quick demonstration; HTTP on localhost is recommended for consistent module/worker/storage behavior. On a static host, serve the application over HTTPS. WebGPU is attempted when available; otherwise an independent Canvas 2D renderer is used. The status bar identifies the actual backend. File-origin and browser security policies may prevent WebGPU, persistence, workers, or cross-origin data access.

Add `?demo=1` for an explicitly synthetic offline demonstration. Add `?canvas=1` to intentionally exercise the Canvas renderer. For example: `http://localhost:4173/?demo=1&canvas=1`.

## Implemented workspace

| Area | Working implementation |
| --- | --- |
| Charts | Candlesticks, hollow candles, OHLC bars, line, area, Heikin-Ashi; volume; linear, logarithmic, and percent scales; high-DPI rendering; crosshair; OHLCV inspector; price-axis manipulation. |
| Navigation | Pointer-anchored wheel zoom, dragging to pan, horizontal scrolling, auto-fit, visible-range culling, historical pagination, linked time navigation in a two-chart comparison layout. |
| Indicators | EMA 20, SMA 50, Bollinger Bands 20/2, RSI 14, MACD 12/26/9, UTC-session VWAP, ATR 14, Stochastic 14/3, OBV. Independent oscillator panes. |
| Drawings | Trend lines, rays, horizontal/vertical lines, Fibonacci retracements, rectangles, text, price/time measurements; time/price anchors; move/resize handles; OHLC snapping; object list; colors; locking/hiding; deletion; drawing undo/redo. |
| Market workspace | Symbol search, editable watchlist, USD product discovery, live ticker quotes, recent trades, and periodically refreshed order-book snapshots. |
| Historical analysis | Bar replay with step/play/seek/speed; EMA-cross strategy tester; computed trade list, equity curve, return, win rate, and maximum drawdown. |
| Paper execution | Browser-local $100,000 cash ledger; spot buy/sell; market, limit, stop-market, cancellation, fees, average cost, realized/unrealized results; fresh-quote validation. No real orders. |
| Alerts | One-shot crossing alerts above, below, or in either direction; in-app history; optional browser notification permission. Monitoring requires the page to remain running. |
| Persistence | Local workspace/ledger/alerts, IndexedDB history cache, workspace JSON with source OHLCV, CSV import/export, and actual chart PNG export. |
| UI | Original amber-accented dark and light themes, top chart toolbar, left drawing strip, right watchlist/details, resizable bottom analysis panel, keyboard shortcuts, modal editors. |

The nine chart-study presets are fixed in the UI; their underlying functions accept periods in source. Fast/slow EMA periods, initial capital, allocation, fees, and slippage are editable in the strategy tester.

## Data provenance and connectivity

The default adapter uses Coinbase Exchange's public REST and WebSocket endpoints. It requires no API key for the implemented public market-data operations. Product availability, rate limits, regional access, CORS policies, and network availability remain provider/browser constraints.

- REST: `https://api.exchange.coinbase.com/products/{id}/candles`, `/products`, `/products/{id}/book?level=2`.
- WebSocket: `wss://ws-feed.exchange.coinbase.com`, `ticker` and `heartbeat` channels.
- Native intervals: 1 minute, 5 minutes, 15 minutes, 1 hour, 6 hours, and 1 day. Four-hour bars aggregate hourly bars; weekly bars aggregate daily bars using Monday 00:00 UTC boundaries.
- Candle tuples are decoded as `[time, low, high, open, close, volume]`, validated, deduplicated, and sorted. Missing no-trade intervals are not filled with invented trades.
- History loads in pages. The current candle is provisional; incoming ticker executions update it with bounded trade-ID deduplication. Finalized bars are repaired against REST on subsequent reconciliation. The REST-to-stream handoff is not claimed to be a lossless exchange-event recorder.
- The book is a **REST snapshot refreshed about every 12 seconds**, not a sequenced streaming level-2 order book. The UI says so.
- Subscription selection is bounded to 50 symbols. Keep the union of watchlist, comparison, active alert, position, and open-order symbols within that limit.

The chart always identifies one of **Coinbase market data**, **cached history**, **imported OHLCV**, or **synthetic demo**. Startup uses a visibly labeled synthetic preview while connecting. A failed connection never turns generated prices into supposedly live prices. Live ticker connectivity and the provenance of chart candles are tracked separately.

The synthetic demonstration is deterministic, historical-looking test data, not historical market data. Paper order submission is disabled for synthetic/imported/cached chart modes and during replay. Existing simulated orders are monitored from live quotes only while the app is open and not replaying.

## Numerical and rendering design

See [ARCHITECTURE.md](ARCHITECTURE.md) for data contracts, renderer layout, mathematical conventions, and extension points.

Financial calculations use JavaScript numbers and Float64Arrays. The renderer converts coordinates to local viewport pixels before uploading Float32Array instances; it does not cast full Unix timestamps or financial prices directly into float32 clip-space calculations. Rectangles and line segments share an instanced WGSL pipeline. Geometry, text, and crosshair invalidation are separated. Text uses a transparent Canvas 2D overlay rather than a GPU glyph atlas.

Visible bars are culled, and zoomed-out candles are aggregated without discarding their high/low extremes. Indicator decimation preserves min/max excursions. GPU buffers grow geometrically and are reused. An invalidation-driven requestAnimationFrame pipeline avoids continuously repainting an idle chart. The status timing is CPU chart-frame work, **not measured GPU execution time**.

Indicator and backtest requests normally run through a dedicated module worker; computation falls back to the same functions on the main thread when workers cannot start. Results carry request identities so obsolete responses cannot install on a newer symbol selection.

## Historical test semantics

The included strategy is deliberately specific: a long-only fast/slow EMA crossover, not a general strategy language.

The signal uses previously closed bars. An entry or exit executes at the **next bar's open**, with explicit slippage and proportional fees. The default fee is 10 basis points and default slippage is 5 basis points; the form exposes these assumptions. Position size includes the entry fee. No same-bar close signal is filled at that same close. An open final position is marked to the last close, not silently liquidated. Reported completed-trade statistics exclude an open position.

Replay restricts the chart and historical test input to the revealed prefix, and clears future strategy markers/results when entered. Indicator values are causal, including warm-up periods. Replay is a visualization/analysis mode, not an exchange simulator.

## Paper accounting semantics

Paper orders never leave the browser. Positions are long-only spot inventory; there is no margin, leverage, short selling, funding, borrowing, tax accounting, or broker reconciliation.

Market fills use the live ask for buys and bid for sells and require a quote received less than 15 seconds ago; the source timestamp is also checked when available. A crossed or nonpositive bid/ask is rejected. Limit and stop-market orders evaluate against fresh quotes, not historical candle ranges. Open orders do **not** reserve cash or inventory: insufficiency at trigger time rejects the order. There is no exchange queue-position, market impact, partial-fill, or available-depth model. The default fee is 10 basis points per fill. Cash and cost basis include fees. Marks can fall back to cost basis when a quote is unavailable; they are not executable prices.

Alerts and open orders stop being evaluated when the page is closed or suspended. They are not server-hosted services. Backtests and paper execution are two distinct models with separately documented assumptions.

## CSV and workspace import

A CSV may use `time`, `timestamp`, or `date` for the timestamp column and either short or full OHLCV column names. Example:

```csv
time,open,high,low,close,volume
2025-01-01T00:00:00Z,100,104,99,102,12.5
2025-01-01T01:00:00Z,102,106,101,105,18.2
2025-01-01T02:00:00Z,105,105,100,101,9.7
```

Timestamps accept Unix seconds, Unix milliseconds, timezone-qualified ISO timestamps, or a date-only value interpreted at UTC midnight. Ambiguous local datetime strings are rejected. Values must be finite; volume cannot be negative; high/low must contain open/close. Imports are bounded to 30 MB of CSV text and 250,000 candles. Repeated timestamps use the last supplied row. Data is sorted. The interval is inferred for CSV; workspace JSON carries it explicitly. Supported workspace intervals are the intervals listed above. Imported bars can be aggregated to a coarser integer multiple but cannot be fabricated into a lower timeframe. Imported CSV uses `CUSTOM-USD`; workspace JSON retains an explicit symbol.

Workspace JSON stores validated drawing geometry, chart state, and optional source bars. Paper-account state and alerts are kept separately in browser storage; they are not part of the portable workspace export. Browser storage is best-effort, not a substitute for an exported backup.

## Controls

| Action | Control |
| --- | --- |
| Symbol search | Ctrl/Cmd+K or `/` |
| Save workspace | Ctrl/Cmd+S |
| Undo / redo drawings | Ctrl/Cmd+Z; Ctrl/Cmd+Shift+Z; Ctrl+Y |
| Select / trend / horizontal / Fibonacci | V / T / H / F |
| Indicators / alert / replay | I / A / R |
| Toggle OHLC snapping | M |
| Delete drawing / cancel placement | Delete / Escape |
| Pan / zoom | Drag chart / wheel around pointer |
| Horizontal scroll / price scaling | Shift+wheel / drag right axis |
| Fit / context menu | Double-click / right-click |

Two-point drawings accept drag-to-create or click–click placement. Select a drawing and drag its handles to resize, or drag the segment to translate. The Objects sidebar exposes object attributes.

## Verification and boundaries

The delivered source passed **51 Node tests** and **14 browser interaction groups**, with **zero captured browser JavaScript errors**. See [TESTING.md](TESTING.md) and `verification/` for exact results.

The build environment blocked normal browser navigation and external network access. Browser testing used the standalone distribution in an isolated document, exercising the **Canvas 2D fallback**. Browser workers were unavailable there; the actual worker handler was tested separately with Node worker threads. **Real WebGPU adapter/shader execution, GPU performance, production Coinbase connectivity, CORS behavior, and full browser-storage persistence were not verified end to end in that environment.** The code implements these paths, but their presence is not a hardware or production-network test result.

This is a substantial first implementation, not full TradingView parity. It does not include Pine Script, proprietary indicators, exchange-licensed equities/futures/options feeds, order routing, news/social feeds, financial statements, server-side alerts, multiuser/cloud synchronization, corporate-action adjustment, custom exchange-session calendars, or more than two chart panes. Imported datasets are available for analysis but do not become tradable live products. The UI is desktop-oriented; a 1,000-pixel-wide viewport was tested, not a complete mobile trading workflow. No performance benchmark or profitability claim is made.

## Official protocol references

- Coinbase Exchange public API introduction: https://docs.cdp.coinbase.com/exchange/introduction/welcome
- Product candles: https://docs.cdp.coinbase.com/exchange/reference/exchangerestapi_getproductcandles
- Exchange WebSocket channels: https://docs.cdp.coinbase.com/exchange/websocket-feed/channels
- WebGPU API and secure-context requirements: https://developer.mozilla.org/en-US/docs/Web/API/WebGPU_API

## License

MIT. See [LICENSE](LICENSE). Third-party service names belong to their respective owners. No affiliation with TradingView or Coinbase is implied. You are responsible for complying with a data provider's terms when using or redistributing its market data.
