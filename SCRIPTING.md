# AureonScript — language and execution contract

AureonScript is an independently implemented, bounded financial-series interpreter. A version comment does not switch the runtime. There is no JavaScript `eval`, arbitrary property access, DOM access, network import or executable package loading. Importing a workspace or library does not run its source automatically.

## Series and types

Supported surfaces include sequential bar evaluation, nonnegative historical indexing, conditions, bounded loops, ternary expressions, typed declarations, `var`, API-level realtime `varip`, inputs, plots/fills/colors, alerts, strategy commands, tuples, arrays/maps/matrices, records/methods, and scalar/multiline functions. Technical kernels preserve warm-up gaps and call-site-isolated state. Collection history snapshots preserve aliases without mutating prior bars.

```text
indicator("Collection average", overlay=true)
var values = array.new<float>(0)
array.push(values, close)
if array.size(values) > 20
    array.shift(values)
plot(array.avg(values), "Average")
plot(ta.ema(source=close, length=12), "EMA")
```

Named arguments are accepted by user functions and the supported technical signatures. A bound argument is evaluated once for each requested bar, so accessing a parameter twice does not repeat a side effect such as `array.pop`. Unknown, duplicate and missing arguments fail explicitly. Not every builtin supports every possible optional argument.

## Retained chart objects

Lines, boxes, labels and tables have opaque handles. A handle cannot access the browser or another script's objects. Supported methods validate coordinates, colors, dimensions, indexes and text before producing declarative output. Text remains text, never interpreted HTML.

```text
indicator("Price annotation and status", overlay=true)
var line guide = line.new(0, close, 1, close, color=color.aqua, width=2, extend=extend.right)
line.set_xy2(guide, bar_index, close)
var label priceTag = label.new(0, close, "Close", style=label.style_label_down)
label.set_xy(priceTag, bar_index, close)
label.set_text(priceTag, str.tostring(close))
var table status = table.new(position.top_right, 2, 2)
table.cell(status, 0, 0, "Symbol")
table.cell(status, 1, 0, syminfo.tickerid)
table.cell(status, 0, 1, "Close")
table.cell(status, 1, 1, str.tostring(close), text_color=color.aqua)
```

The worker result's `graphics` array is connected to chart geometry and its text overlay, independently of user drawings. The editor exposes retained-object data for inspection. Object positions support bar index or explicit time as documented in `src/script-graphics.js`. Copy/delete and getter/setter support is enumerated there; unsupported methods/options produce diagnostics.

Each execution permits at most 500 active objects, 10,000 cumulative object allocations and 10,000 allocated table cells. Deletion does not reset cumulative allocation budgets. A table has bounded dimensions and per-cell clipping. A historical request cannot mutate graphics on an earlier bar.

Direct replay hides objects whose last update is beyond its cutoff. It does not invent their earlier state. Re-running the script on the replay prefix reconstructs the correct prefix snapshot. API-level realtime sessions recompute ordinary retained objects under rollback; this is not an incremental retained-object database.

## Libraries and profiling

Imports use explicitly supplied versioned source, for example a `libraries` map:

```json
{
  "local/base/1": {"source":"export twice(x) => x * 2"},
  "local/derived/1": {"source":"import local/base/1 as b\nexport value(x) => b.twice(x) + 1"}
}
```

```text
import local/derived/1 as d
plot(d.value(x=close))
```

Only exported functions are linked. Nested imports are depth-bounded and cycles fail; no network requests are performed to resolve a missing library. The private server catalogue provides immutable owner-controlled versions, private unless explicitly shared. Supply those versions before executing an import.

Profiles report executed-line operation counts and heap counters, not measured CPU/GPU performance. The bounded script screener runs over explicitly loaded datasets, not an implicit global universe.

## Time and realtime

`request.security` uses supplied higher/equal-timeframe datasets only after their bars close. `request.security_lower_tf` returns supplied closed intrabars inside the parent interval. Requested datasets use explicit `symbol:seconds` keys. Nested requests are independently evaluated and cannot advance the main portfolio's broker callbacks.

`RealtimeScriptSession` is a separate timestamp-ordered API. Ordinary state rolls back to the prior confirmed bar; `varip` may survive updates and `barstate.isnew` marks a new bar. The standard chart editor remains a batch execution surface. Full incremental tick evaluation and all possible recalculation/order qualifiers are not implemented.

## Causal portfolio feedback

Choose **Advanced tester → Current script** to evaluate source against the portfolio simulator. On each bar, the simulator first processes its raw market observations, then exposes the resulting account to the script at confirmed close. Commands emitted there become eligible on the next raw bar/print. A signal cannot obtain a retrospective fill at its own close.

```text
strategy("Causal position")
if bar_index == 1 and strategy.position_size == 0
    strategy.entry("first", strategy.long, qty=1)
if bar_index == 10 and strategy.position_size > 0
    strategy.close("first")
plot(strategy.position_size, "Position")
plot(strategy.equity, "Equity")
```

Feedback series: `strategy.position_size`, `position_avg_price`, `equity`, `initial_capital`, `netprofit`, `openprofit`, `opentrades`, `closedtrades`, `wintrades` and `losstrades`. Historical indexing applies to these series. A standalone study/editor execution without a broker has a flat account; it is not secretly running an execution simulation. Portfolio results include the executed script output and profile so the chart can show the fill-aware history.

Both `performJob('portfolio', ..., {source})` and `performJob('backtest', ..., {source})` use this causal portfolio path. Source-free moving-average backtesting retains its existing simple result contract. For direct use, call `runScriptPortfolioBacktest` from `src/execution-pro.js`.

Named entry, close, close_all, exit, cancel and cancel_all commands remain local simulator instructions. Named/FIFO lots, reservations, partial fills and protective orders do not confer exchange matching access. A trade magnifier must reconcile actual supplied prints with raw OHLCV and uses a shared liquidity budget. Without it, the adverse-first OHLC path is an explicit assumption.

## Unsupported surfaces

The supported grammar, builtin methods and order qualifiers are finite. There is no complete intrabar broker feedback/runtime, unrestricted type/overload system, global library runtime, arbitrary web access or automatic real-money execution. Source/AST/history/operation/allocation/string/recursion limits may reject large programs. Unsupported behavior returns an error instead of being silently approximated through JavaScript.

## Editor realtime mode (4.1)

Select **Realtime** on an indicator while a market dataset is loaded, outside replay. The dedicated worker keeps `varip` updates within the current bar while rolling ordinary variables and retained objects back before each observation. Completing a bar records its confirmed evaluation and starts the next bar with `barstate.isnew`. Strategies/order commands are rejected: use the separate portfolio tester for causal simulated execution.

The UI accepts up to 5,000 initial bars and 64 pending observations. It does not drop or coalesce observations silently: overload, stale/regressed history, worker loss, feed reconnection or changed authoritative history stops the session. Stop/cancel, context changes and replay also stop it. Restart explicitly after selecting an appropriate history. The engine re-evaluates bounded prefixes per update, so cost grows with history/source complexity; hardware and live-provider throughput are unverified.

```text
indicator("Observed updates", overlay=false)
varip int observations = 0
if barstate.isnew
    observations := 0
observations += 1
plot(observations, "Updates including confirmation")
```

The final bar-confirmation evaluation also increments this example's counter. It counts interpreter evaluations, not a promise of a complete exchange trade tape. Initial replay seeks and rewinds now automatically rebuild retained objects from the selected historical prefix. Asynchronous jobs are rejected when their source/context/data generation is no longer current.

## Rolling distributions and paired statistics (4.2)

All six additions accept positional or supported named arguments:

```text
ta.median(source, length)
ta.percentile_linear_interpolation(source, length, percentage)
ta.percentile_nearest_rank(source, length, percentage)
ta.variance(source, length, biased=true)
ta.covariance(source1, source2, length, biased=true)
ta.correlation(source1, source2, length)
```

`length` must be an integer from 1 to 10,000 and fixed at a call site for an execution. Percentage is fixed in `[0, 100]`. `biased` must be boolean: true divides centered sums by `n`; false divides by `n-1`, with sample variance/covariance undefined for `n=1`. Correlation is undefined when either paired variance is zero. Missing/nonfinite observations invalidate the entire current window, rather than shrinking it or filling a value. Function invocations keep independent call-site state; realtime rollback remains controlled by the existing execution session.

Linear percentiles use `h=(n-1)*percentage/100` and interpolate neighboring ordered observations (R7). Nearest-rank percentiles select `max(1, ceil(n*percentage/100))` in one-based order. The median is the linearly interpolated 50th percentile. Different statistical packages can use different percentile definitions; these conventions are deliberate and tested. Reference definitions: https://www.itl.nist.gov/div898/handbook/prc/section2/prc262.htm .

The interpreter charges state capacity before allocating a rolling tree and charges rolling work against the normal operation budget. The `rolling-statistics.js` implementation never forms variance by subtracting two large raw squares. Pairwise nodes carry original-sample anchors, local means and centered second moments. Order statistics use a duplicate-aware AVL multiset. Both structures have `O(window)` retained storage and bounded `O(log window)` update work.

```text
indicator("Distribution screen")
plot(close, "Close")
plot(ta.median(source=close, length=20), "Median")
plot(ta.percentile_linear_interpolation(close, 20, 75), "Upper quartile")
plot(ta.variance(close, 20, biased=false), "Sample variance")
plot(ta.correlation(close, volume, 20), "Price / volume correlation")
```

### Script screening

The Script tools screener runs indicators only over explicit imported datasets. Source, local libraries, scalar inputs and a single UTC cutoff are copied before scheduling. Both primary data and data available through explicit `request.security` calls exclude future/provisional bars. Plots yield current and previous scalar values, not full series sent between workers. Threshold crossings compare the last two valid outputs at that dataset's own cadence; they are not cross-exchange tick synchronization. Every row records interval, last closed-bar end, age at the cutoff and provenance.

Queries are data-only objects, never executable expressions. Errors and undefined values stay separate from matches. Scan exports include the captured source and query, so changing the editor after completion does not relabel an old scan as the new program. Full raw history is not embedded in the report JSON; opening an eligible row uses the completed scan's retained immutable dataset copy.
