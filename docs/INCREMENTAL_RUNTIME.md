# Incremental realtime indicators (4.5)

The realtime editor has two execution engines and one conservative planner. It
uses the same original AureonScript parser as batch execution; source is never
passed to JavaScript `eval`, `Function`, imports or an executable module loader.
This is an incremental **scalar-series subset**, not an incremental implementation
of every language feature. Batch execution and portfolio testing retain the
reference interpreter.

## Using the editor

Open **Script editor**, choose the `streaming`, `trend` or `oscillator` example,
and select **Plan realtime**. Planning requires no market history or provider
requests. Its result names the supported kernels or a concrete fallback reason.
It is a capability check, not a claim that a particular history fits the memory
and operation budgets.

**Auto incremental** selects the fast engine only when every statement is safe.
**Incremental only** rejects unsupported source before arming a session.
**Reference interpreter** explicitly retains bounded whole-history re-evaluation.
Realtime itself requires a market dataset and is disabled for replay, imported
research and the synthetic demonstration. It never submits a strategy or
brokerage order. Alerts retain their configured close/intrabar rules; using an
incremental indicator does not implicitly change an alert to confirmed-close.

The engine selector persists in the version-2 workspace extension without
changing the workspace schema. It does not rearm a saved session automatically.
Source, input, dependency or engine edits, selecting another script, replay,
reconnection, authoritative history revisions, cancellation and capacity failures
require an explicit restart. Plan output is discarded when its context changes.

## Supported graph

The planner accepts immutable scalar assignments, literals, bar fields, fixed
history offsets, scalar input controls, supported math, pure conditional
expressions and stable per-bar flags. It produces a topologically ordered graph
with history slots and isolated kernel state per call site. Named technical
arguments use the reference interpreter's signature mapping.

Twenty existing technical functions have incremental kernels:

| Kernel family | Functions | Update state |
|---|---|---|
| Windows | `sma`, `sum`, `wma`, `highest`, `lowest`, `stdev`, `linreg`, `variance` | Persistent aggregate-tree roots; O(log window) updates/range queries. |
| Recursive | `ema`, `rma`, `rsi`, `atr` | Bounded scalar accumulators, initialization count and previous state. |
| History/event | `change`, `mom`, `roc`, `cross`, `crossover`, `crossunder`, `cum`, `barssince` | Fixed-offset history reads and bounded scalar state. |

Plots, horizontal levels, shapes, color series, backgrounds and alert conditions
are supported with stable output metadata. Dynamic data-derived string
construction, arbitrary objects and executable effects are not fast-path nodes.

The entire source falls back when it uses mutable/persistent/`varip` variables,
functions/libraries, collections/records, retained graphics, plot-handle fills,
loops or statement-level control flow, historical data requests, unsupported
technical functions, dynamic window/history parameters, or end-relative
`barstate.islast`. Technical calls inside lazy branches also fall back: eagerly
advancing such calls would change their reference semantics. There is no hidden
per-node mix of incompatible execution models. Syntax/sandbox errors remain
errors rather than successful fallback plans.

## Commit and rollback

A seed processes every supplied closed bar once. The current open bar is
provisional. Before evaluation, scalar kernel records are checkpointed and their
persistent tree roots retained. Updating a window path-copies O(log window)
nodes rather than cloning the whole window. Provisional evaluation restores those
roots and scalar records; it never appends a provisional sample to closed state.

A rollover requires the actual completed previous bar, with the unchanged open,
nondecreasing volume and nonshrinking high/low envelope. The worker evaluates and
commits that bar once, then evaluates the new provisional bar. Sequence, clock,
capacity or cumulative-OHLC violations stop the session. Runtime failures do not
silently switch engines after observations have been accepted.

Centered moments avoid inverse variance subtraction. Ordered aggregate ranges
preserve chronological WMA/regression weights. Floating-point summation order can
differ from the reference; differential tests use declared tolerances, preserve
NaN warm-up/gap behavior and include large-offset, small-variance inputs. This is
float64 arithmetic, not arbitrary-precision finance or bit-identical summation.

## Tail protocol and chart ownership

`LiveScriptRuntime` defaults to the backward-compatible full-snapshot protocol.
The editor requests `transport: 'tail'` with a unique `sessionId`. An incremental
seed returns full arrays at sequence zero. Later frames carry:

```js
{
  bars: 256,                         // total retained length
  patch: { start: 255, baseSequence: 7 },
  live: { sessionId: "...", sequence: 8, asOf: 0, confirmed: false },
  // Each plot/alert/color/background has one row here, or two on rollover.
  execution: { engine: "incremental", transport: "tail patch", /* ... */ }
}
```

The timestamp above is illustrative; actual frames contain their observation
clock. Same-bar updates replace the last row. An append includes the previous
row's final confirmed values and the new provisional row. No prior committed
rows are retransmitted. Returned typed arrays are detached output copies, never
the worker's own history buffers.

`LiveResultAccumulator` owns the main-thread chart arrays. It checks identity,
sequence, base cursor, row counts, schema, capacity and nonregressing time before
accepting a frame. It allocates replacement numerical buffers geometrically and
writes only the accepted tail, exposing full-length typed-array views to the
existing renderer. Duplicate, foreign, missing or malformed patches fail rather
than silently skipping observations. A failed frame cannot partially mutate the
accepted chart state.

These chart snapshots are **mutable views owned by the accumulator**, not an
immutable time-series database. Clone a result before keeping an independent
audit/export snapshot. The graph's public full snapshots remain independent
copies. Initial seeding/transfer, occasional buffer growth and chart rendering
still perform separate work; non-time-chart projection and rendering may scan
history. Tail transport is not a claim of O(1) total UI or network latency.

## Limits and diagnostics

The editor retains at most 5,000 bars and 64 queued observations. The low-level
session accepts a configured maximum of 10,000 bars, but never silently rolls
history off. The graph allows at most 5,000 nodes and 64 plot outputs. A default
2,000,000-cell memory budget charges graph histories, output channels and a
conservative persistent-tree estimate; the standalone low-level API can request
at most 4,000,000 cells. These are logical accounting limits, not exact process
RSS or GPU-memory ceilings. Main-thread output buffers have their own
2,000,000-cell budget.

The editor uses a 1,000,000-operation seed/step budget. The low-level API accepts
an explicit maximum of 20,000,000 operations; total seeding work is checked as
well as each subsequent evaluation. Cancellation terminates the owned worker.
Queue/history capacity, worker loss, timeout and invalid observations stop rather
than discard events invisibly. Browser storage eviction and OS process limits
remain outside these logical limits.

Execution diagnostics distinguish engine, fallback reason, graph size, charged
series cells, evaluated-bar count, last/total kernel operations, output cells and
transport mode. The output-cell counter includes plot colors in addition to
numerical values. Incremental operation counts describe one kernel step; the
reference count describes its whole prefix. They are not directly comparable CPU
instruction counts. Profiles and output construction have their own costs.

## Validation and benchmark

`tests/v45-incremental.test.js` compares seeds, successive provisional updates and
confirmations against the unchanged reference interpreter, including missing
values, initialization, history, input metadata, shapes, alerts, flags, named
arguments, rollback, capacity, ownership and honest fallback. The transport suite
checks tail reconstruction, geometric buffer reuse, atomic malformed-frame
rejection, identity/cursor fences and the actual Node worker message handler.

`scripts/verify-browser-v45.py` requires real dedicated workers on an HTTP origin
for its normal mode and checks editor planning, selected engines, rollback,
reference-equivalent plots, cancellation, replay isolation, mobile controls and
preference persistence. `--document` explicitly disables browser workers and
omits persistence; passing that mode alone is not browser-transport evidence.
All market observations in these tests are labeled injected fixtures; no external
provider, brokerage or notification recipient is contacted.

```sh
npm run build
npm run check
npm run references
npm run benchmark:realtime
python scripts/verify-browser-v45.py
```

The realtime CPU benchmark checks output equality, then reports one warm-up and
the median of three 1,200-bar / 40-update synthetic runs. It compares four
indicator plots using incremental tail construction/assembly against reference
full snapshots in one Node process. Forty updates transfer 160 numeric values
in the incremental protocol versus 192,000 in the full protocol for this
workload. It does not measure actual IPC, exchange transport, browser rendering,
GPU work, power, GC-isolated performance or a guaranteed throughput/SLA.
