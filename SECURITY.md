# Security and operating boundaries — Aureon Terminal v3

## Defaults and trust zones

The public client is static. Private accounts, research, delivery and brokerage exist only in the separately operated Node server. Provider secrets belong in the server environment, not source, URLs in user configuration, browser storage, portable workspace JSON or Pages artifacts. The default real-money gateway is **off**; normal tickets and replay are simulated.

Remote binding requires `AUREON_ORIGIN` with matching Host and Origin. Deploy behind HTTPS. HTTP-only, SameSite-Strict opaque sessions are hashed at rest; writes require same-origin plus CSRF, request-size and rate limits. Passwords use salted scrypt. Server-side scripts run in bounded worker threads with operation/allocation, memory, concurrency and hard-time limits. Pure source cannot access network, filesystem, global objects or host methods.

## MFA, recovery and privilege bootstrap

MFA uses RFC6238 TOTP and records the consumed counter to reject replay, including after restart. Enrollment requires the existing password and verification of the new authenticator. Recovery codes are shown once and only hashes are stored; each is one-use. Keep them offline. Session revocation and password changes are available in Pro → Security & delivery. Losing both authenticator and recovery codes requires operator recovery; there is no email reset service or automated identity proofing.

Secrets for MFA and VAPID are encrypted with AES-256-GCM and purpose-bound AAD using `.aureon-data/vault.key`. The key and state directory are private (0600/0700); file permissions do not protect against a compromised process or host root. Back up **both** state and vault key, encrypted with an independently stored passphrase.

Research, notification recipient bindings, moderators and live-account owners resolve only from accounts that already exist when the server starts. Bootstrap locally without provider credentials, then stop and restart with explicit owner usernames. Do not leave open registration on a private remote deployment. A username is not a verified email identity.

## External alerts

No external message is sent until the operator configures a recipient/destination and the signed-in user consents to a channel. Email uses Resend, SMS uses Twilio, webhooks use operator-owned aliases, and browser Push subscriptions are limited to known browser push services. These providers may charge. Webhook callers cannot supply arbitrary URLs; HTTPS destinations reject credentials/non-443 ports/IP literals, resolve only public IPv4 addresses, pin that address for TLS, disallow redirects and apply deadlines. Signatures cover timestamp plus exact body; receivers must validate freshness and deduplicate `X-Aureon-Id`.

The outbox atomically records alert events with delivery jobs, leases pending work, retries with backoff, and retains failures. This is **at-least-once**, not exactly-once. Email has a stable idempotency key; SMS/Push and ambiguous network responses may duplicate. Provider acceptance is not evidence of recipient delivery. A stopped process, unavailable provider or stale data prevents fresh monitoring. There is no hosted SLA, distributed scheduler or automatic gap backfill.

Script monitors evaluate closed bars in isolated workers. Drawing alerts support explicit price-as-a-function-of-time line types. Edits/deletions are rechecked before committing a result. Unsupported geometry or warm-up gaps produce diagnostics instead of fabricated alerts.

## Separate real-money adapter

No production credentials have been used or real order sent during development/verification. `AUREON_LIVE_ENABLED=I_ACCEPT_REAL_MONEY_RISK` is a deliberate operator switch; without it, separate live credentials, a pre-existing owner, MFA and HTTPS, all live operations fail closed. Do not enable merely to inspect the demo.

The supported production route is narrow: fixed Alpaca host, whole-share long-only equity **DAY limit** orders, no extended-hours execution, fresh non-crossed bid/ask within 15 seconds, active-account/cash/position checks, per-order and daily attempted-notional caps. Limits must remain within 20% of the fetched quote. Preview is read-only and expires in 60 seconds. Submission consumes the immutable preview once, requires the exact displayed LIVE phrase and an unused MFA/recovery code, rechecks provider risk and assigns a unique client order ID.

An uncertain provider response is **never retried automatically**. Use read-only reconciliation by client ID; inspect the actual broker account before any subsequent order. Daily caps conservatively include attempted/uncertain submissions. There is no general cancel/replace flow, production shorting/options router, custody, audit certification, exchange queue guarantee, account-wide broker lock or equivalence to broker-side risk controls. Other applications can change the broker account concurrently. The operator must complete independent review, paper testing, vendor authorization and operational controls before considering enablement.

No script, alert, imported document or normal simulation ticket calls this route. The user-facing Pro preview/confirmation form is distinct from simulation; UI click-through is not a substitute for broker-side controls.

## Collaboration and persistence

Rooms share explicit workspace snapshots among named members; CAS revisions reject stale overwrites. Separately joined drawing documents use an append-only operation-set CRDT. Account-prefixed actor identities and transactional membership checks prevent forged authorship; same-account devices may undo their own authored history. Drawing anchors are atomic, and bounded histories fail at capacity rather than discarding operations. Private libraries/messages enforce ownership/membership; DMs require recipient opt-in, bilateral blocks deny new messages/follows, and moderation roles are operator configured. Reports and local moderation are not a staffed global abuse service.

The JSON store serializes transactions and performs file + directory fsync around atomic rename. It is **one process only**: do not mount the same state directory in multiple writers. Audit hashes detect edits/reordering while retained, not malicious deletion of an unanchored tail. An opt-in SQLite mode uses local-filesystem WAL locks for several processes on the same host; do not use JSON mode for that configuration. SQLite transactions, durable rate buckets and fenced monitor/delivery claims are tested across processes. These are not multi-node HA, replication, guaranteed RPO or an external immutable audit sink.

`node scripts/backup.mjs` provides encrypted offline backup/restore, but it cannot prove the server is stopped; the operator confirmation is mandatory. A SQLite backup exports a committed logical snapshot, not stale migrated JSON or a raw database file missing WAL contents. Restore goes to a new directory and never overwrites live state; it restores logical JSON plus the vault key, ready for explicit SQLite migration. Rehearse recovery before relying on it.

The PWA only caches the public standalone shell/icon/manifest. API paths and private data are not cached by its service worker. Existing intentional local workspace/simulation storage remains browser-local and is not a secure secrets store. Clear site data on shared machines.

## Collaborative client and scripts

Pending shared drawing operations use account/room/symbol-scoped IndexedDB, not encrypted secret storage. Legacy session queues migrate transactionally. They contain drawing content and account/room identifiers, never session tokens or passwords. They are removed after acknowledgement; explicit leave flushes first. Closing a tab after transaction completion retains pending edits for explicit rejoin. Clearing site data, browser eviction or closing before a write commits can destroy unacknowledged edits. Undo groups do not survive reconnect. The service worker never caches drawing APIs.

Retained script handles only resolve within their execution. Validated geometry uses the chart pipeline; literal label/table text never becomes HTML. Script broker feedback comes from local confirmed-bar simulation, never the production adapter. The v4 changes do not enable, exercise or broaden real-money routing.

## 4.1 event and backup boundaries

Event publication occurs inside the domain storage transaction. Stream delivery rechecks the persisted session, recipient, room membership and current message blocks. Retained events are private state and part of encrypted offline backups; event payloads are bounded. Events do not contain session credentials, provider keys or full workspace documents. Resync after a retention/epoch gap is mandatory for an authoritative consumer. Process-local connection caps are not distributed abuse prevention; keep the private deployment behind operator controls.

Backup accepts an explicit `storage` option through its library API and `AUREON_STORAGE` in its CLI. If both JSON and SQLite files exist without a selection, it refuses an ambiguous backup instead of returning a successful backup of stale state. The operator still must stop all writers, choose the configured active driver, safeguard the independent passphrase and rehearse restore.

Realtime editor mode is indicator-only. It has no route to brokerage, no independent network imports, and no authority to submit orders. It uses observed chart state rather than generated prices; source changes/reconnects/capacity failures require explicit restart. Strict Content Security Policy remains unchanged.

## 4.2 local script screening

The screening pool executes bounded indicator programs only. It never sends orders, delivers alerts or fetches implicit datasets. Imported source, scalar inputs, libraries and market observations stay local to the browser and its dedicated workers unless the user explicitly exports a report or separately saves their workspace to a private server. JSON reports include captured source/inputs/local libraries and result rows; review their contents before sharing.

Cutoffs are common across primary and explicitly requested datasets. Partial bars are excluded rather than converted into confirmed prices. The interpreter operation/heap/source limits still apply. Worker count, total copied bars, result columns and predicate counts have explicit bounds. Cancellation kills only scan-owned workers. A clone/worker error cannot silently turn a stateful session into fresh synchronous execution. CSV export prefixes formula-like text; data is never interpreted as JavaScript or inserted as unescaped HTML.

### Renderer resource and diagnostic boundaries (4.3)

The geometry builder bounds primitive count and rejects nonfinite coordinates,
invalid colors and nonprogressing dash subdivision. Backing-store pixel budgets
apply before allocation, including the text overlay. Limits are per chart, not a
process-wide GPU memory guarantee. Device loss requires explicit retry and does
not change financial state.

Pixel verification uses a temporary device and fixed primitive fixtures. It
performs no network request and does not destroy the application's shared device.
Manual diagnostic JSON exports report renderer state and adapter identifiers;
users decide whether to share them. Reports contain no account credentials.
Readback is bounded and is not performed in normal chart frames. Browser
permission or administrator restrictions are not bypassed by the app or tests.
