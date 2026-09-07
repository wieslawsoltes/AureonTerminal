# Security and deployment notes

This release includes concrete access-control and validation mechanisms, with adversarial protocol tests. It has **not** undergone an independent security audit, penetration test, financial certification or production availability assessment. Default use is a private local workspace.

## Safe startup boundary

The server listens on `127.0.0.1:4173` by default. A non-loopback bind requires an explicit `AUREON_ORIGIN`. For remote access use TLS termination, a matching external origin, correct Host forwarding, a private persistent data volume, restricted registration and infrastructure-level access controls. Do not expose a development server by simply changing HOST.

Environment is read from the process; `.env.example` is reference documentation and is **not automatically loaded**. Real `.env` files and `.aureon-data/` are excluded from git. Never put provider secrets in HTML, JavaScript, scripts, workspace JSON, shared ideas or a public directory.

For optional paper brokerage:

1. Start locally with no provider secrets; create and verify ownership of the intended account yourself.
2. Stop the process.
3. Set paper keys and `AUREON_BROKER_USER` to that existing username; restart.

The server resolves that name to an existing user ID at startup. A user registering a matching username later in the same process does not acquire broker permissions. No owner is authorized when the account did not exist at startup. For an existing installation, secure account creation before enabling broker credentials. This is a single configured owner, not a complete administrative RBAC system.

## Implemented controls

Passwords are 12–200 characters and preserve whitespace. A random salt and scrypt (`N=16384`, `r=8`, `p=1`, 64-byte output) generate password hashes. Login uses timing-safe comparison and performs a dummy scrypt for unknown users. Passwords are not stored in plaintext.

Sessions use 32-byte random tokens; only SHA-256 token hashes are persisted. Cookies are HttpOnly and SameSite=Strict, plus Secure when the configured origin is HTTPS. Sessions expire after eight hours and are bounded per user. Mutating API calls require a same-origin Origin check and a session-specific CSRF value. JSON request sizes and accepted field schemas are bounded. Authentication and API requests are rate-limited in process; those limits are not a distributed abuse-protection service.

Workspace records are owner-scoped. Revision checks occur inside the serialized store transaction. Missing compare-and-swap metadata rejects a workspace update; a stale revision returns a conflict rather than overwriting newer data. Server alert records, private event logs and SSE streams are also owner-filtered. Session expiry or revocation terminates private event streams.

Static files are served from a narrow allowlist. Private state, environment files and server implementation files are not exposed through static paths. Responses use content/security headers including a restrictive connection policy. Inline script/style and blob worker allowances are required by the self-contained client and are not equivalent to a maximally strict nonce-only CSP.

Provider URLs are fixed/allowlisted. The paper adapter has no real-money brokerage destination and discards unsupported client fields. Secrets are only added server-side to provider requests, not returned to the browser or included in portable workspace records. Provider errors are bounded; monitor failures do not turn into invented zero quotes.

## Persistence limits

Private files/directories request owner-only permissions. The single-process store writes a validated replacement to a temporary file and renames it atomically. The store is capped and transactions are serialized. Never run multiple processes against one store directory; there is no cross-process lock or conflict-resolution protocol.

State is **not encrypted at rest**. Atomic rename is not a full power-loss durability guarantee; there is no fsync transaction log, replicated database, key management, backup scheduler or disaster-recovery promise. Protect the host, filesystem, process environment and backups. A compromised host can access market credentials and private data. Account metadata, alert history and chart annotations may be sensitive even when no real-money trading is available.

## Shared content

Publishing an idea deliberately exposes its attached chart snapshot to other authenticated users of the same server. The snapshot can contain drawings, scripts and imported research. Inspect it before publishing; a private workspace is not automatically a safe public payload. Comments and likes are shared. This implementation has owner deletion and bounded content, not a full moderation, reporting, spam-detection or legal-compliance platform.

Research/news text and script diagnostics are escaped. News links are restricted to HTTP/HTTPS. Script source is interpreted through a whitelist and not evaluated as JavaScript. Budgets bound operations and storage, but this is not a formal interpreter-sandbox security proof. Avoid executing untrusted input in a high-value shared origin.

## Alerts and trading

Server rules are persisted and polled while the process and provider are available. Crossing baselines are reestablished after a restart; the first observation is not treated as an invented cross. The monitor does not replay missed offline market events. Recent firing logs persist; delivery is in-app/SSE, not an external notification SLA.

Local order simulation is not brokerage execution. Optional external brokerage is paper-only and requires explicit confirmation. Never use this release as the sole system for real financial risk, recordkeeping or price verification. No real-money orders were placed during development or testing.

## Absent production controls

MFA, email verification, account recovery, password-reset flows, organization administration, per-tenant encryption keys, durable audit trails, distributed rate limiting, database replication, managed TLS, webhook/email/SMS delivery, external identity federation and automated vulnerability response are not supplied. Remote deployment needs operational review rather than assuming the included safeguards establish production security.

See TESTING.md for the exact checks performed and the browser/provider limitations.
