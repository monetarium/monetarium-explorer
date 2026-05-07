# Page Registry — Monetarium Adjustment Surface

Inventory of every HTML page the explorer serves, used as the working checklist when adjusting the codebase to Monetarium (multi-coin VAR + SKA{n} model, copy/branding, removed Decred-specific features).

Routes are registered in [cmd/dcrdata/main.go](../../cmd/dcrdata/main.go) (`webMux` group around lines 692–820). Handlers live in [cmd/dcrdata/internal/explorer/explorerroutes.go](../../cmd/dcrdata/internal/explorer/explorerroutes.go) unless noted.

Non-page endpoints (WebSockets, JSON APIs under `/api` and `/insight/api`, `/download/*`, static assets) are intentionally excluded — this list is scoped to user-facing HTML only.

> Per-page specs (when they exist) live under `wiki/specs/`. Code-grounded data-flow traces live under `wiki/code-analysis/`. Consult `wiki/index.md` for the current catalog before editing a page.

---

## Active pages

| URL | Handler | Description |
|---|---|---|
| `/` | `Home` | Landing dashboard: header metrics (height, supply, hashrate, ticket info), latest blocks, mempool snapshot, multi-coin supply card. |
| `/visualblocks` | `VisualBlocks` | Visual grid of recent blocks rendered as colored tiles by tx type/size — alternative to the table view. |
| `/blocks` | `Blocks` | Paginated table of recent blocks (height, time, size, tx counts, voters, fees). |
| `/block/{blockhash}` | `Block` (with `BlockHashPathOrIndexCtx`) | Block details: header, votes/tickets/regular tx tables, navigation to neighbor blocks. Accepts either a block hash or a height in `{blockhash}`. |
| `/side` | `SideChains` | List of side-chain (orphaned) blocks the node has seen. |
| `/disapproved` | `DisapprovedBlocks` | List of blocks disapproved by the next block's stake voters (their regular tx were invalidated). |
| `/days` | `DayBlocksListing` | Blocks aggregated by day (count, total fees, per-period summary). |
| `/weeks` | `WeekBlocksListing` | Blocks aggregated by week. |
| `/months` | `MonthBlocksListing` | Blocks aggregated by month. |
| `/years` | `YearBlocksListing` | Blocks aggregated by year. |
| `/mempool` | `Mempool` | Unconfirmed transactions split by coin (VAR + SKA{n}) and by tx type, with totals and per-coin tables. |
| `/tx/{txid}` | `TxPage` | Transaction details: inputs, outputs, fees, confirmations, block link. Single-coin per tx (VAR or one SKA{n}); fee paid in same coin. |
| `/tx/{txid}/{inout}/{inoutid}` | `TxPage` (scrolled to a specific input/output) | Same view as `/tx/{txid}` but anchored to a specific `in` or `out` index. |
| `/address/{address}` | `AddressPage` | Address overview: balance, sent/received totals, paginated tx table, chart selectors (kind, zoom, group-by). URL state is the source of truth for chart settings. |
| `/addresstable/{address}` | `AddressTable` (AJAX fragment) | Server-rendered HTML fragment for the address tx table — used by the address page for pagination/filtering without a full reload. |
| `/decodetx` | `DecodeTxPage` | Form that decodes a raw transaction hex string into structured input/output details without broadcasting. |
| `/search` | `Search` | Dispatcher that inspects the query and redirects to the matching page (block hash, height, tx hash, or address). Renders an error page on no match. |
| `/charts` | `Charts` | Historical charts (supply, hashrate, fees, block size, ticket metrics, etc.) including the per-coin SKA `coin-supply/{N}` pipeline. |
| `/market` | `MarketPage` | Exchange / market data aggregated from the `exchanges` package (price, volume, depth where available). |
| `/parameters` | `ParametersPage` | Static-ish chain parameters: subsidy schedule, ticket parameters, network constants, consensus rules. |
| `/ticketpool` | `Ticketpool` | Live ticket pool view: distribution by price, age, and other dimensions. |
| `/ticketpricewindows` | `StakeDiffWindows` | Stake-difficulty (ticket-price) windows — past windows plus the in-progress one with projected next price. |
| `/attack-cost` | `AttackCost` | 51%-style attack-cost calculator using current hashrate, ticket price, and supply numbers. |
| `/verify-message` | `VerifyMessagePage` (GET) / `VerifyMessageHandler` (POST) | Form that verifies an address+message+signature triple is valid. POST is rate-limited via tollbooth. |
| `/insight` | `InsightRootPage` (static assets also mirrored under `/insight/*`) | Landing page for the Insight-compatible JSON API; documents `/insight/api/...` endpoints. |

---

## Disabled (return HTTP 410 Gone)

Wired but intentionally off in this fork. No Monetarium adjustment required unless we decide to re-enable them. Source: [main.go](../../cmd/dcrdata/main.go) lines 770–809.

| URL | Status | Description |
|---|---|---|
| `/treasury` | 410 — "treasury not available" | Decred treasury account balance and history page; Monetarium has no treasury. |
| `/treasurytable` | 410 — same | AJAX fragment for the treasury tx table. |
| `/agendas` | 410 — "agendas not available" | Consensus deployment vote agendas list; Monetarium does not run on-chain consensus voting. |
| `/agenda/{agendaid}` | 410 — same | Single-agenda details (timeline, threshold, vote counts). |
| `/proposals` | 410 — "proposals not available" | Politeia governance proposals list; not used in Monetarium. |
| `/proposal/{proposaltoken}` | 410 — same | Single Politeia proposal details. |

---

## Redirects

Permanent redirects — no template content of their own, but they target pages on the active list above.

| URL | Target |
|---|---|
| `/rejects` | `/disapproved` |
| `/stats` | `/` |
| `/explorer/` (legacy mount) | `/blocks` |
| `/explorer/block/{x}` | `/block/{x}` |
| `/explorer/tx/{x}` | `/tx/{x}` |
| `/explorer/address/{x}` | `/address/{x}` |
| `/explorer/decodetx` | `/decodetx` |

---

## What "adjusted to Monetarium" means

A page is considered adjusted when:

- Branding/copy refers to Monetarium (not Decred), and `dcrdata` only appears in load-bearing identifiers per CLAUDE.md.
- Multi-coin reality is honored: per-coin VAR + SKA{n} maps where the original carried a single value; SKA values stay as `big.Int`-derived strings end-to-end (no `float64` conversion before the template boundary).
- Features that don't exist on Monetarium (treasury, agendas, proposals) are not surfaced via UI links.
