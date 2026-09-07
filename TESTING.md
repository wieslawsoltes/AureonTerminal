# Verification

## Included automated tests

```sh
npm run check
```

The delivered run passed **51 tests, 0 failed, 0 skipped**:

- 40 domain/numerical cases in `tests/core.test.js` covering bars, deduplication, resampling, indicators, drawing history, CSV validation, workspace schemas, strategy execution semantics, alerts, and paper accounting.
- 8 data/protocol-fixture cases in `tests/data.test.js` covering Coinbase tuple ordering, interval conversion, feed decoding/reconnect behavior, ISO week boundaries, and live-bar merge metadata.
- 3 worker cases in `tests/worker.test.js` running the actual worker handler through Node worker_threads, comparing Float64Array indicator output to the synchronous functions, verifying backtest output, and checking error request identity.

The WebSocket tests use a controllable test double. They verify client protocol handling, **not** access to Coinbase's live service.

## Browser interaction suite

The optional suite requires Python Playwright and a Chromium installation. These are test tools, not runtime dependencies.

```sh
python -m pip install playwright
# Set CHROMIUM_PATH to your installed Chromium/Chrome binary when necessary.
npm start
# In another terminal:
TEST_OUTPUT=verification/browser python tests/browser-smoke.py
```

The Linux default executable is `/usr/bin/chromium`. macOS example:

```sh
CHROMIUM_PATH='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' \
  python tests/browser-smoke.py
```

On an ordinary machine the suite opens `http://127.0.0.1:4173/?demo=1`. It does not require or test production market data. If browser navigation is explicitly blocked by enterprise policy, it tests the exact single-file distribution using `set_content` in a fresh document and records that condition. It does not change or bypass that browser policy.

The delivered browser run passed **14 interaction groups** with **no captured JavaScript errors**: startup/provenance/geometry, study toggles, six chart types, zoom/fit, drawing creation/undo/redo/objects, strategy calculation, replay and future-marker removal, alerts and demo execution gating, comparison data separation, both themes, workspace import, chart PNG export, imported resampling, and responsive desktop geometry.

Actual delivered browser execution:

| Property | Result |
| --- | --- |
| Loaded application | Exact standalone distribution in an isolated document |
| Renderer exercised | Canvas 2D fallback |
| Browser compute worker | Unavailable; synchronous fallback exercised |
| Captured JavaScript errors | 0 |
| Native worker handler | Separately verified in Node worker_threads |
| Production feed / CORS | Not exercised |
| WebGPU shader/adapter execution | Not exercised |
| Real GPU performance | Not measured |
| Cross-reload browser persistence | Not fully exercised; JSON import and storage-independent schema paths tested |

`verification/unit-tests.txt` and `verification/browser/browser-report.json` retain the results. Screenshots in the browser verification directory show the tested UI, using clearly labeled synthetic data. They are not proof of live market access.

## Manual acceptance on your target machine

Serve the app on localhost or HTTPS, open its developer console, and inspect the backend label. A successful GPU initialization should report WebGPU; a policy/device/browser failure should leave the working Canvas fallback. Inspect shader validation/device errors before doing performance work. Repeat with `?canvas=1` to compare behavior, not just frame timings.

For live-data acceptance, remove `?demo=1`. Confirm that the chart provenance changes to Coinbase only after REST bars load, that candle timestamps are UTC, that ticker prices update, that source age changes, and that an interrupted connection is visibly stale/reconnecting. Check REST book snapshot timestamps. Provider region/rate/CORS failures should leave a truthful cache/demo label. On localhost the fixed-host REST proxy can recover some direct CORS failures; it cannot recover a blocked WebSocket or unavailable provider.

Test a small paper market order against a fresh live quote; verify bid/ask side, fee, cash, cost basis, and cancellation/trigger handling for pending orders. Test replay separately: paper submissions should be disabled. Reload a saved layout and a saved import in an ordinary browser origin with storage enabled. Export a backup before clearing site data.

Benchmark only after confirming the actual backend. Measure viewport size, DPR, data size, visible bars, enabled panes, idle and active work separately. The on-screen CPU chart-frame metric is not GPU execution time. No specific FPS/latency target is asserted by this delivery.
