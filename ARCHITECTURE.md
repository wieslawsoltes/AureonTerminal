# Aureon Terminal 4.0 — architecture and invariants

## Application boundary

The browser client is plain HTML/CSS/JavaScript with no runtime package or CDN dependency. `src/app.js` owns the original workspace; `src/workbench.js` composes studies, scripting, advanced execution, research, tiles and Pro tools. The private Node backend is optional. Pages publishes only the generated static client, icon, manifest and service worker; private state, provider credentials and server execution are never part of that artifact.

The implementation uses publicly documented algorithms and provider protocols. No proprietary implementation or branding assets are bundled. This is a source-level engineering description, not a separately audited provenance or financial certification.

## Rendering and coordinates

The financial numerical core uses float64 values. Chart projection converts timestamps/prices to viewport-local pixels before GPU float32 conversion. `src/renderer.js` batches rectangles and line segments into 48-byte instances, using reusable buffers and a WGSL instanced geometry pipeline. Visible-range selection, candle aggregation and study decimation reduce submitted geometry. Canvas renders text/crosshair; a separate Canvas geometry path handles unavailable WebGPU devices. Invalidation drives redraws instead of an unconditional idle rendering loop.

Chart style transformations preserve their raw source relationship. Standard time charts, observed-print bars and explicitly approximate close-derived styles are separate representations. The portfolio tester receives raw bars, not synthetic display prices. Footprint/TPO observations are bounded, provenance-labeled and cut off by replay; unknown prints are never reconstructed.

Script-generated objects are validated declarative records, separate from user drawings. `script-graphics-renderer.js` projects them into existing geometry and text layers. Cell text is clipped, handles cannot select arbitrary DOM nodes, and strings are not HTML. A direct replay cutoff suppresses objects updated in the future; prefix script recomputation reconstructs earlier versions.

## Numerical jobs and language

Study and script work runs through `jobs.js` / `engine-worker.js`. Requests preserve identity, reject errors explicitly and return typed arrays/results. Generated standalone builds embed the actual worker bundles. A bounded synchronous fallback is used when workers are unavailable; it is not represented as worker execution in verification reports.

AureonScript has a lexer, Pratt expression parser, bounded AST and sequential interpreter. Function state is isolated per call site; collection snapshots preserve same-bar aliases and historical values. User-function named arguments bind once per requested bar. Supported technical named arguments normalize to their numerical kernels. Explicit versioned libraries link exported functions, with nested depth/cycle limits and no network resolution.

`ScriptGraphics` owns execution-local line/box/label/table handles. Mutations consume ordinary operation/allocation budgets and have explicit object/cell limits. Results are structured-cloned across workers; no source code is evaluated as JavaScript. Historical-request evaluation cannot mutate an earlier bar's objects.

Higher-timeframe data becomes available after its source bar closes. Lower-timeframe arrays contain supplied closed intrabars only. Nested dataset evaluation does not invoke the parent broker's callbacks. The realtime session API models ordinary rollback and persistent `varip`, but the editor's regular refresh remains a bounded batch job.

## Causal execution

`execution.js` retains the legacy simple backtest/simulation contracts. `execution-pro.js` adds named/FIFO lots, reservations, partial executions, protective orders and explicit accounting events. These are models, not exchange queue or operational brokerage guarantees.

The portfolio market-step generator processes a raw bar before yielding its confirmed-close account snapshot. `runScriptPortfolioBacktest` feeds that snapshot into the sequential interpreter; emitted commands are queued for the following bar or supplied print. Position, average cost, equity and realized/open profit are therefore actual simulated feedback, not precomputed flat placeholders. Nested data requests cannot consume an extra market step. Training/holdout boundaries start account exposure flat while allowing earlier bars to warm indicators.

The print magnifier first reconciles observations against OHLCV. Finite print liquidity cannot be consumed twice. Without reconciled prints, the adverse-first OHLC path is an explicit assumption. Borrow/funding, corporate actions, FX and option settlement require supplied events/parameters. There is no implicit maintained accounting dataset.

## Drawing convergence

`DrawingDocument` is an append-only set of immutable operations keyed by `actor:clock`. Set operations update allowed properties of a drawing. Registers resolve by ascending Lamport clock and ordinal actor ID, giving order-independent convergence. Duplicate identical operations are idempotent; identity reuse with different content rejects the entire batch.

Membership uses `$alive`, separate from visual properties. A concurrent color change cannot resurrect a deleted drawing. Undo/redo emits an authored toggle of a prior operation, not a compensating overwrite. Consequently undoing one's own color edit does not remove a later edit from another author. Toggles may arrive before their target and still converge. Points form one atomic register. There is no per-anchor sequence CRDT or history garbage collection.

The document retains a bounded history: 10,000 operations / 8 MB per symbol. A room admits 16 symbols and at most 16 MB of drawing history. Capacity exhaustion fails before committing; applications must explicitly export/reseed a new document rather than silently losing undo history.

## Collaborative transport and UI

`RoomDrawingSync` wraps the ordinary primary-chart history only after explicit join. Local edits become queued operations; normal toolbar/keyboard undo uses authored toggles. Matching tiles participate only with drawing synchronization enabled. Other instruments retain their local history. Polls that add no operations do not disturb selection; remote application is deferred during pointer manipulation.

Pending operations persist in tab session storage under account/room/symbol identity. A retry reuses immutable IDs. The client merges a successful response before acknowledging its pending batch. A failed leave keeps the connection/queue; reloading and explicitly rejoining recovers saved pending operations. Storage failure is surfaced and warns against closing the page. Undo groups themselves are not durable across reconnect.

The server endpoint is `/v2/pro/rooms/:id/drawings?symbol=...`; the API namespace remains compatible with existing workspaces. Each POST accepts at most 256 operations, requires current room membership and binds actor prefixes to the authenticated account. Membership is rechecked inside the transaction. Workspace payload snapshots continue to use revision CAS independently; drawing commits never overwrite those snapshots. Polling reads committed operations and works across same-host processes; SSE is still process-local.

## Storage contracts

The default JSON store is single-process: a serialized clone/mutate/validate/write/fsync/rename transaction publishes a replacement state only after persistence. Do not open the same JSON directory with multiple writers.

The opt-in `SQLiteStore` implements the same transaction interface using native Node SQLite, WAL and FULL synchronous writes on local disk. `BEGIN IMMEDIATE` acquires a database writer lock before reading the latest payload. Lock acquisition retries asynchronously with a deadline; the transaction callback is never replayed. A callback failure rolls back. Successful commits advance a revision; readers refresh when that committed revision changes. The logical payload has a 200 MB ceiling.

This is a coarse state-row architecture for small same-host private services, not a row-sharded or multi-node database. Each callback holds the write transaction through its asynchronous work; keep callbacks short and avoid external requests while holding it. Node's synchronous SQLite calls have CPU/event-loop costs. WAL must not be placed on network storage.

An empty SQLite database migrates validated JSON once. Afterward SQLite is authoritative. Shared session reads, transactional account/room writes and durable rate buckets use that state. Operator/provider configuration must be consistent across processes. The vault key is published with an exclusive hard link only after fully writing/fsyncing a temporary key, so concurrent initializers share one complete key.

## Leases, monitoring and notifications

Price and script/drawing polling acquire named leases with owner IDs and monotonic fence tokens. A final mutation rechecks ownership, token and expiry inside its state transaction, along with rule revision/deletion. Old owners cannot commit after takeover. Price crossing baselines persist even when no alert fires, so another process can compare the next observation without resetting the rule. Stale/equal-time observations are ignored.

Lease timeout determines failover delay. Polling does not recover unknown missed ticks or historical crossings. Errors remain visible instead of becoming fabricated zero quotes. Private event streams are process-local; durable logs can be read from another process.

Notification outbox claims have unique attempt IDs. Completion/failure can update only the still-matching active claim, preventing stale workers from finalizing a newer attempt. Consent, operator-bound destinations and per-provider security checks remain intact. External side effects are at-least-once: a crash after provider acceptance but before local commit can cause a duplicate. No exactly-once delivery or recipient receipt guarantee is claimed.

## Security, backup and deployment

Scrypt credentials, hashed opaque sessions, same-origin/CSRF gates, TOTP/recovery codes, ownership/member checks, vault encryption and audit chains form the existing private-service boundary. Audit hashes are tamper-evident retained records, not an externally anchored immutable ledger. SQLite mode adds shared throttling; JSON retains its one-process throttle.

`backup.mjs` encrypts the logical committed state plus vault key. For SQLite it reads the current database snapshot, not migrated stale JSON or a raw database file without its WAL. Restore is exclusive to a new directory and produces logical JSON for optional SQLite migration. The operator must stop processes and rehearse recovery; this does not provision disaster recovery or an RPO/SLA.

Normal tickets/scripts/alerts never invoke the separate production adapter. That fixed-host, disabled-by-default route has its own pre-existing MFA owner, HTTPS, immutable preview, typed confirmation, fresh quote/risk checks and uncertain-submission reconciliation. No v4 change activates or broadens it. Private hosting, external credentials, licensed feeds and operational approval are outside static deployment.

See `FEATURE_MATRIX.md`, `SCRIPTING.md`, `SECURITY.md`, `DATA_PROVIDERS.md` and `TESTING.md` for exact supported surfaces and verification boundaries.
