# Aureon Terminal 3.0 — executable scope and remaining boundaries

This inventory replaces the v2 matrix (retained in `docs/V2_FEATURE_MATRIX.md`). It describes the repository, not full external charting platforms equivalence or a certified financial service. “Implemented” means working source and the specified interface exist. Verification, hardware limitations and provider-fixture boundaries are in `TESTING.md`.

## Charting and editing

| Capability | v3 implementation | Boundary |
|---|---|---|
| Rendering | Native instanced WebGPU geometry, float64 financial coordinates transformed to local GPU pixels; independent Canvas fallback | Actual GPU hardware/performance remains unverified. Text is a Canvas overlay. |
| Chart styles | **26** registered styles: previous 15 plus volume-width candles, high/low, HLC band, marker/step/circle variants, footprint, TPO, tick-count, trade-volume and observed-range candles | Volume-width candles retain the time axis. Older Renko/Kagi/P&F/line-break transforms remain explicit close-derived approximations. |
| Tick/volume/range | Validated ascending actual observations; volume splits size without inventing intermediate prices | An observation feed can have gaps. There is no reconstructed lossless exchange tape. Range overshoots reflect actual gaps. |
| Footprint/TPO | Price-level aggressor buy/sell/unknown volume, delta/CVD/POC; observed price/UTC-period TPO letters; replay excludes future observations | Not every commercial footprint presentation/imbalance mode; no unobserved prices filled in. Same-time trade bars have timestamp-anchor ambiguity. |
| Multi-chart workspace | **1/2/4/6/8/16** views; each secondary view has editable drawings, undo/redo, scales, studies, history pagination and a shared live ticker connection | Trade data in secondary charts covers ticker observations since loading, not historical tick retrieval. Primary instrument retains execution focus. |
| Synchronization | Linked time/crosshair; explicit opt-in drawing replication among matching symbols | Replication replaces that symbol’s drawing snapshot; it is not per-object CRDT merging. |
| Mobile/offline | Responsive workspaces, focus indicators, keyboard navigation, textual OHLCV export/table, print view, installable offline shell | No native App Store binaries or accessibility certification; service workers require supported secure origins. |

## Studies, drawings and patterns

**73 study types** are registered, up from 33; **66 drawing tools**, up from 37. Counts are derived from the registries, not marketing aliases. Existing template/parameter/color/visibility/pane controls work with the expanded catalogues. Prefix-causality and geometry tests enumerate all registered types.

The additional studies include ALMA, KAMA, ZLEMA, McGinley, Aroon, Vortex, Choppiness, Ultimate Oscillator, TSI, TRIX, PPO/PVO, Coppock, CMO, Fisher, Force, Elder Ray, PVT/NVI/PVI, Chaikin, Ease of Movement, Mass/Ulcer indices, historical volatility, percentile rank, regression slope and confirmed fractals. Statistical windows retain warm-up gaps.

New drawings include pitchfork variants, channels, arrows, angles, Fibonacci arcs/wedges/log spirals, price/time Gann constructions, polygon/Bezier/highlighter/arc, cyclic projections, anchored labels/VWAP and pattern annotations. They are editable geometry, not trading signals or forecasts.

Automatic detection now covers candlestick patterns, confirmed pivots, double/triple tops and bottoms, head-and-shoulders/inverse, triangles/wedges, harmonic and constrained Elliott-impulse candidates. Each result carries an observation/confirmation time; future pivots cannot appear in an earlier prefix. These are rule-based candidates, not recognition accuracy guarantees or a complete pattern taxonomy. The registry is still **not the entire external charting platforms catalogue**.

## Scripting and strategy semantics

| Capability | v3 implementation | Boundary |
|---|---|---|
| Collections/types | Bounded typed arrays/maps/matrices, tuples, record fields, methods and multiline functions | Not all external scripting languages type qualifiers, overloads, collection methods or builtin functions. |
| Series functions | Call-site-isolated histories; alias-preserving bar-boundary collection snapshots | Explicit operation/history/allocation/string budgets can reject large programs. |
| Libraries | Explicit versioned local imports with exported functions; immutable public/private server catalogue | Original AureonScript only. No external charting platforms marketplace import, proprietary runtime or licensing access. |
| Realtime | `RealtimeScriptSession` API with ordinary rollback, `varip` updates and `barstate.isnew`; closed lower-timeframe arrays from supplied datasets | API-level session; standard chart batch jobs do not claim tick-for-tick external scripting languages runtime parity. |
| Profiling/screening | Executed-line operation profile, heap counters; script screening over up to 50 explicitly loaded universe datasets | Not a distributed global screener; no automatic universal historical database. |
| Strategy commands | Named entries, targeted closes, close-all, limit/stop entries, exits/OCO, cancellation; next-bar execution in the portfolio tester | No complete external scripting languages broker feedback (`strategy.position_size` etc.), every order qualifier, broker certification or intrabar recalculation semantics. |

**Full external scripting languages compatibility and full external scripting languages cloud IDE/ecosystem remain unimplemented.** The additions are a substantive expansion of an original interpreter, not a renamed proprietary runtime. Unsupported syntax fails explicitly. See `SCRIPTING.md`.

## Execution and financial analytics

The simulator adds conservative pending-capital reservations, entry-ID/FIFO lots, pyramiding limits, targeted exits, explicit borrowing/cash/funding accrual, splits/dividends, multicurrency cash valuation, option exercise settlement and a parameterized queue/impact model. Core-only accounting operations have explicit JSON tools in Pro. The queue’s supplied ahead volume is an assumption, not exchange matching access.

The trade magnifier accepts an actual-print dataset only when its aggregates reconcile raw OHLCV. One print’s finite liquidity budget cannot be spent twice. Without that dataset, the tester documents its adverse-first OHLC path; it does not synthesize a tick tape. Corporate actions and accrual are explicit events/period assumptions, not a maintained brokerage accounting service.

Research models include European Black–Scholes value/Greeks, implied volatility, American CRR trees, option portfolios and expiry payoff, bond cash-flow price/yield/duration/convexity/DV01, discount/forward curves, financial ratios, macro transforms, as-of corporate adjustments, explicit-schedule futures rolling, fresh-quote FX valuation, holdings exposures and constant-product AMM/impermanent-loss calculations. These are model results, not executable quotes or predictions.

### Real-money adapter — disabled by default

A separate fixed-host Alpaca production adapter is implemented, **not activated or exercised with real credentials**. Only a pre-existing configured MFA owner over HTTPS can manually preview and confirm whole-share, long-only, DAY limit equity orders. Every submission needs the exact immutable confirmation phrase and an unused MFA/recovery code. Fresh quotes, cash/position checks, per-order/daily attempted-notional caps, unique client IDs and explicit reconciliation guard uncertain outcomes. No script, alert, simulation ticket or workspace import invokes it.

This is **not** a general real-money brokerage network: no shorting, options orders, broker OAuth federation, custody, exchange certification, full cancel/replace workflow or operational approval. Credentials and live enablement require operator decisions outside the source. See `SECURITY.md`.

## Data and research providers

| Provider | Implemented adapter | Requirements / limits |
|---|---|---|
| Coinbase Exchange | Public candles, pagination, ticker/heartbeat, L2 and observed trades | Network availability and product support; no lossless history claim. |
| Alpaca data | Existing raw equity bars; new option-chain snapshots and metadata/headline news | Server-side credentials, a pre-existing research owner and appropriate data entitlement. Indicative is the default option feed. |
| FRED/ALFRED | Series observations with an explicit requested vintage | Operator API key; revisions are not silently presented as historical knowledge. |
| SEC EDGAR | XBRL company facts retaining native filing dates and units | Numeric CIK and operator contact User-Agent; no universal normalized statements model. |
| Imported datasets | OHLCV, trades, research, events, fundamentals, curves, holdings and roll schedules | Values retain supplied provenance; no false live label. |

Global exchange licences, every market/asset class, a maintained corporate-action/calendar database, complete economic-event service, universal ETF/DEX discovery, fully normalized global fundamentals, real-time options analytics entitlement and guaranteed historical ticks are **not supplied**. Model engines and fixed-provider adapters do not confer those rights or create the datasets.

## Private hosting, alerts and collaboration

Implemented: scrypt sessions/CSRF, MFA enrollment/TOTP replay prevention/recovery codes, session revocation/password changes, encrypted-at-rest MFA/VAPID secrets, tamper-evident audit chains, transactional workspace/room revisions, private/public versioned libraries, follows, opt-in private messaging, bilateral blocks, reports and operator-bound moderation.

Server-side script and drawing-line monitors use closed bars, isolated workers with memory/time/concurrency limits, durable crossing state and edit/deletion rechecks. Persistent rules can enqueue opt-in email (Resend), SMS (Twilio), signed operator-allowlisted HTTPS webhooks and encrypted Web Push, in addition to in-app/SSE. The durable outbox has leases, retry/backoff and terminal failures. Delivery is at-least-once, not exactly-once; provider acceptance is not proof of recipient receipt. Offline-provider backfill and distributed scheduling remain absent.

A Docker/Caddy deployment configuration and encrypted offline backup/restore utility are included. The JSON store is **single-process**, serialized and fsynced; it is not a replicated HA database. Operator hosting, DNS/TLS provisioning, monitoring, backups/restore rehearsals, email ownership verification, account-recovery support, abuse operations, compliance audits and an uptime/RPO SLA remain outside this delivered installation. No production infrastructure has been deployed by this PR.
