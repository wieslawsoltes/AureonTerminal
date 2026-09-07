# Aureon Terminal 2.0 — delivered scope and remaining gaps

This is the release inventory, not a claim of complete external charting platforms parity. “Implemented” means executable source is present; it does not mean certified equivalent to external charting platforms, a tested production feed, or an audited financial service. Verification is separately recorded in TESTING.md. Imported or synthetic data is labeled and is never intentionally relabeled as live.

Public charting and language documentation were consulted as behavioral references on 2026-09-07. No proprietary implementation, charting library, external scripting languages runtime, user scripts, or branding assets were copied.

## Rendering and chart workspace

| Capability | Release status | Exact boundary |
|---|---|---|
| Native WebGPU geometry | Implemented; hardware execution unverified here | Instanced rectangles/segments, reusable buffers, 48-byte instances; text/crosshair on separate Canvas. |
| Independent Canvas renderer | Implemented and browser-tested | Used automatically when WebGPU initialization is unavailable. |
| Standard charts | Implemented | Candles, hollow candles, OHLC, line, area, Heikin-Ashi, step, baseline, columns and HLC. |
| Non-time charts | Implemented approximations | Close-derived Renko, line break, Kagi, point-and-figure and range; no reconstruction of unknown intrabar ticks. |
| Price/time axes | Implemented | Linear/log/percentage, timezone display, manual/automatic scale, time pan/zoom, OHLCV crosshair inspection. |
| Multi-chart layout | Implemented with limits | 1, 2, 4, 6 or 8 views; secondary symbol/interval selection; linked time navigation/crosshair. Secondary views are read-only history views, not fully independent live editors. |
| Sessions | Implemented | IANA timezone, weekdays, open/close and user holidays; no maintained exchange-holiday database. |
| Volume profiles / TPO | Implemented with explicit approximation | OHLC-distributed visible-range volume and OHLC occupancy TPO; observed-tick profile only when actual trades arrive. |
| Footprint / depth | Implemented panels | L2 batch order book, observed price-level buy/sell volume, delta and retained CVD. Not a complete footprint ladder chart or guaranteed lossless history. |
| Editing and persistence | Implemented | Drawing selection/anchors, snapping, undo/redo, object grouping/visibility/locking/order; named layouts, templates and portable JSON. |
| Exports | Implemented | Workspace JSON, OHLCV CSV, screener CSV, strategy trade CSV, chart PNG, script text. |
| Full chart-type catalogue | Not implemented | Volume-width candles, complete native footprint/TPO chart modes, all special marker/high-low variants and provider-equivalent tick/range construction. |
| Full desktop/mobile parity | Not implemented | No native mobile apps, full accessibility certification, fully editable 16-view workspace, synchronized drawing replication, or exact pixel/workflow parity. |

## Studies, drawings and scripting

**33 configurable study types:** EMA, SMA, WMA, HMA, RMA, VWMA, DEMA, TEMA, Bollinger Bands, RSI, MACD, ATR, Stochastic, Stochastic RSI, OBV, session VWAP, anchored VWAP, Donchian, Keltner, Supertrend, Parabolic SAR, DMI/ADX, CCI, MFI, Williams %R, ROC, momentum, CMF, accumulation/distribution, linear regression, Awesome Oscillator, Ichimoku and previous-day pivots. Up to 32 independent configurable instances are supported. The original nine quick-study toggles remain available; these are not nine additional unique study types.

**37 drawing tools:** trend line, ray, extended line, arrow, horizontal line, vertical line, horizontal ray, parallel channel, pitchfork, regression channel, Fibonacci retracement/extension/fan/time/channel/circles, Gann fan, rectangle, ellipse, triangle, rotated rectangle, polyline, brush, long/short position annotations, price/time measure, date range, price range, text, callout, price note, buy/sell marker, XABCD, Elliott impulse/correction, and head-and-shoulders.

Pattern tools place and edit annotations; they do not automatically detect patterns. Gann geometry is screen-projected, not a full fixed market-price/time angle model. Position annotations display reward/risk but do not themselves submit orders.

| Capability | Release status | Exact boundary |
|---|---|---|
| Study parameters / templates | Implemented | Independent periods, colors, placement, visibility and saved sets; batch Float64 computation. |
| Original scripting language | Implemented | AureonScript lexer, Pratt parser, AST interpreter, sequential series, inputs, plots, fills, colors, alerts and strategy commands. |
| History and higher-timeframe series | Implemented with limits | Nonnegative history; imported higher/equal-timeframe datasets only, after source close. |
| Script editor | Implemented | Text editor, line gutter, examples, diagnostics, inputs, execute/cancel/save/export. |
| Full external scripting languages compatibility | Not implemented | No arrays/maps/tuples/UDTs/methods/libraries, comprehensive builtin set, exact rollback semantics, lower-timeframe requests or complete broker-emulator semantics. |
| external scripting languages cloud IDE / ecosystem | Not implemented | No external scripting languages profiler, library marketplace, proprietary server runtime, external charting platforms script import or community catalogue. |
| Entire built-in study/drawing catalogue | Not implemented | The enumerated types are the implemented registry; unsupported studies are not silently substituted. |
| Automatic pattern recognition | Not implemented | No automatic candlestick, harmonic, Elliott-wave or chart-pattern scanner. |

## Strategy testing and execution

| Capability | Release status | Exact boundary |
|---|---|---|
| Advanced historical tester | Implemented | Long/short positions, confirmed-close signals, next raw-bar-open fills, fees, slippage, allocation, leverage and protective stops/takes. |
| Statistics | Implemented | Equity, drawdown, realized trades, fees, win rate, profit factor, expectancy, Sharpe and CAGR in core; principal metrics and curves in UI. |
| Parameter selection | Implemented | UI: 12 EMA pairs, 70% training / 30% holdout. Core permits bounded grids up to 200 runs. Not a general optimization platform. |
| Order state machine | Implemented | Market, limit, stop-market, stop-limit, absolute-distance trailing, GTC/IOC, reduce-only, expiry, partial fills, bracket children and partial OCO reduction. |
| Amendments and liquidity | Engine implemented | Amend validated residual quantities/prices; finite-liquidity tick processing. UI does not expose every core option or simulate an exchange queue. |
| Accounts and margin | Local simulation | Signed positions, average cost, commissions, mark-to-market, fill-time buying power and maintenance checks. No pending-order capital reservation. |
| Replay trading | Implemented | Next-bar execution after submission; rewind invalidates ledger and requires reset rather than inventing historical rollback. |
| Optional external paper account | Implemented adapter; credentials required | Fixed Alpaca paper host, account/order/cancel APIs, explicit confirmation and pre-existing owner authorization. Protocol fixtures tested, no authenticated live service test. |
| Real-money trading | Not implemented | No production order destination, exchange matching access, custody, broker OAuth network or real-money order router. |
| Full market microstructure | Not implemented | No tick reconstruction, limit queue priority, borrow/funding charges, realistic market impact, FX conversion, options exercise or corporate-action accounting. |
| Full broker emulator | Not implemented | No complete external scripting languages order semantics, pyramiding/entry-ID ledger, tick-level bar magnifier or exchange certification. |

## Data, screening and research

| Capability | Release status | Exact boundary |
|---|---|---|
| Public crypto transport | Implemented | Coinbase Exchange USD products, candle history and pagination, ticker/heartbeat, public L2 batch and observed trades. Network access required. |
| Equities history | Optional adapter | Server-side Alpaca raw historical stock bars with account-entitled feed and bounded pagination. No claimed universal equities coverage. |
| Local data | Implemented | Validated CSV, workspace history, research-universe JSON and labeled deterministic demonstration. |
| Screener and heatmap | Implemented | Computed values from imported universe or current watchlist; local filters/sorting; turnover-weighted rectangles. Last-bar change is not automatically 24-hour change. |
| Comparisons and spread | Implemented | Loaded dataset comparisons and conservative OHLC spread bounds; not an executable spread instrument. |
| Research panels | Implemented import/display | Events, news and fundamental metrics supplied in explicit versioned JSON; seasonality calculated from available months. |
| Global market data | Not supplied | No consolidated exchange licences, guaranteed real-time stocks/futures/options/FX, complete historical ticks, maintained corporate actions or automatic futures roll adjustment. |
| Full research suite | Not implemented | No live newswire/economic-calendar provider, complete financial statements database, options chain/Greeks, bond/yield-curve analytics, macro dashboards or ETF/DEX-wide data service. |
| Full screening suite | Not implemented | No global exchange-wide database, hundreds of fundamental fields, script-based distributed screener or complete asset-class coverage. |

## Private server and collaboration

| Capability | Release status | Exact boundary |
|---|---|---|
| Accounts / sessions | Implemented | Salted scrypt hashes, opaque hashed sessions, CSRF, same-origin writes, expiry and rate limits. |
| Saved workspaces | Implemented | Owner isolation, UUID identities and transactional compare-and-swap revisions; conflicts reject stale writes. |
| Persistent alerts | Implemented | Stored rule configuration/last firing/log; polling survives browser closure while Node process and provider remain available. |
| Rule types | Implemented | Crossings/comparisons/ranges/percent changes, conjunction/disjunction, frequency/cooldown/expiry; client sources include custom studies/scripts. Server sources are a fixed whitelist. |
| Alert delivery | Implemented | In-app log and authenticated SSE. Persistent recent events can be retrieved later. |
| Shared ideas | Implemented | Explicit snapshot publication, server-local feed, comments, likes, owner deletion and loading a shared chart. |
| Complete alert hosting | Not implemented | No hosted SLA, distributed scheduler, server-side script execution, drawing-geometry alerts, external email/SMS/webhook/web-push delivery or offline-provider backfill. |
| Social platform parity | Not implemented | No external charting platforms user graph, messaging, moderation platform, competition service, broker reviews or real-time collaborative document editing. |
| Production infrastructure | Not supplied | No deployment, TLS certificate management, MFA, recovery, email verification, audit certification, HA database, replication or guaranteed recovery point. |

## Reference catalogue

- Coinbase channels: https://docs.cdp.coinbase.com/exchange/websocket-feed/channels
- Alpaca paper trading: https://docs.alpaca.markets/us/docs/paper-trading

The inventories above are derived from this release's source. External references describe those providers/products, not an endorsement or proof of Aureon's equivalence.
