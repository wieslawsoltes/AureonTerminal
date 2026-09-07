# Aureon Terminal 4.2 — implementation inventory

Aureon is an independent implementation. This document describes executable source and its actual interfaces, not certification, ownership of market-data rights, or equivalence to another product. Unsupported syntax and unavailable datasets fail explicitly. Tests and operating limits are documented separately in `TESTING.md` and `SECURITY.md`.

## Charting, studies and workspaces

| Capability | Implemented | Limits |
|---|---|---|
| Rendering | Native instanced WebGPU rectangles/segments; float64 financial calculations projected to local GPU pixels; independent Canvas renderer | Text is a Canvas overlay. Hardware GPU execution and throughput have not been verified in this environment. |
| Chart catalogue | 26 registered chart styles, 84 configurable study types, 66 drawing tools | Counts describe the actual registries, not an unlimited catalogue. Statistical warm-up gaps are preserved. |
| Rolling distribution studies — new | AVL median/quantiles, centered-moment regression/correlation/variance and UTC bucket weighted deviation bands | O(log window) rolling updates; float64, not arbitrary precision. Strict gaps/warm-up; fixed UTC buckets are not exchange calendars. |
| Observed-trade charts | Footprint, TPO, tick-count, volume and range views; configurable diagonal/same-row and stacked imbalances, deterministic POC/value area; aggressor/unknown classification and explicit provenance | Only supplied/received observations; no reconstruction of missing exchange prints. Older close-derived Renko/Kagi/P&F/line-break modes remain labeled approximations. |
| Patterns | Confirmation-delayed candlestick, pivot, chart, harmonic and constrained Elliott candidates | Rule-based candidates, not accuracy or forecasting guarantees. |
| Multi-chart editing | 1/2/4/6/8/16 charts with individual drawings, undo, studies, scale and history; linked navigation | Primary instrument retains execution focus. Secondary trade history starts from received observations. |
| Local synchronization | Explicit same-symbol drawing replication | Replaces local drawing snapshots when not connected to a shared operation document. |
| Shared drawing rooms — new | Per-property operation-set convergence, immutable actor/clock identities, authored selective undo/redo, deterministic deletion, duplicate-safe retries | Explicit room join; primary chart and opted-in same-symbol tiles. Anchors are one atomic property, not independent per-anchor edits. |
| Offline collaboration — new | IndexedDB operation-level transactions; independent tab actors, exact-payload acknowledgement and explicit rejoin after tab closure; legacy session queue migration | Not encrypted storage. Browser eviction/clearing and closing before transaction completion can lose pending edits. Undo groups are session-local. Failed acknowledgements remain queued; no exactly-once networking claim. |
| Shared-document limits | 10,000 retained operations / 8 MB per symbol, 16 symbols / 16 MB per room | No history compaction or silent truncation. Export a checkpoint and create a fresh document when capacity is reached. |
| Accessibility/mobile/PWA | Responsive browser UI, keyboard focus, textual data export, print and opt-in offline shell | No native application binaries or accessibility certification. Private APIs are not cached by the service worker. |

## AureonScript

| Capability | Implemented | Limits |
|---|---|---|
| Core language | Sequential series, historical indexing, conditions, bounded loops, typed declarations, persistent state, collections, records/methods, tuples and multiline functions | Explicit source, AST, operation, memory, string, recursion and collection limits. No arbitrary JavaScript execution. |
| Named arguments — new | User functions and supported technical kernels bind named/positional arguments, reject duplicates/unknowns, and evaluate bound arguments once per bar | Not every builtin signature accepts every optional argument. Unsupported options produce errors. |
| Libraries — extended | Explicit versioned local imports; nested exported functions; depth limit and cycle detection; immutable private/server-shared catalogue | No implicit network import or executable package loader. All source must be explicitly supplied. |
| Retained graphics — new | Line, box, label and table handles; supported creation/update/query/copy/delete operations; renderer integration and accessible result inspection | 500 active objects, 10,000 cumulative allocations and 10,000 allocated table cells per execution; no arbitrary DOM, HTML or executable handles. |
| Replay and graphics | Initial replay seek, rewind and exit recompute the correct prefix; generation and data guards discard stale worker output; low-level direct cutoffs hide future mutations | A direct cutoff is not a retained-object historical database. Recompute the prefix to recover earlier versions. |
| Causal broker feedback — new | Position, average price, equity, initial capital, realized/open profit, open/closed trades and win/loss counters during portfolio script execution | Confirmed-close evaluation after that bar's simulated market processing; commands first execute on the next raw bar/print. Not a full event-by-event broker runtime. |
| Realtime | Explicit editor start/stop and a dedicated sequenced worker session; ordinary rollback, `varip`, `barstate.isnew`; supplied closed lower-timeframe arrays | Indicators only, at most 5,000 seed bars in UI / 64 queued observations. Each update re-evaluates bounded history; capacity, feed reconnection or authoritative history changes stop rather than silently drop observations. No throughput claim, hidden fetches or future lookahead. |
| Statistical built-ins — new | Rolling median, linearly interpolated/nearest-rank percentiles, population/sample variance and covariance, paired correlation; named arguments and per-call-site state | Strict full-window finite observations; fixed parameters per call site; charged heap/operation budgets. Not an exhaustive builtin catalogue. |
| Parallel script screening — new | Frozen source/input/library/data snapshots, shared closed-bar cutoff, 1–4 independently cancellable workers, scalar current/previous columns, explicit dataset errors | Imported OHLCV only; at most 100 datasets, 500,000 input bars, 250,000 bars per dataset and 1,000,000 replicated closed bars across worker seeds. No network fetches or broker execution. Workerless fallback: 10,000 total bars and 250,000 operations per symbol. |
| Screening queries/reports — new | Up to 16 allowlisted predicates; numeric/text comparisons and crossings; missing-value predicates; stable sorting, pagination, 20 saved queries, formula-guarded CSV and snapshot JSON | At most 16 plots per symbol / 64 distinct titles. Only completed scans export. Snapshot chart opening requires supported chart intervals and at most 100,000 bars. Results are research, not executable quotes. |
| Profiling | Deterministic operation/heap profiles and reproducible rolling-statistics CPU microbenchmark | Not GPU performance certification or a distributed exchange-wide screening database. |

## Simulation and analytics

The portfolio simulator supports signed positions, named/FIFO lots, conservative reservations, pyramiding limits, targeted protective orders, partial fills, OCO, explicit costs/accrual/corporate actions, multicurrency cash, options settlement, and parameterized queue/impact assumptions. Actual-print magnification must reconcile supplied observations with raw OHLCV. Derived display prices are never silently used as fills. The legacy moving-average tester retains its simpler documented semantics.

Financial models include European and American option valuation, Greeks, implied volatility, portfolios/payoffs, bond yield/duration/convexity/DV01, discount/forward curves, financial ratios, explicit as-of corporate actions/futures rolls, fresh-FX valuation, holdings exposures and constant-product AMM calculations. These are model outputs, not executable quotes.

## Private services and storage

| Capability | Implemented | Limits |
|---|---|---|
| Identity/security | Scrypt passwords, opaque hashed sessions, CSRF/origin checks, TOTP/recovery codes, encrypted vault secrets and hash-chained audit entries | No provisioned identity provider, email verification or staffed account recovery. Operator review is required. |
| JSON storage | Serialized copy-on-transaction state with atomic rename and fsync | Exactly one process owns a JSON data directory. |
| SQLite storage — new | Opt-in native SQLite WAL; cross-process write serialization, revisions, rollback, latest committed reads, shared sessions and durable rate buckets | Same host, local filesystem only. Coarse JSON payload transactions, not a multi-node HA cluster, sharded database or network-filesystem protocol. |
| Monitor handoff — new | Leased price/script/drawing polling; fenced commits; durable price crossing baselines; stale samples ignored | Lease timeout controls takeover delay. Polls cannot recover unknown missed intrabar crossings. No historical outage backfill. |
| Notifications — hardened | Durable leased outbox, per-attempt claim identity, retry/backoff, consent-enabled email/SMS/signed webhooks/encrypted push | External delivery is at-least-once. A stale worker cannot finalize a newer lease, but downstream delivery can still duplicate. Provider acceptance is not recipient receipt. |
| Collaboration | Revision-controlled workspace snapshots, operation-set drawing documents, member authorization and account-bound authors; messaging/follow/block/moderation | Workspace snapshots still use CAS, not whole-workspace merging. Polling and committed event invalidations propagate changes. A bounded SSE journal supports cross-process delivery and authorized cursor replay; session revocations and current membership/blocks are checked at delivery. |
| Backup — extended | Authenticated encrypted backup with explicit active-driver selection, or unambiguous single-file detection; committed logical SQLite snapshots plus vault key; exclusive restore to a new directory | Restore outputs logical JSON and migrates on SQLite startup. Operator must stop processes and rehearse recovery; no guaranteed RPO/SLA. |
| Deployment | Non-root container and TLS reverse-proxy configuration; static client/PWA on Pages | Private backend is not deployed by publishing the static site. Provisioning, monitoring and disaster recovery remain operator tasks. |

## Providers and brokerage

Fixed-host adapters cover Coinbase market transport, Alpaca entitled equity/options/news data, FRED/ALFRED vintage observations and SEC facts. Imports retain provenance. Credentials, exchange rights, a maintained global calendar/corporate-action service, all asset classes, normalized global fundamentals and guaranteed historical ticks are not bundled or fabricated.

Ordinary tickets remain local simulations. The external paper adapter is separate. A narrowly restricted production adapter is disabled by default and requires a pre-existing MFA owner, HTTPS, fresh risk checks, immutable preview and typed confirmation. It supports only its documented whole-share long-only DAY limit workflow. This release neither enables it nor submits real orders. There is no universal broker network, custody, certification, all-order-type router or operational approval.

## Still outside this release

An exhaustive language/builtin catalogue, complete intrabar strategy recalculation and broker feedback surfaces, all drawing/study presentations, native mobile binaries, global licensed research/data infrastructure, verified email ownership/recovery operations, distributed global screening, multi-node high availability, and hardware GPU performance validation remain outside the delivered implementation. The new code closes specific scripting, collaborative-editing and same-host concurrency gaps without disguising those external or unimplemented boundaries.

### Event replay limits (4.1)

The journal retains at most 4,096 entries for 24 hours. It carries small invalidations or bounded alert payloads, not full private workspace snapshots. A new stream starts at the tail; automatic reconnection resumes an opaque epoch/sequence cursor. A stale, foreign, future or pruned cursor emits a resync instruction. Persistent consumers must refresh authoritative state after resync. Delivery is not exactly-once and this is not multi-host pub/sub. Five streams per user per process and bounded socket backpressure prevent unbounded per-client buffering.
