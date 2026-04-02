# Monetarium Explorer – Product Overview

Monetarium Explorer is a block explorer for the Monetarium blockchain, built on top of `dcrdata` (Decred block explorer). The dcrdata codebase was taken as a starting point (squashed into a single initial commit) and Monetarium-specific features are developed on top of it — there is no ongoing sync with the upstream dcrdata repo.

## Upstream base

Based on `dcrdata` v8 — the full inherited feature set (REST API, WebSocket pub-sub, mempool monitoring, etc.) is present as the foundation.

## Monetarium-specific extensions

- **Multi-token support:** One primary coin (VAR) and up to 255 SKA token types displayed alongside each other.
- **High-precision arithmetic:** SKA tokens require up to 15 integer digits and 18 decimal places — beyond native Go float64 range, so a specialized big-number module is used for all backend calculations.
- **Extended block list:** Home page block table expanded with per-token sections (VAR and SKA), including an interactive accordion to drill into per-SKA-type breakdowns.
- **Coin Supply widget:** Shows VAR circulating supply plus per-SKA issued/withdrawn/circulating figures.
- **Deferred sections:** Treasury and Exchange Rate sections are hidden until backend support is implemented.

## Token types

| Token | Integer digits | Decimal places |
| ----- | -------------- | -------------- |
| VAR   | 8              | 8              |
| SKA   | 15             | 18             |

## Runtime dependencies

- Monetarium node running with `--txindex`, synced to the network
- PostgreSQL 11+ as the primary data store
- Reverse proxy (e.g. nginx) recommended for production

## Default endpoint

`http://127.0.0.1:7777/`

## License

ISC
