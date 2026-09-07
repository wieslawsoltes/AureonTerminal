# Data providers, schemas and provenance

## Public crypto path

The default client requests Coinbase Exchange USD products, candle history, current ticker/heartbeat and observed trades. The order-flow extension independently subscribes to public `level2_batch` plus match observations. Source code is in `src/data.js`, `src/orderflow.js` and `server/providers.mjs`.

Candle REST data is normalized from provider order into `{t,o,h,l,c,v}`. Supported native intervals are selected by the adapter; four-hour/week views aggregate supported lower intervals. History pagination merges and deduplicates by bucket time. Cache and data-mode labels distinguish a successful live connection, cached history, imported data and deterministic synthetic demonstration. A historical dataset can be real observations without being a current executable quote.

L2 updates are absolute quantities at price levels; a zero deletes the level. A valid snapshot is required before updates are trusted. Coinbase match `side` represents maker side, so aggressor classification inverts it. No order book or footprint is invented when disconnected. A reconnect resets depth until a fresh snapshot, and observed trade analytics do not pretend to include missed history.

Official contract references:

- https://docs.cdp.coinbase.com/exchange/reference/exchangerestapi_getproductcandles
- https://docs.cdp.coinbase.com/exchange/websocket-feed/channels

Provider access, browser CORS, network availability, data rights and rate limits remain external constraints. This release's provider tests use fixtures; they do not establish current live availability in the user's region.

## Optional Alpaca paper and stock history

Credentials are server environment variables only. Order/account/cancel calls use the fixed `https://paper-api.alpaca.markets` destination. Historical stock bars use the fixed `https://data.alpaca.markets` host. There is no configurable arbitrary URL and no real-money order host in the adapter.

The configured broker owner must exist when the process starts. Bootstrap locally without credentials, register that owner, stop the process, then restart with the paper credentials and `AUREON_BROKER_USER`. Other users cannot control the paper account. The browser asks for explicit confirmation before an external paper order.

Stock history is requested with raw adjustment semantics. The configured feed defaults to `iex`; account entitlements determine which feeds are actually allowed. Pagination is bounded to five pages of up to 10,000 records each; truncation is reported instead of silently implying complete history. No continuous stock WebSocket adapter, split/dividend adjustment engine, corporate-action ledger, options chain or guaranteed all-symbol entitlement is supplied.

The paper order validator exposes a bounded subset of the provider's order schema. External paper behavior is governed by the provider, not Aureon's local `SimulationBroker`. Test fixtures assert host, headers, payload validation, ownership and cancellation; no real credentials or authenticated provider session were used.

References:

- https://docs.alpaca.markets/us/docs/paper-trading
- https://docs.alpaca.markets/us/reference/stockbars

## CSV and portable workspace data

CSV import accepts the application's documented/exported OHLCV structure and validates finite numbers, time and OHLC bounds. Export and reimport preserve the active raw market dataset; chart transform bricks are not substituted for market candles.

Portable workspace JSON contains an application/version envelope, a validated base workspace, version-2 extensions, and optional selected raw history with source/symbol/interval metadata. A selected dataset's symbol and interval must match the workspace. At most 100,000 raw bars are accepted in that portable-history field. Saved layout presets omit raw history. Credentials and local execution accounts are not portable workspace fields.

An import's source field is an assertion supplied by its author. Aureon displays it but cannot verify that it came from an exchange. Never treat imported/demonstration prices as an executable brokerage quote.

## Research schema v1

Research is an **imported dataset**, not a secretly connected newswire or financial database. The package contains `examples/research-fixture.json` with visibly fictional metadata and deterministic test prices.

```json
{
  "version": 1,
  "source": "My licensed research export",
  "universe": [
    {
      "symbol": "EXAMPLE-USD",
      "interval": 3600,
      "source": "Explicit source identifier",
      "bars": [{"t":1704067200,"o":100,"h":105,"l":98,"c":103,"v":120}]
    }
  ],
  "events": [
    {
      "id": "example-event",
      "time": 1704153600,
      "title": "Fictional event for schema illustration",
      "kind": "economic",
      "country": "EXAMPLE",
      "symbol": "EXAMPLE-USD",
      "impact": "low",
      "actual": null,
      "forecast": "Example only",
      "previous": null
    }
  ],
  "fundamentals": [
    {
      "symbol": "EXAMPLE-USD",
      "period": "Fictional 2024 example",
      "currency": "USD",
      "metrics": {"Revenue":1000000,"EPS":1.25}
    }
  ],
  "news": [
    {
      "time": 1704153600,
      "title": "Fictional sample headline, not market news",
      "source": "Schema example",
      "summary": "Replace with research you have permission to use.",
      "url": "",
      "symbols": ["EXAMPLE-USD"]
    }
  ]
}
```

Use **Research → Import research**. Universe bars then supply the screener and explicit script higher-timeframe requests. Event/news/fundamental tables render their supplied records. News content is escaped; only valid HTTP/HTTPS schemes become links. Events use UTC seconds. Numeric fundamental values must be finite; the application does not infer missing currency conversions, units or accounting definitions.

Limits: 100 universe entries, 500,000 total universe bars, and 10,000 entries per event/fundamental/news collection. Titles and other strings have bounded lengths. Duplicate symbol/interval universe entries should be avoided: script dataset indexing uses one value per key, so later entries replace earlier ones there.

## Analytical interpretation

Screener price changes are calculated from loaded bar windows. A one-bar percentage change on hourly data is not a provider's 24-hour statistic. Heatmap area is computed turnover, not necessarily market capitalization. Monthly seasonality reflects only loaded observations and partial months may be incomplete. Research is not corrected for survivorship bias or corporate actions.

OHLC volume profile and TPO are explicitly approximate. Observed footprint/CVD and tick profiles are exact aggregations of accepted observations, not a proof those observations cover all trades. Spread high/low envelopes do not imply the corresponding leg prices were simultaneous or tradable.

The data and execution engines compute results under those assumptions. They do not provide trading recommendations, profit guarantees, complete exchange coverage or a substitute for authoritative exchange/broker records.
