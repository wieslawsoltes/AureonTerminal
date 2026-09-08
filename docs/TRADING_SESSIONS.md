# Explicit trading sessions and closed-bar research

Open **Pro tools → Trading sessions**. Select a schedule template or import a
calendar JSON file, edit its rules, set a target candle interval, and press
**Apply calendar & analyze**. The work runs in an independently cancellable
worker. Source data, chart style, account positions and executable quotes are not
modified. Reports and overlays describe a captured, closed-bar snapshot.

## Calendar contract

```json
{
  "version": 1,
  "name": "My New York schedule — explicit closures",
  "timezone": "America/New_York",
  "weekdays": [1, 2, 3, 4, 5],
  "segments": [{"open": "09:30", "close": "16:00"}],
  "holidays": ["2024-07-04"],
  "overrides": {"2024-07-03": [{"open": "09:30", "close": "13:00"}]},
  "tradeDateOffset": 0,
  "disambiguation": "reject"
}
```

These example exceptions are explicit user-supplied inputs, **not an exhaustive
holiday calendar**. No timezone or asset-class inference selects a calendar.

Weekdays use Sunday=0 through Saturday=6. Weekdays, holidays and override keys
refer to the **local session start date**, even for overnight schedules. A date
override replaces the entire schedule for that date, including on a weekend;
`[]` closes it. A holiday cannot also have an override. `tradeDateOffset: 1`
labels an overnight session with the next local date without changing which
start-date rules select it.

A close at or before the open defaults to the next local day. A close of `24:00`
means next civil midnight. For split overnight sessions, explicitly specify
`openDay: 1` on the second-day segment. Optional `openDay` and `closeDay` are 0 or
1. Segments must be ordered, disjoint, and span at most 24 civil hours from the
first open. Adjacent-day overrides that overlap in actual UTC are rejected.

```json
{
  "name": "Overnight split example — not an exchange calendar",
  "timezone": "America/Chicago",
  "weekdays": [0, 1, 2, 3, 4],
  "tradeDateOffset": 1,
  "segments": [
    {"open": "18:00", "close": "23:00"},
    {"open": "01:00", "close": "17:00", "openDay": 1}
  ]
}
```

The New York template uses the published core-hours clock pattern, but ships
without holidays or market entitlement claims. Chicago/Tokyo templates are
illustrative schedules, **not maintained exchange product calendars**.

## Daylight saving and timezone rules

Boundaries resolve through the runtime's `Intl.DateTimeFormat` IANA rules using
explicit Gregorian calendar, Latin digits and the h23 hour cycle. Candidate UTC
offsets are sampled within 36 hours on either side and exact local-date/time
round trips select valid instants. Missing local times always reject; they are
never silently shifted. Repeated times reject unless `disambiguation` is set to
`earlier` or `later`. The same explicit fold policy applies to all boundaries.

Continuous local-midnight sessions can span 23 or 25 actual hours, or half-hour
changes in applicable zones. Bucket identity is UTC time; a repeated local hour
is not a duplicate. The engine supports civil years 1900–2200 and bounds a range
expansion to 3,660 local dates. Each calendar keeps at most 512 cached days;
formatter caching is bounded to 32 zones. The host timezone database is not
bundled or version-certified. JSON snapshots include resolved UTC windows so an
operator can inspect how that runtime interpreted the rules.

## Source acceptance and completeness

Supply ordered, nonoverlapping raw OHLCV, with UTC opening timestamps and an
explicit source interval (1–86,400 seconds). At most 200,000 bars are accepted by
the engine; workerless execution inherits the existing 10,000-bar UI limit.
Malformed OHLCV and derived display bars reject the job. A valid source candle
must have closed at or before the cutoff, not be provisional, start on the
segment's source-interval grid, and fit wholly inside that segment. Rejections
are counted separately as future, partial, outside, boundary or misaligned.

A target interval must be an integer multiple of the source interval and no
larger than 86,400 seconds. Buckets reset at **each segment open**, including
after a break. A shorter final bucket has an explicit `end`; it can be complete
when all its actual duration is covered. No candle is split, fabricated or
carried across a break. Empty buckets do not become zero-volume candles.

Coverage means observed accepted seconds / scheduled seconds. `complete` requires
full coverage and a close not later than the cutoff. This establishes internal
coverage of the **supplied source**, not completeness of exchange prints or
provider correctness. Reports identify entirely unobserved scheduled sessions.
Resampled exports include `end`, `knownAt`, `coverage`, `complete` and `partial`;
summary exports expose missing seconds and opening-range status. They are
research files, not an automatic import into the fixed-interval order engine.

## Causal overlays

Eight overlay plots are provided by one session-research result (not eight new
registry study types): session VWAP, upper/lower weighted-deviation bands,
confirmed opening high/low, and previous complete-session high/low/close.

VWAP weights each closed candle's `(H/3 + L/3 + C/3)` by its volume. A shifted,
weighted online variance avoids subtracting large squared price totals. Zero
weight is unknown; missing candles never acquire invented weight. VWAP resets
per session and continues across its intraday breaks. It is an OHLC-price model,
not tick-exact VWAP. Numeric overflow rejects instead of returning infinity.

Opening range covers at most the first segment. Its levels become visible only
after the opening window closes with full source coverage. A source candle
straddling the opening-range endpoint cannot be subdivided to invent its high
or low, so the range remains unconfirmed. Previous levels require full coverage
of the **immediately preceding scheduled session**; a wholly missing session
cannot be skipped to present older levels as yesterday's.

Each output sample depends only on earlier accepted data and that sample's closed
candle. Explicit break flags stop line connections across session/segment changes
and source gaps. The shared extrema-preserving line decimator now also preserves
NaN gaps inside a zoomed-out bucket without hiding finite endpoint values.

## UI persistence and lifecycle

Applied rules/settings survive normal workspace, named-layout and server snapshot
serialization. Imported files and template changes are drafts until applied.
Invalid rules cannot replace the accepted settings. Results are not persisted as
current research. A changed source identity/version, replay cutoff, symbol,
interval, provenance or applied settings invalidates the result and pending job.
An explicit cancellation terminates only the session worker. No background scans,
provider requests, alerts or order submission are started.

The UTC cutoff is bounded by the visible replay prefix. JSON/CSV export requires
an unchanged captured context. All calendar/source text is rendered literally;
CSV textual cells are formula-guarded. At most 50 rows render per report page.
Session shading and overlays affect only the primary chart for this release.
The old chart-options session shading remains available when research is cleared.

## References

- ECMA-402 DateTimeFormat and formatToParts: https://tc39.es/ecma402/2025/
- Core-hours clock pattern: https://www.nyse.com/trade/hours-calendars

Calendars, closures, halts and sessions vary by product and venue. An external
reference does not turn these templates into a licensed or maintained schedule
service. Intrabar auctions, unscheduled halts and provider-specific bar alignment
must be explicitly represented by suitable input; they are not inferred here.
