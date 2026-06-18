# Knowledge Index

## 🧠 Core Architecture & Domain

_Human-curated rules, architecture, and constraints. Read these to understand the project._

- product: core/product.md — what are we building, token limits
- structure: core/structure.md — Go modules, folders boundaries
- tech-stack: core/tech-stack.md — packages, node engines
- cicd: core/cicd.md — CI/CD pipeline, automation and Docker distribution
- staking-rewards: core/staking-rewards.md — mechanics of pow and pos yields and fee splits
- constraints: core/constraints.md — cross-domain architectural constraints
- pages: core/pages.md — registry of all HTML pages
- maintenance: core/maintenance.md — guide for wiki upkeep and structure

## 📋 Feature Specifications

_Requirements and guidelines for specific features and pages._

- homepage-metrics: specs/homepage-metrics/spec.md — mempool, latest blocks, and supply component rules
- homepage-edits: specs/homepage-metrics/edits-spec.md — what should be edited and how on the homepage
- block-details: specs/block-details/spec.md — rendering rules for block details page
- blocks-list: specs/blocks-list/spec.md — rules for rendering list of blocks (block table on block list page)
- chart-ska-coin-supply: specs/chart-ska-coin-supply/spec.md — rendering and logic rules for SKA coin supply charts
- mempool-page: specs/mempool/spec.md — full multi-coin mempool page layout and logic
- address-overview: specs/address-overview/spec.md — cross-feature contract for `/address/{address}` (multi-coin model, `ActiveCoins`, `?coin=` URL contract, real-time scope)
- address-summary: specs/address-summary/spec.md — left-top card: per-coin Balance / Received / Spent, Unconfirmed, Stake %, fiat removal, empty state
- address-charts: specs/address-charts/spec.md — right-top card: chart coin selector, per-coin endpoints (`?coin=N`), Tx Type 5/2-series rule, BigInt balance accumulation
- address-transactions: specs/address-transactions/spec.md — bottom section: Coin column, coin filter, sstxcommitment gate, multi-coin CSV schema, server↔XHR parity
- parameters: specs/parameters/spec.md — `/parameters` page Monetarium adjustment: drop Treasury section + treasury-share row, keep Rule change as reference, show actual 50/50 PoW/PoS split, fix Decred address prefixes, add SKA coin parameters section
- attack-cost: specs/attack-cost/spec.md — `/attack-cost` page Monetarium adjustment: VAR-only domain (no SKA), `DCR`→`VAR` labels, manual-only exchange rate (no auto price), keep formula but drop Decred citation, replace hardcoded Decred miner list with manual hashrate/power/cost inputs
- market-removal: specs/market-removal/spec.md — `/market` page Monetarium removal: page made unavailable (like `/treasury`, `/proposals`), drop "Market" menu item and Home "Exchange Rate" card, remove USD equivalents on Home / `/tx` / `/address` / `/block`, turn off background exchange polling and the related service endpoints

## 🤖 Code Traces

_Code-grounded analysis of data flows, cross-layer dependencies, and hidden constraints. Paste these into your prompt when modifying specific areas._

### Block

_Data flow for block rendering, including headers, metrics, and block content parsing._

- flow (compact): code-analysis/block/flow.compact.md — high-level summary of the data path from node/DB to the block UI
- flow (full): code-analysis/block/flow.full.md — detailed, step-by-step function trace for deep debugging of block logic
- patterns: code-analysis/block/patterns.md — recurring architectural concepts and invariants to follow when modifying blocks
- impact: code-analysis/block/impact.md — downstream components and templates that break if block data structures change
- defect (ska-stake-fee): code-analysis/block/ska-stake-fee.md — fixed-incident postmortem: SKA SSFee rows showed `0` in the block "Stake Fees" table; net-reward `FeeRaw` math, coin-type-from-first-SKA-output, "Fee"→"Rewards" header (#301). Same defect later fixed on the tx-detail page (#485/#486). Note: SKA SSFee is dormant (SKA staking not planned) — VAR SSFee is the only real case.

### Transaction

_End-to-end pipeline for transaction processing, decoding, and rendering inputs/outputs._

- flow (compact): code-analysis/transaction/flow.compact.md — high-level summary of how transaction inputs and outputs are processed
- flow (full): code-analysis/transaction/flow.full.md — detailed, step-by-step function trace for deep debugging of tx logic
- patterns: code-analysis/transaction/patterns.md — recurring architectural concepts and invariants to follow when modifying transactions
- impact: code-analysis/transaction/impact.md — downstream components and templates that break if tx data structures change

### Address

_Address page rendering: paginated transaction table, chart endpoints, CSV download, **multi-coin end-to-end** (`?coin=` via `CoinCtx` middleware; filter-before-paginate; confirmed-only balance), per-coin summary card + Coin column, TurboQuery-driven URL state, and per-coin stake metrics. `utxoStore.set()` now carries `SKAValue` (fixes SKA amount-flow sent=0). `flowVisibility(bitmap)` atomic chart-series toggle. Paginator stable 20/40/80/160. Revised at `HEAD=a48ea0e1`._

- flow (compact): code-analysis/address/flow.compact.md — current data path, `?coin=` contract, filter-before-paginate + confirmed-only-balance invariants, `utxoStore` SKA fix, and delta tables vs. both prior revisions
- flow (full): code-analysis/address/flow.full.md — current function trace: coin-filtered `AddressHistory`, `utxoStore.set()` SKA fix, per-coin `retrieveAddressBalance` stake ratios, rewritten mempool overlay, merged-view LIMIT-0 fix, per-coin templates, coin-aware controller (chartTitle DOM, flowVisibility, paginator cleanup), chart serialization
- patterns: code-analysis/address/patterns.md — `CoinCtx` URL contract (backend + frontend), coin-aware aggregation (3 pipelines), per-coin caching, SKA decimal-string pipeline, dual VAR/SKA SUM, stake metrics (multi-coin code; VAR-only in practice), legacy flat-field shim (residual), TurboQuery URL ownership, `flowVisibility` atomic chart-series visibility
- impact: code-analysis/address/impact.md — blast radius: `utxoStore.set()` SKA pass-through, coin-filter signature fan-out (+4 mocks), `CoinTypeAll=255` dual semantics, SKA-through-VAR precision (PR #263 class), coin-keyed cache staleness, `?coin=` server/client desync, legacy flat-field shim removal, CSV `value`→`amount` schema break

### Windows

_Ticket price window intervals: server-rendered `/ticketpricewindows` page; SQL-side integer-division bucketing of mainchain blocks into stake-difficulty windows; multi-coin `coin_tx_stats` JSONB reconciliation; shared `BlocksGroupedInfo` struct with time-based-blocks. Revised at `HEAD=3cdba1e7`._

- flow (compact): code-analysis/windows/flow.compact.md — one-line flow, key patterns, constraints, and a copy-pasteable mutation checklist for `/ticketpricewindows`
- flow (full): code-analysis/windows/flow.full.md — strict 1–10 trace from `blocks` table → SQL aggregation → `BlocksGroupedInfo` → `PosIntervals` → `StakeDiffWindows` handler → `windows.tmpl`, with all current file:line refs
- patterns: code-analysis/windows/patterns.md — ticket-price-window reusable behavior: Postgres integer-division GROUP BY grouping, mainchain-only filter, shared dbtypes.BlocksGroupedInfo pass-through, multi-coin coin_tx_stats reconciliation
- impact: code-analysis/windows/impact.md — windows mutation blast radius: StakeDiffWindowSize/SQL-denominator desync, cross-domain BlocksGroupedInfo field changes, coin_tx_stats Scan mismatch, TicketPrice template-boundary type, pagination drift

### Time-Based Blocks

_Aggregation and grouping of blocks over specific time intervals (days, weeks, months, years)._

- flow (compact): code-analysis/time-based-blocks/flow.compact.md — high-level summary of how blocks are grouped by time periods
- flow (full): code-analysis/time-based-blocks/flow.full.md — detailed, step-by-step function trace for deep debugging of time aggregations
- patterns: code-analysis/time-based-blocks/patterns.md — SQL date_trunc UTC aggregation, shared BlocksGroupedInfo struct (windows coupling), controller-level YTD mutation, genesis-anchored pagination, handler-level year fallback
- impact: code-analysis/time-based-blocks/impact.md — UTC cast divergence, positional rows.Scan desync, cross-domain struct breakage, YTD mislabel, fallback removal, hard DB-timeout blanking

### Mempool

_Multi-coin aggregation (CoinStats + derived CoinFills), dual collection paths (batch ParseTxns at block boundary vs. incremental addTxToCoinStats per tx), multi-saver fan-out, dual-transport WS delivery, and live indicator rendering._

- flow (compact): code-analysis/mempool/flow.compact.md — high-level summary of mempool state aggregation, fan-out, and WS delivery
- flow (full): code-analysis/mempool/flow.full.md — detailed, step-by-step function trace covering monitor/collector, savers, CoinFills derivation, WS encoders, templates, and JS controller
- patterns: code-analysis/mempool/patterns.md — batch+incremental aggregation, multi-saver fan-out, dual-transport WS, atom-string arithmetic, derived-view dual write, inventory locking, rAF indicator batching
- impact: code-analysis/mempool/impact.md — precision, dual collection-path divergence (CoinStats + per-tx fees), CoinFills recompute gap, saver nil-guard, DeepCopy/Trim omissions, WS schema drift, Go↔JS drift, lock-order inversion

### Charts

_Historical data fetching, cache aggregation, and payload serialization for UI charts. Covers the legacy VAR `coin-supply` pipeline alongside the per-coin SKA `coin-supply/{N}` pipeline (lazy load, `*big.Int` cumulation, exact-precision legend)._

- flow (compact): code-analysis/charts/flow.compact.md — high-level summary of both VAR and SKA chart pipelines
- flow (full): code-analysis/charts/flow.full.md — detailed, step-by-step function trace covering RPC/SQL → cache → API → controller → Dygraphs for both pipelines
- patterns: code-analysis/charts/patterns.md — reusable architecture: dual VAR/SKA coin-supply pipelines under one chart-ID namespace, string-precision SKA path, uint8↔string ID coupling, contractual `h` height field, cache-write asymmetry, lockless first-load, TurboQuery+Zoom projection
- impact: code-analysis/charts/impact.md — mutation blast radius: `accumulate`/`uint64` misuse on SKA, legend `float64` precision loss, missing `h` on time-axis, `coinType==0` loader path, concurrent first-load race, `coin-supply`/`coin-supply/0` endpoint duality, `DataSource` mock fan-out, `ActiveSKATypes` dropdown drift

### VisualBlocks

_The `/visualblocks` page: latest-N blocks plus mempool rendered as 3-row tiles (votes / tickets / indicator-fill bars). Dual pipeline (HTTP `TrimmedBlockInfo` vs WebSocket full `BlockInfo` shallow-copy + 5-field patch). **Revised at `HEAD=38636d52` (post visualblocks UI rewrite for #270 on top of PR #284 data contract)**: legacy rewards row and per-tx transactions row deleted (rewards are 50/50 fixed, no Project Fund); header shows block/mempool size with optional `% of maxBlockSize`; vote row carries three states (`vote-yes` / `vote-no` / `vote-skip`) driven by `(Voted, VoteValid)`; transactions row replaced by an indicator-fill block (TOTAL + VAR + SKAn bars) that reuses the homepage `_indicator-fill.scss` partial as-is; `TrimmedBlockInfo` gained `TotalFillRatio` and the WS shallow-copy patch now covers five fields (`coin_fills`, `active_ska_count`, `max_block_size`, `regular_coin_counts`, `total_fill_ratio`); JS controller exports `normaliseWsBlock` / `normaliseMempool` / `normaliseTxs` to reconcile the BlockBasic-lowercase / BlockInfo-PascalCase / contract-snake-case JSON-tag mix in one place; new template helpers (`formatBytes`, `regularCountForSymbol`, `mempoolRegularCountForSymbol`, `sumRegularCoinCounts`, `sumMempoolRegularCounts`) pinned by 13 vitest assertions in `visualBlocks_controller.test.js`; `pubsub/ps:sigNewBlock` still NOT patched (known divergence); the JS-side coinbase filter is gone (no per-tx rendering)._

- flow (compact): code-analysis/visualblocks/flow.compact.md — current data path, 5-field contract patch sequence, three-row tile structure, mutation checklist
- flow (full): code-analysis/visualblocks/flow.full.md — detailed function trace covering handler, DB memo, `(*BlockInfo).Trim` (extended with `TotalFillRatio`), WS shallow-copy + 5-field patch, pubsub divergence, contract test, template + helpers, JS controller (normalisers + tile builders), SCSS overrides, vitest pin
- patterns: code-analysis/visualblocks/patterns.md — cross-pipeline tile rendering, **wire-shape normalisation (BlockBasic lowercase + BlockInfo PascalCase + contract snake-case)**, **three-state vote rendering**, **indicator-fill component reuse from homepage**, cross-transport contract via WS shallow-copy + Trim patch (5 fields), memoized BlockInfo, Trim methods on the types package, lock order, **template helper / JS helper symmetry**, **Subsidy struct asymmetry retired on this page**, **vitest DOM-shape pin**
- impact: code-analysis/visualblocks/impact.md — mutation impact across template + helpers + JS controller + normalisers + SCSS + indicator-fill partial + HTTP/WS/DB/pubsub layers, refreshed 5-field safe-change checklist, `/ps` divergence as known gap, loud and silent failure modes (incl. WS-shape regression)

### Attack-Cost

_The `/attack-cost` majority-attack calculator: a no-compute Go handler reads a shared VAR-only `HomeInfo` snapshot into `data-*` attributes; all PoW/PoS math runs client-side in `attackcost_controller.js`. VAR-only by construction (legacy flat `CoinSupply`/`DCR` labels); not portable to SKA without a BigInt rewrite._

- flow (compact): code-analysis/attack-cost/flow.compact.md — high-level summary of the no-compute handler, VAR-only snapshot, untyped Go→JS contract, and client-side math
- flow (full): code-analysis/attack-cost/flow.full.md — detailed trace: node→Store→HomeInfo→handler→template→Stimulus, exchange-bot price-zero trap, snapshot staleness, SKA precision boundary
- patterns: code-analysis/attack-cost/patterns.md — no-compute handler, VAR-only legacy snapshot, untyped `data-*`↔Stimulus contract, vendored-Dygraphs private override
- impact: code-analysis/attack-cost/impact.md — SKA-through-VAR-pipeline corruption, shared `HomeInfo` blast radius, silently-zero exchange price, stale snapshot, Go→JS drift; mostly silent failure modes

### Parameters

_The `/parameters` page: active-network consensus config. Mostly static `chaincfg.Params` captured once at startup; dynamic parts are `MaximumBlockSize` (tip-only RPC `GetBlockChainInfo`) and — for non-initial SKA coins — the runtime-derived `Active` / `Pending` status sourced from on-chain emission state (`SKACoinSupply` + `SKACoinEmissionHeight`, gated by `CoinbaseMaturity`). Dual param injection (`commonData.ChainParams` + handler `ExtendedParams`), block-scoped ETag cache, VAR-only subsidy rows._

- flow (compact): code-analysis/parameters/flow.compact.md — high-level summary of the static-vs-dynamic split, dual injection, and silent/hard failure modes
- flow (full): code-analysis/parameters/flow.full.md — detailed, step-by-step trace from node config/RPC → pageData → handler → template, with cross-layer deps and mutation impact
- patterns: code-analysis/parameters/patterns.md — near-static chaincfg.Params page: dual-source commonData/ExtendedParams split, hardcoded network-name prefix table, VAR-only subsidy rows, unchecked MaximumBlockSizes[0] fallback
- impact: code-analysis/parameters/impact.md — commonData nil → .ChainParams deref crash, silent blank/misaligned address-prefix table on unknown network, stale/empty-slice MaximumBlockSize, unlocked pageData.BlockchainInfo race

### Agendas — LIVE (enabled in PR #395)

_The `/agendas` + `/agenda/{id}` consensus-deployment voting pages — **live** (enabled in PR #395, commit `6622b4ae`; routes at [cmd/dcrdata/main.go:780-781](../cmd/dcrdata/main.go#L780-L781), navbar link at [views/extras.tmpl:84](../cmd/dcrdata/views/extras.tmpl#L84)). They had been route-stubbed to HTTP 410 during migration (`52ea3cf1`) but never removed — handlers, JSON API (`/api/agendas`, `/api/agenda/{id}`), and the DB pipeline (`agenda_votes` populated by `insertVotes` during `StoreBlock`) were intact, so re-enabling was a two-line route revert. Dual-source data: live metadata/progress from node RPC (`gov/agendas.AgendaDB` BoltDB + `VoteTracker`), historical tallies from Postgres. **Coin-agnostic** — vote counts/percentages/heights only, no VAR/SKA amounts, so C1/C3/C7 do not apply and **no multi-coin adaptation is needed**. One re-enable bug fixed in PR #395: a nil DB vote-summary panic on not-yet-started agendas (`43a27ce2`, guarded + regression-tested). The list surfaces hide pre-Monetarium agendas: `AllAgendas` filters vote version `>= 11` (`MinVoteVersion`), so Decred-era versions 1–10 never appear in the `/agendas` table or `/api/agendas` JSON (issue #400). The `/agendas` page renders agendas twice — the table from `AllAgendas` and the live cards from `voteTracker.Summary().Agendas` — so `AgendasPage` cross-filters the cards to the table's ID set (PR #401); the source filter alone does not reach them._

- flow (compact): code-analysis/agendas/flow.compact.md — live status (PR #395), dual-source flow, why no multi-coin work is needed, vote-version `>= 11` list filter (issue #400), not-yet-started nil-summary guard, maintenance checklist
- flow (full): code-analysis/agendas/flow.full.md — end-to-end trace: node RPC → gov/agendas (BoltDB + VoteTracker) + db/dcrpg agenda_votes → handlers → templates → JS; PR #395 re-enable + nil-summary guard; `MinVoteVersion` list filter (issue #400); node-support evidence; silent/hard failures
- patterns: code-analysis/agendas/patterns.md — dual-source governance data (RPC-live + Postgres-historical), coin-agnostic feature (precision rules N/A), single-source list filter (one `AllAgendas` gate feeds /agendas table + /api/agendas — but the sibling tracker-sourced summary cards drift and need a separate handler cross-filter), dormant-feature route stub (agendas was the re-enable case study; treasury/proposals/market remain stubbed)
- impact: code-analysis/agendas/impact.md — live-page blast radius: route↔nav drift, not-yet-started nil-summary panic (guarded), empty forward-only vote charts, VoteTracker startup dep, choice-ID/JSON-tag drift, milestone unavailability, vote-version filter resurface/empty-state regression (issue #400), summary-cards drift from filtered list / two-render gap (PR #401)

### Sidechain

_The `/side` page: read-only HTML table of every block with `is_mainchain=false`. Single SQL query (`blocks JOIN block_chain`), no WebSocket, no Stimulus, no amounts — the simplest page-rendering shape in the codebase. Writers are two independent paths: startup `ImportSideChains` (off by default, inserts rows) and live reorg `TipToSideChain` (flips existing rows). `BlockStatus` is shared with 3 sibling endpoints (`/disapproved`, `/block/{hash}` status, height-keyed status) each Scanning a different column subset — positional Scan invariant._

- flow (compact): code-analysis/sidechain/flow.compact.md — high-level summary of the read path, both writer paths, and why C1/C3/C8 don't apply
- flow (full): code-analysis/sidechain/flow.full.md — detailed handler → DataSource → SQL → Scan → template trace, plus `ImportSideChains` and reorg writers
- impact: code-analysis/sidechain/impact.md — `BlockStatus` 4-endpoint blast, positional Scan desync, uninitialized `IsMainchain`, `ImportSideChains=false` empty-page-is-correct, real-time-element imports C3/C8

### Disapproved Blocks

_The `/disapproved` page: read-only HTML table of every block with `is_valid=false` (regular tx tree invalidated by stakeholder votes on the next block). Structural twin of `/side` — same shared `BlockStatus` struct, same `blocks JOIN block_chain` query — but with a single, always-on writer (`updateLastBlock` inside the normal block-connect path, no flag, no reorg required) and ETag/Last-Modified caching (`withCache`) that `/side` lacks. Each list endpoint pre-trims its filter column from the SELECT, leaving a different `BlockStatus` field unwritten by Scan: `/disapproved` leaves `IsValid` zero; `/side` leaves `IsMainchain` zero._

- flow (compact): code-analysis/disapproved-blocks/flow.compact.md — high-level summary of the writer cascade, ETag-wrapped read path, shared `BlockStatus` Scan invariant, and why C1/C2/C3/C6/C8 are out of scope today
- flow (full): code-analysis/disapproved-blocks/flow.full.md — detailed handler → DataSource → SQL → Scan → template trace, `updateLastBlock` vote-bit invalidation cascade, `/rejects` 308 alias, and the `withCache` divergence vs `/side`
- impact: code-analysis/disapproved-blocks/impact.md — `BlockStatus` 4-reader Scan blast, `IsValid` Scan-default trap, `updateLastBlock` as sole writer (cross-table is_valid coherence), ETag cache key coupling, real-time/amount-column re-import of C1/C3/C6/C7/C8

### Decode/Broadcast Tx

_The `/decodetx` page: a static HTML form whose handler carries no data; all interaction runs over `/ws` as request/response RPC-over-WebSocket (`decodetx` / `sendtx` → `decodetxResp` / `sendtxResp`). The only user-driven write path to the node in the page tier. The same RPCs are exposed on three transports — explorer `/ws`, pubsub `/ps`, and Insight `POST /insight/api/tx/send` — each with its own envelope, size limit, and error-string convention. SKA precision is preserved by accident of pass-through: `*chainjson.TxRawResult` is marshaled verbatim and dumped into `<pre>.textContent`, never parsed by the explorer._

- flow (compact): code-analysis/decodetx/flow.compact.md — HTML-shell + WS-only data path, three-transport surface, pass-through multi-coin invariant, mutation checklist
- flow (full): code-analysis/decodetx/flow.full.md — handler → template → Stimulus → `/ws` `switch` → `ChainDB.{Decode,Send}RawTransaction` → node RPC trace, with the pubsub `/ps` twin and Insight REST surface
- patterns: code-analysis/decodetx/patterns.md — P1 form-shell over WS-RPC, P2 three-transport surface for the same node RPC, P3 multi-coin pass-through via opaque JSON
- impact: code-analysis/decodetx/impact.md — R1 event-string drift across 5 sites, R2 oversize-request silent drop, R3 `/ws`/`/ps` dual-pipeline drift, R4 interface fan-out (+ mock), R5 latent SKA precision loss, R6 same-event success/error multiplexing, R7 shared receive loop, R8 legacy `/explorer/decodetx` redirect

### WebSocket Transport

_The explorer `/ws` real-time pipe shared by all live pages: `RootWebsocket` + `WebsocketHub` (server, migrated to `coder/websocket`) and the `partysocket`-based `MessageSocket` client wrapper. Owns the connection lifecycle, hub fan-out, `{event,message}` framing, RPC-over-WS (`<event>Resp`), synthetic `open`/`reconnect`/`close`/`error` events, two-layer outbound buffering, and 60 s keepalive — distinct from per-feature payload domains (mempool/visualblocks/decodetx/ticketpool) and from the separate pubsub `/ps` server._

- flow (compact): code-analysis/websocket/flow.compact.md — one-line push/request flow, 7 transport patterns, constraints, mutation checklist
- flow (full): code-analysis/websocket/flow.full.md — end-to-end trace: hub → 3-goroutine connection handler → wire envelope → partysocket client → consumers; event-id triple coupling; keepalive
- patterns: code-analysis/websocket/patterns.md — envelope-and-dispatch + synthetic events, 3-goroutine/`connCtx` model, fan-out unregister-on-backpressure, RPC-over-WS, reconnect-driven re-request, two-layer buffering, new-tx batching
- impact: code-analysis/websocket/impact.md — R1 event-name drift, R2 unwired push signal, R3 `/ws`↔`/ps`↔HTTP drift, R4 SKA-through-float, R5 backpressure change, R6 connCtx teardown, R7 keepalive removal, R8 size limits, R9 reconnect-recovery omissions, R10 queue overflow / malformed frame

### Ticketpool

_The `/ticketpool` page: form-shell HTML + three live data channels (HTTP `/api/ticketpool/charts`, HTTP `/api/ticketpool/bydate/{tp}`, WS `getticketpooldata`→`Resp`). Server `Ticketpool` handler injects only `commonData`; `sigNewBlock` carries no ticket data, the JS controller re-requests on every `newblock`. One `PoolTicketsData` struct populated by three positional Scans; process-global stale-while-revalidate cache keyed `(interval, height)` with `trylock.Mutex` updater election and an inner retry loop to keep all three sub-charts at one block. VAR-only float64 pipeline (tickets are a VAR PoS instrument by chain design); same JSON field `mempool.price` carries two different semantics across REST vs WS — a C8 manifestation inside a single field._

- flow (compact): code-analysis/ticketpool/flow.compact.md — high-level summary of the form-shell + three-channel data path, height-keyed cache, and dual-transport mempool divergence
- flow (full): code-analysis/ticketpool/flow.full.md — detailed handler → API/WS → DB → cache → SQL → Scan → JS controller trace, with REST/WS semantic asymmetry
- patterns: code-analysis/ticketpool/patterns.md — P1 form-shell over WS-RPC, P2 tri-modal struct with positional Scan, P3 process-global stale-while-revalidate cache, P4 dual-transport overlay with divergent semantics, P5 VAR-only float64 staking pipeline
- impact: code-analysis/ticketpool/impact.md — column-Scan desync, REST/WS payload drift, `Mempool.Price` semantic drift, WS event-name drift, TimeGrouping enum drift, SKA-through-VAR pipeline corruption, cache-loop removal, process-global cache cross-talk, C6 violation surface, legacy `DCR` label leak, `/bydate` response asymmetry

### Market — REMOVED

_The `/market` page and the entire `exchanges/` pipeline were **removed** from the codebase; the code-analysis trace was deleted as obsolete. The route now returns **HTTP 410 Gone** ("market not available", [cmd/dcrdata/main.go](../cmd/dcrdata/main.go) `r.Get("/market", …)`). Removal landed in `d4d8c94e` (`cmd/dcrdata: remove /market and all exchange-bot wiring`) and `ea9ded5b` (`chore: remove orphaned exchanges/ and exchanges/rateserver/ modules`). For intent see [specs/market-removal/spec.md](specs/market-removal/spec.md); for the disabled-route registry see [core/pages.md](core/pages.md) (§ Disabled / 410 Gone)._

### Page-Rendering (cross-domain consolidation)

_Mode-4 consolidation of the shared mechanics behind every server-rendered HTML page (block, mempool, visualblocks, parameters, charts, address). Not a flow — read alongside the per-domain flows it links. Covers out-of-band shared `pageData`/`invs` state, the multi-lock discipline, `*CommonPageData` struct-embedding template injection, and block-scoped ETag caching._

- patterns: code-analysis/page-rendering/patterns.md — out-of-band shared page state via saver fan-out, `pageData`/`invsMtx` lock discipline, `*CommonPageData` embedding, block-scoped ETag cache
- impact: code-analysis/page-rendering/impact.md — `commonData` nil render crash (all pages), saver writer/reader drift (HTML≠WS), lock-order inversion against `Store`
