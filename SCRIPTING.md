# AureonScript 1 — language and runtime

AureonScript is an original, bounded, Pine-inspired series interpreter. It is **not Pine Script v6 compatibility**. A `//@version=6` line, when encountered in imported text, is merely a comment and never enables a Pine runtime. Unsupported syntax/functions produce errors rather than being silently executed as JavaScript.

The canonical implementation is `src/script.js`; examples are in `examples/`. The editor runs source explicitly. Workspace import or server idea loading does not automatically run a newly supplied script.

## Working study

```text
// AureonScript 1
indicator("Two moving averages", overlay=true)
length = input.int(21, "Length", minval=1, maxval=500)
source = input.source(close, "Source")
fast = ta.ema(source, length)
slow = ta.sma(source, length * 2)
a = plot(fast, "Fast", color=color.blue, linewidth=2)
b = plot(slow, "Slow", color=color.orange)
fill(a, b, color=color.new(color.blue, 90))
alertcondition(ta.crossover(fast, slow), "Cross up", "Fast crossed above slow")
```

Run from the editor. The real `Length` and `Source` controls appear beside its output. Every plotted value is computed from the supplied bar sequence, not from a precomputed image.

## Working strategy

```text
strategy("Dual EMA", overlay=true)
fastLength = input.int(12, "Fast", minval=1, maxval=100)
slowLength = input.int(26, "Slow", minval=2, maxval=300)
fast = ta.ema(close, fastLength)
slow = ta.ema(close, slowLength)
plot(fast, "Fast", color.blue)
plot(slow, "Slow", color.orange)
if ta.crossover(fast, slow)
    strategy.entry("Long", strategy.long)
if ta.crossunder(fast, slow)
    strategy.entry("Short", strategy.short)
```

The interpreter returns entry/close commands; it does not directly place any order. Open **Advanced tester**, choose **Current script**, configure execution assumptions and run. Commands on the close of a raw bar first encounter the next raw bar's open. Strategy state is not fed back into the language: `strategy.position_size`, pyramiding and a complete entry-ID emulator are absent. `strategy.close(id)` emits a generic close command; the current tester has one net position, not independent named subpositions. `strategy.close_all()` also closes that position.

A strategy command may specify positive `qty=` or boolean `when=`. Without quantity, allocation follows tester settings. Stops/takes are configured in the tester, not through a complete Pine `strategy.exit` API.

## Syntax

Indent blocks with spaces. Tabs are rejected. `//` starts a comment outside strings. Parenthesized expressions may span lines.

```text
statement := assignment | expression | ifBlock | forBlock | scalarFunction
assignment := ["var"] ["float" | "int" | "bool" | "string" | "color"]
              identifier ("=" | ":=" | "+=" | "-=" | "*=" | "/=") expression
ifBlock := "if" expression NEWLINE INDENT statements
           ["else if" expression ...] ["else" NEWLINE INDENT statements]
forBlock := "for" identifier "=" expression "to" expression
            NEWLINE INDENT statements
scalarFunction := identifier "(" identifiers ")" "=>" expression
```

Types in declarations are accepted syntax, not a full static type system. There are finite numeric/string/boolean values and missing numeric values represented by `na`/NaN. Operations follow the explicitly implemented scalar semantics; no compatibility with every Pine coercion is claimed. Ternary `condition ? yes : no`, arithmetic, comparisons, `and`, `or`, `not`, and nonnegative series history `x[n]` are supported. Division by zero produces NaN. `na(x)` and `nz(x, replacement)` handle missing values.

A normal assignment writes the current bar's series value. `var` initializes once, at its first actual execution, and carries its value into later bars. Reassignment changes the current value. Example:

```text
indicator("Cumulative close change", overlay=false)
var float total = 0
total := nz(total[1]) + nz(ta.change(close))
plot(total, "Accumulated close change", color.teal)
```

A pure scalar function has one expression and cannot contain history or stateful series calls. Compute histories and TA at global scope, then pass current scalar values into the function:

```text
square(x) => x * x
indicator("Squared move", overlay=false)
move = ta.change(close)
plot(square(move), "Squared move", color.purple)
```

`for` iterates inclusively over bounded integer endpoints, ascending or descending. Stateful TA, input, plot, strategy and security calls inside scalar functions/loops are rejected at compilation. The language does not try to fake independent state for repeated call sites. Recursion is bounded by call depth; there are no unbounded while loops.

## Built-in values

| Group | Values |
|---|---|
| Raw bar | `open`, `high`, `low`, `close`, `volume`, `hl2`, `hlc3`, `ohlc4` |
| Time/index | `time` in UTC milliseconds; zero-based `bar_index` |
| Bar state | `barstate.isconfirmed`, `barstate.isfirst`, `barstate.islast` |
| Metadata | `syminfo.tickerid`, `syminfo.ticker`, `syminfo.mintick`, `timeframe.period` |
| Strategy | `strategy.long` = 1; `strategy.short` = -1 |
| Missing / booleans | `na`, `true`, `false` |

Metadata comes from execution options, not a hidden global feed. `barstate.isconfirmed` is the inverse of a bar's `partial` flag. The interpreter recomputes a supplied sequence; it does not implement Pine realtime rollback or persistent exchange tick callbacks.

## Function inventory

Declaration: `indicator(title, overlay=...)`, `strategy(title, overlay=...)`. Accepted metadata keywords include `title`, `shorttitle`, `overlay`.

Inputs: `input.int`, `input.float`, `input.bool`, `input.string`, `input.source`; supported metadata `defval`, `title`, `minval`, `maxval`, `step`. Source selection is one of open/high/low/close/volume. Inputs are keyed by their title; use unique titles. Numeric and boolean values are validated; string inputs remain strings.

TA functions currently require **positional arguments**:

| Signatures | Semantics |
|---|---|
| `ta.sma(source, length)`, `ta.ema(source, length)`, `ta.rma(source, length)`, `ta.wma(source, length)` | Moving averages; recursive averages require constant length and seed from a complete initial window. |
| `ta.rsi(source, length)`, `ta.atr(length)` | Wilder-style smoothing; NaN warm-up. |
| `ta.highest(source, length)`, `ta.lowest(source, length)`, `ta.sum(source, length)` | Finite rolling window. |
| `ta.stdev(source, length)` | Population standard deviation, not sample deviation. |
| `ta.linreg(source, length)` | Fitted endpoint at current window; no offset argument. |
| `ta.change(source, n=1)`, `ta.mom(source, n=1)`, `ta.roc(source, n=1)` | Difference or percentage rate of change. |
| `ta.crossover(a,b)`, `ta.crossunder(a,b)`, `ta.cross(a,b)` | Current/previous-bar comparisons. |
| `ta.cum(source)`, `ta.barssince(condition)` | Sequential cumulative sum / elapsed bars. |
| `ta.valuewhen(condition, source, occurrence)` | Bounded backward search, zero-based occurrence. |

The 33 built-in workspace studies are a separate registry. Their names do not all become script `ta.*` functions. A script requesting an unsupported function receives a diagnostic.

Math: `math.abs`, `sqrt`, `log`, `log10`, `exp`, `pow`, `min`, `max`, `round`, `floor`, `ceil`, `sign`, `sin`, `cos`. Conversion: `float`, `int`, `bool`, `str.tostring`. Missing-value helpers: `na`, `nz`. Colors: named `color.*` constants and `color.new(color, transparencyPercent)`.

Output: `plot`, `hline`, `plotshape`, `fill`, `barcolor`, `bgcolor`, `alertcondition`. Plot title/color/linewidth/style/location are interpreted by this implementation. Nonzero plot offsets are rejected. Accepted plot style names are line/histogram/columns/circles; shape behavior is simpler than Pine's complete styling/text catalogue. `fill` links the IDs returned by two plot calls. Alert output is a per-bar condition array; **Rule alerts** can reference it while the browser app is running. The server monitor does not execute scripts.

## Explicit higher-timeframe data

```text
indicator("Known closed daily EMA", overlay=true)
daily = request.security("BTC-USD", "D", ta.ema(close, 20))
plot(daily, "Closed daily EMA", color.orange)
```

Provide a research universe entry with the key `BTC-USD`, `interval: 86400` and enough raw daily bars; the UI passes it as `datasets["BTC-USD:86400"]`. Direct module usage is:

```js
import { runScript } from './src/script.js';
const result = runScript(source, hourlyBars, {
  symbol: 'BTC-USD',
  interval: 3600,
  datasets: { 'BTC-USD:86400': { bars: dailyBars, interval: 86400 } },
  inputs: {}
});
```

Bare numeric timeframe strings mean minutes; `S`, `D`, `W` suffixes mean seconds/days/weeks. Calendar months, lower timeframes, nested requests, lookahead overrides and alternative gaps policies are rejected. Values are carried forward only after the requested source bar has closed. The remote expression must be self-contained: it cannot reference caller-local variables/functions or trigger network loading.

## Budgets and trust boundary

| Resource | Limit |
|---|---:|
| Source | 100,000 characters |
| Expression AST | 5,000 nodes |
| Source bars | 250,000 |
| AST nodes × bars | 24,000,000 |
| Default operation budget | 20,000,000 |
| Variables | 256 |
| Plot records | 64 |
| History / study length | 10,000 bars |
| Function call depth | 64 |
| One for loop | 1,001 integer iterations |
| `valuewhen` occurrence | 0–1,000 |
| Advanced worker wall timeout | 30 seconds |
| Synchronous fallback source bars | 10,000 |

Worker timeout/cancel terminates that worker. The synchronous fallback has no preemptive wall-clock cancellation, so operation budgets are especially important. These guards are implementation safeguards, not a formal security proof or a promise that hostile inputs cannot consume noticeable CPU/memory. Avoid running untrusted scripts on a shared high-value origin.

There is no arbitrary JavaScript evaluation, DOM/network access, executable import, prototype traversal or general object reflection. Full Pine arrays/maps/tuples/UDTs/methods/libraries, every builtin, logs/profiler, full realtime execution, tick bar magnification and comprehensive order semantics remain outside this release. Pine's own execution model is documented separately at https://www.tradingview.com/pine-script-docs/language/execution-model/.
