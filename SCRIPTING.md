# AureonScript 2 — bounded original series interpreter

This is the independently implemented AureonScript language. `//@version=6` remains a comment; it cannot change the runtime. No `eval`, DOM, network, dynamic module access or arbitrary JavaScript properties are exposed. Source imported in a workspace/library remains inert until explicitly run.

## Supported surfaces

Sequential bar series/history, typed assignments, ternary/conditions, bounded loops, persistent `var`, realtime-session `varip`, inputs, plots/fills/colors/alerts, named strategy commands, scalar and multiline functions, call-site-isolated technical kernels, tuples, arrays/maps/matrices, typed records/methods and explicit versioned local library imports. Source, AST, history, recursion, operations, strings, collection elements and allocations have caps. Arrays are not unrestricted JavaScript objects.

```text
indicator("Collection average", overlay=true)
var values = array.new<float>(0)
array.push(values, close)
if array.size(values) > 20
    array.shift(values)
plot(array.avg(values), "Average")
[a, b, histogram] = ta.macd(close, 12, 26, 9)
```

```text
type Point
    float price
method shift(Point self, float offset) =>
    self.price := self.price + offset
    self.price
p = Point.new(close)
y = p.shift(2)
plot(y)
```

Functions retain independent histories at each call site. Collection history snapshots preserve aliases inside the same bar without mutating earlier bars. String expansion and matrix multiplication consume budgets. Invalid indexes/types/cycles fail explicitly.

## Libraries and profiling

Pro → Script tools accepts a map such as:

```json
{
  "local/math/1": {
    "source": "library(\"Local\")\nexport smooth(float x) => ta.ema(x, 3)"
  }
}
```

```text
import local/math/1 as m
plot(m.smooth(close))
```

Only supplied exported functions link. There is no network library download or external charting platforms import service. The private server catalogue publishes immutable versions under the publishing account; each version is private unless explicitly shared. Import a shared version before referencing it.

Executed-line profiling reports deterministic operation counts plus heap allocation counters, not a CPU-time/performance certification. Script screening runs up to 50 explicitly loaded universe datasets with per-run limits; unavailable outputs/errors remain visible.

## Time and realtime evaluation

`request.security` waits for higher/equal-timeframe bars to close. `request.security_lower_tf` returns arrays of closed intrabars inside the current parent interval, using explicitly supplied datasets keyed by `symbol:seconds`. No hidden provider fetching or future lookahead occurs.

`RealtimeScriptSession` is an engine API for timestamp-ordered updates. Ordinary state is rolled back to the previous confirmed bar; `varip` state can survive updates and `barstate.isnew` can reset counters. Confirmed-history snapshots are preserved. This session API is tested separately; ordinary chart-study refreshes remain batch jobs. It is not a claim of exact external scripting languages realtime/event semantics or incremental performance.

## Strategies

```text
strategy("Named example")
if bar_index == 1
    strategy.entry("first", strategy.long, qty=1)
if bar_index == 10
    strategy.close("first")
```

Supported commands include named entry, close, close_all, exit with limit/stop/from_entry, cancel and cancel_all. Entries can carry quantity and limit/stop fields. The Pro portfolio tester and Current script mode in Advanced tester execute confirmed-close commands at the next raw bar or next supplied actual print. No command sends an external order. Entry-ID lots, conservative pending reservations, pyramiding limits, targeted reduce-only exits and OCO are simulator semantics, not exchange margin.

Actual-print magnification requires reconciliation against raw OHLCV and uses a shared finite liquidity budget. Without it, adverse-first OHLC execution is an explicit approximation. Plot-shifted/synthetic chart bars are not execution prices.

Still absent: the full external scripting languages grammar/type qualifier/overload universe, all builtins, user-defined drawing objects/tables, complete broker feedback such as `strategy.position_size`, full intrabar/recalculation/order qualifiers and external charting platforms cloud/community runtime. Unsupported syntax is rejected, never silently executed through JavaScript. Compatibility is described by tests and supported APIs, not by the presence of a familiar function name.
