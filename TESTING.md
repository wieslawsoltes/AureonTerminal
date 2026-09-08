# Aureon Terminal v4.3 verification

Verification distinguishes executable source, local tests, real-origin browser tests, and external services. Archived earlier evidence is not proof that a new commit passes; the current commit's Actions runs are authoritative.

## Verified v4.3 CI snapshot

Source snapshot: `d23b3b6316642ee813a811cd381518f2eb7a4e2a`.

- [Source/test/build workflow](https://github.com/wieslawsoltes/AureonTerminal/actions/runs/34168027100): **591 tests passed**, independent reference guard and reproducible standalone build passed.
- [Browser workflow](https://github.com/wieslawsoltes/AureonTerminal/actions/runs/34168027160): **71 groups passed** (31 + 11 + 8 + 10 inherited, plus 11 renderer groups), zero captured page JavaScript errors.
- Artifact `aureon-v4-chromium-34168027160`, SHA256 `ac565b4b473658bd38cf99da79c9c637ef51944e0f8e67cb7a80fb7ab1d6f6b3`, was downloaded and all five JSON reports inspected. Renderer images include `workspace-webgpu.png` and `gpu-presentation.png`.
- Actual WebGPU used Chromium 151.0.7922.34 with the SwiftShader fallback adapter, a headed window and Xvfb. The three screenshot pixels and six independent readback fixtures pass. Device destruction/reacquisition, two-chart isolation, 4x MSAA, high-DPI readback, resize, controls and export pass. This is real shader/API execution on a **software** device, not physical GPU throughput or full conformance certification.

The application source and standalone distribution are unchanged by this evidence-only documentation update. Every subsequent PR head still runs the full suites; this immutable snapshot is not a substitute for its checks.

## Local checks

- **591 automated Node tests passed**, with no failures, skips or TODOs, on Node 22.16.0.
- Earlier v3/v4/v4.1 browser evidence is retained for history, not asserted as a new 4.3 result.
- New actual-origin browser results must be read from the current PR CI artifact; suite definitions are not passing evidence.
- Source syntax checks, standalone generation and the current-file independent-product reference guard passed.

The managed local Chromium policy blocks loopback navigation. Local browser results therefore do not establish authenticated collaboration, real browser worker transport, or service-worker installation. Node HTTP/worker tests run independently. The CI browser workflow runs the inherited suites on a permitted HTTP origin (31 v3, 11 v4, 8 v4.1 and 10 v4.2 groups), followed by 11 actual-device renderer groups. These include authenticated two-browser collaboration and pending-queue recovery. Consult that workflow's report for the actual outcome rather than treating the suite definition as a passing result.

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

## 4.2 regression and benchmark scope

`v42-statistics.test.js` checks full-window finite-pair rules, population/sample divisors, large-offset small-variance inputs, abrupt level changes, AVL invariants under duplicate insertions/deletions, sorted-reference quantiles/ranks, regression residuals and UTC-session volume-weighted bands. All 84 study registry entries also run the inherited prefix-causality and finite-output checks. Script tests exercise the six new named statistical built-ins, per-call-site isolation, parameter validation and budget exhaustion.

`v42-screening.test.js` covers frozen cutoff/source/data copies, provisional/future exclusion, higher-timeframe lookahead prevention, actual Node-worker session messages, scalar transfer size, parse resets, strategy rejection, per-symbol errors, deterministic sorting, missing values, column crossings, formula-safe CSV, query round-trip, pool cancellation, late progress suppression, worker disposal and restricted fallback budgets.

`verify-browser-v42.py` is chained after v4.1 by the normal browser CI entry point. Ten new groups exercise the studies catalogue, editor statistics, a two-worker scan, actual filter/sort forms, CSV download, saved query reload, immutable snapshots, independent cancellation, opening the exact captured dataset and mobile layout. HTTP mode requires real workers; `--document` explicitly models Worker unavailable and does not claim HTTP reload persistence or dedicated-worker success. It never relaxes application CSP or browser navigation policy. Evidence is under `verification/v4/statistics-screening/` (or `statistics-document/`).

`npm run benchmark:statistics` reports one warm-up and median-of-three CPU timings over deterministic synthetic float64 prices, after checking results against independent reference loops/sorts. It controls neither GC nor CPU isolation, imposes no timing thresholds in CI, and establishes no GPU, browser, multi-client or feed-throughput guarantee.

## 4.3 verification status

The previous source transfer was incomplete. Eleven complete file edits were
recovered with their before/after hashes. The renderer's truncated body was
reimplemented and independently tested; the former 582-test claim does not
certify this new tree.

Local: 42 renderer tests cover geometry/DPR budgets, immutable fallback state,
device/pipeline sharing, loss/retry, late completion, timeout, disposal, buffer
reuse, capture limits, cancellation and staging cleanup. These use explicit test
doubles, not a real GPU. All 549 inherited tests also pass (591 total).

The local managed browser denies loopback navigation. Real-origin and actual
WebGPU verification is therefore delegated to repository CI, not bypassed.
`scripts/verify-browser-v43.py` requires SwiftShader and reports actual primitive
readbacks, 4x coverage, DPI, device loss, resource reuse, settings and export.
The complete CI report for source snapshot `d23b3b6316642ee813a811cd381518f2eb7a4e2a` was downloaded, hash-verified and inspected: all 11 renderer groups pass. Later commits require their own passing checks.

Unverified: physical GPU throughput, real driver crashes, every browser/driver,
production providers and external brokerage/notification services.

The initial real-device run caught a genuine WGSL compilation error: `meta`
was used as a field name despite being reserved. The field and both references
were renamed to `styleData`. The actual-device suite stays mandatory; passing
unit-test doubles do not replace compilation/pixel verification.

Observed Chromium adapter reacquisition can return null with an expired-instance
warning. Each shared acquisition now performs at most three adapter attempts,
with bounded 40/80 ms delays and disposal checks. Exhaustion stays on Canvas;
validation errors are not retried and there is no background recovery loop.
Adapter diagnostics include `GPUAdapterInfo.device` and the standardized fallback
flag without treating empty descriptive labels as a failed renderer. Native and
standalone release labels and offline cache identity are generated from the same
package release value; persistent workspace schema versions remain unchanged.


The native Chromium trace identified a test-host compositor failure: forcing
ANGLE Vulkan required unavailable VK_KHR_surface/VK_KHR_xcb_surface extensions,
then WebGPU swap-chain shared images could not be allocated and the browser
terminated devices. The verifier now uses Chromium's Vulkan/SwiftShader pixel-test
combination (ANGLE SwiftShader, Vulkan SwiftShader and disabled Vulkan surfaces).
It additionally decodes a browser-compositor screenshot and checks exact visible
WebGPU canvas pixels, independently of offscreen readback. Application code and
all lifecycle/pixel assertions remain unchanged by this host correction.

The corrected compositor configuration passes every device/readback/loss test in
headless mode, but that host's actual WebGPU screenshot remained transparent.
A controlled matrix confirmed that a **headed Chromium window under Xvfb** also
passes the unchanged visible-pixel assertion after a one-shot render (no render
loop). The mandatory renderer suite therefore uses that display configuration;
Linux CI re-enters through the already-installed `xvfb-run` when DISPLAY is absent.
Other local environments require an explicit display and retain browser policies.
The verification report identifies this headed software-device test environment.
Native screenshots, six readback fixtures and device lifecycle tests all remain
mandatory. This is not a claim that headless presentation or physical GPUs have
been validated on every browser. The final PR CI run remains the release evidence.
