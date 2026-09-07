# Aureon Terminal v4.1 verification

Verification distinguishes executable source, local tests, real-origin browser tests, and external services. Archived earlier evidence is not proof that a new commit passes; the current commit's Actions runs are authoritative.

## Local checks

- **479 automated Node tests passed**, with no failures, skips or TODOs, on Node 22.16.0.
- Earlier v3 browser evidence is retained for history, not asserted as a new 4.1 run.
- **6 new v4 static browser groups passed** through document injection, with no captured page JavaScript errors.
- Source syntax checks, standalone generation and the current-file independent-product reference guard passed.

The managed local Chromium policy blocks loopback navigation. Local browser results therefore do not establish authenticated collaboration, real browser worker transport, or service-worker installation. Node HTTP/worker tests run independently. The CI browser workflow runs both suites on a real permitted HTTP origin: 31 inherited groups and 11 v4 groups, including authenticated two-browser collaboration and pending-queue recovery. Consult that workflow's report for the actual outcome rather than treating the suite definition as a passing result.

## New regression coverage

`tests/v4-core.test.js` covers disjoint-property convergence, deterministic shuffled delivery, authored selective undo, undo-before-target delivery, deletion versus concurrent edits, duplicate IDs/equivocation, atomic invalid-batch rejection, document limits and rendering-hostile property values. It also covers next-open position/equity feedback, history, prefix causality, holdout initialization, partial-bar exclusion and both scripted worker backtest routes.

`tests/v4-store.test.js` covers independent SQLite instances, rollback, restart and JSON migration; three actual Node processes committing to one local database; lease fencing; shared rate limits; committed SQLite backup/restore; and parallel vault initialization. These tests establish same-host concurrency, not multi-node HA or power-loss certification.

`tests/v4-services.test.js` runs two Node HTTP servers over shared SQLite state. It verifies shared sessions, room/member authorization, forged-author rejection, simultaneous disjoint drawing writes, selective undo, duplicate/equivocation behavior, revoked membership and durable crossing state across monitor takeover.

`tests/v4-script.test.js` covers retained line/box/label/table creation and updates, copy/delete, invalid options and capacity, opaque handles, literal text, realtime rollback, prefix behavior, finite projected geometry, clipping, replay cutoffs, named arguments with side effects, nested/cyclic libraries and nested higher-timeframe evaluation that cannot advance the parent account clock.

The inherited monitor-deletion race now waits until the asynchronous lease acquisition actually reaches the provider before deleting the rule. It still asserts deletion suppresses the pending result; the safety assertion was not removed.

## Browser suites

`verify-browser-v3.py` retains chart modes, pattern scanning, workers, sixteen editable panes, simulation, authentication, mobile layout and offline PWA checks.

`verify-browser-v4.py` exercises editor controls, retained-object geometry/text, literal label handling, fill-aware advanced tester results, nested libraries, replay cutoffs and mobile layout. In HTTP mode it additionally signs in two browsers, joins a shared room through UI controls, merges concurrent offline property edits, checks ordinary toolbar undo against a remote edit, recovers a persisted queue after a lost acknowledgement/reload, and explicitly flushes/leaves.

Both harnesses use demo/import fixtures rather than production providers. They poll through DevTools without weakening the application's Content Security Policy. Browser evidence includes JSON reports and screenshots; failures still cause a nonzero process exit.

## Commands

```sh
npm run build
npm run references
npm run check
python scripts/verify-browser-v3.py
python scripts/verify-browser-v4.py
# Restricted browser environments only (transport groups are explicitly skipped):
python scripts/verify-browser-v3.py --document
python scripts/verify-browser-v4.py --document
```

Python Playwright and Chromium are test tools, not runtime dependencies. `CHROMIUM` selects the installed executable. Reports are written to `verification/v3/` and `verification/v4/`; CI uploads fresh evidence. Regenerate the committed standalone distribution before checking reproducibility.

## Not established

Hardware WebGPU shader/device execution or throughput; credentialed production research/broker feeds; real-money orders; recipient receipt of email/SMS/push; production TLS/container operation; native mobile binaries; accessibility certification; global licensed datasets; multi-node failover; lossless recovery after power failure; recognition/prediction accuracy of heuristic patterns; or an operational SLA. No real credentials, external notifications or real orders were used for this implementation's tests.

## 4.1 regressions

`v41-events.test.js` checks bounded journal retention, recipient privacy, authorized cursor replay, session revocation, socket pressure, transaction rollback, backup driver ambiguity, explicit JSON/SQLite selection and pre-journal restore cursor clearing. `v41-http-events.test.js` launches two independent Node processes on a shared local SQLite database: one writes, the other streams, reconnect replays only the correct user's workspace, and logout on the first process closes the second process's stream.

`v41-features.test.js` checks realtime rollback and `varip`, explicit completed-bar rollover, ordering/clock/history/capacity rejection, independent job runtimes, workerless cancellation, indicator-only operation, diagonal/same-row footprint ratios, missing-row behavior, stacks, unknown-side volumes, deterministic POC/value areas, workspace validation and failed outbox batch retention.

`verify-browser-v41.py` is invoked by the existing v4 HTTP harness, with reports under `verification/v4/next/`. Its eight browser groups exercise actual IndexedDB transaction/acknowledgement isolation, unavailable storage, closing a tab and recovering in a new one, replay rewind/exit, stale job removal, actual stateful workers, realtime UI with an explicitly injected validated trade fixture, and footprint controls. Local managed Chromium blocks HTTP navigation, so these new secure-origin groups must be checked in CI; the test definitions alone are not passing evidence. No browser policy or application CSP is weakened.
