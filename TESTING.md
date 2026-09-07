# Aureon Terminal v3 verification

The v2 evidence is retained separately in `docs/V2_TESTING.md` and `verification/v2`. The v3 work was validated with Node.js 22 and Chromium on Linux. Counts below are executed checks, not promises of parity or production certification.

## Local results

- **400 Node tests passed**, no failures/skips/TODO, including nested HTTP integration cases.
- **46 existing browser regression groups passed**, no captured page JavaScript errors.
- **29 new v3 browser groups passed**, no captured page JavaScript errors, using the standalone document and independent Canvas renderer.
- Source syntax checks and standalone generation passed; the generated worker handlers are tested, not substituted stubs.

The local browser’s managed policy blocks loopback navigation. Its v3 run therefore used `--document`: browser authentication, PWA installation/offline navigation, secure-origin WebGPU and browser worker execution were **not** established there. Module/worker execution and actual HTTP server behavior were independently exercised in Node. The new secure-origin browser harness and CI workflow additionally run from a normal loopback origin; consult the PR Actions results/artifacts for their actual status, not these local counts.

## Added test coverage

`v3-analytics.test.js`: option values/put-call parity/Greeks finite differences/IV bounds, American trees, OCC dates, payoff multipliers, bond yield and derivatives, curves, as-of actions/rolls, FX freshness, AMM conservation, actual-print bars/profiles, confirmed pivot delay and pattern prefix causality.

`v3-script.test.js`: call-site histories, arrays/maps/matrices, alias-preserving snapshots, typed records/methods, tuples, explicit libraries, lower-timeframe closure, realtime rollback/varip, profiling, unsafe-property rejection, allocation/string/cycle budgets. The two old tests that rejected newly supported function history were replaced with positive semantic tests, not simply removed to mask failures.

`v3-execution.test.js`: named lots, reservations, targeted exits, partial execution, accounting events, queue-ahead consumption, magnifier reconciliation and no duplicate liquidity. Existing study/geometry tests enumerate all **73 studies and 66 drawings**.

`v3-security.test.js`: published RFC6238 SHA1/SHA256/SHA512 vectors; counter replay prevention; authenticated vault persistence; audit mutation/reorder detection; SSRF address rules; independent RFC8291 payload decryption and VAPID signature verification; outbox deduplication/backoff/deleted-channel handling; webhook owner binding/signatures.

`v3-providers.test.js`: fixed-host read-only fixtures, pagination, FRED vintage, SEC contact identity, credential redaction, concurrency, actual isolated server-script workers. **All real-money tests use fixtures**: default-disabled gates, pre-existing MFA owner, stale quotes, cash/positions, immutable previews, concurrent single-submission, uncertainty/reconciliation and hard attempted-notional caps. No real credentials or order submissions.

`v3-services.test.js`: actual local Node HTTP requests for authentication/CSRF/MFA recovery, restart, role bootstrap, notification recipient isolation, immutable/private libraries, room revision races, opt-in messaging/blocks, moderation, isolated script evaluation, durable script/drawing crossings, deletion races and disabled live routing.

`v3-backup.test.js`: authenticated encryption, incorrect passphrase/tampering rejection, state+vault restore and exclusive output creation.

## Commands

```sh
npm run build
npm run check
python scripts/verify-browser-v2.py
python scripts/verify-browser-v3.py
# In browser environments that deliberately block loopback navigation only:
python scripts/verify-browser-v3.py --document
```

The browser scripts require Python Playwright and Chromium, independently of application runtime. Set `CHROMIUM` to the installed executable. Reports distinguish renderer and worker availability. Screenshots/JSON are written under verification; CI artifacts are the authoritative result of that run.

## Not established

Actual WebGPU hardware shader/device execution or GPU throughput; production Coinbase end-to-end reliability; authenticated external paper/live brokerage, research entitlements, live email/SMS/Push delivery; live Docker/TLS deployment; exchange certification; accuracy of heuristic pattern classification; WCAG/native-app parity; distributed storage/delivery or guaranteed recovery. Tests prove specific invariants and fixtures, not the completeness of TradingView or Pine semantics.
