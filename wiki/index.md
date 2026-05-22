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
- market-removal: specs/market-removal/spec.md — `/market` page Monetarium removal: page made unavailable (like `/treasury`, `/agendas`, `/proposals`), drop "Market" menu item and Home "Exchange Rate" card, remove USD equivalents on Home / `/tx` / `/address` / `/block`, turn off background exchange polling and the related service endpoints

## 🤖 Code Traces

_Code-grounded analysis of data flows, cross-layer dependencies, and hidden constraints. Paste these into your prompt when modifying specific areas._

### Block

_Data flow for block rendering, including headers, metrics, and block content parsing._

- flow (compact): code-analysis/block/flow.compact.md — high-level summary of the data path from node/DB to the block UI
- flow (full): code-analysis/block/flow.full.md — detailed, step-by-step function trace for deep debugging of block logic
- patterns: code-analysis/block/patterns.md — recurring architectural concepts and invariants to follow when modifying blocks
- impact: code-analysis/block/impact.md — downstream components and templates that break if block data structures change

### Transaction

_End-to-end pipeline for transaction processing, decoding, and rendering inputs/outputs._

- flow (compact): code-analysis/transaction/flow.compact.md — high-level summary of how transaction inputs and outputs are processed
- flow (full): code-analysis/transaction/flow.full.md — detailed, step-by-step function trace for deep debugging of tx logic
- patterns: code-analysis/transaction/patterns.md — recurring architectural concepts and invariants to follow when modifying transactions
- impact: code-analysis/transaction/impact.md — downstream components and templates that break if tx data structures change

### Address

_Address page rendering: paginated transaction table, chart endpoints, CSV download, **multi-coin end-to-end** (`?coin=` via `CoinCtx` middleware; filter-before-paginate; confirmed-only balance), per-coin summary card + Coin column, and TurboQuery-driven URL state (chart kind, zoom, group-by, pagination, `coin`). Revised at `HEAD=1b670255` (PR #265/#266 + db coin-filter series)._

- flow (compact): code-analysis/address/flow.compact.md — current data path, `?coin=` contract, filter-before-paginate + confirmed-only-balance invariants, and a stale-claim delta table vs. the prior revision
- flow (full): code-analysis/address/flow.full.md — current function trace: coin-filtered `AddressHistory`, rewritten mempool overlay, merged-view LIMIT-0 fix, per-coin templates, coin-aware controller, chart serialization
- patterns: code-analysis/address/patterns.md — `CoinCtx` URL contract (backend + frontend), coin-aware aggregation (3 pipelines), per-coin caching, SKA decimal-string pipeline, dual VAR/SKA SUM, VAR-only stake metrics, legacy flat-field shim (residual), TurboQuery URL ownership
- impact: code-analysis/address/impact.md — consolidated current-reality blast radius: coin-filter signature fan-out (+4 mocks), `CoinTypeAll=255` dual semantics, SKA-through-VAR precision (PR #263 class), coin-keyed cache staleness, `?coin=` server/client desync, legacy flat-field shim removal, CSV `value`→`amount` schema break (folds the former summary/transactions/charts sub-area notes)

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

_The `/visualblocks` page: latest-N blocks plus mempool rendered as flex-grow tiles. Dual pipeline (HTTP `TrimmedBlockInfo` vs WebSocket full `BlockInfo`) with two different `Subsidy` struct shapes and a JS-side coinbase filter. **Revised at `HEAD=386f2e12` (post PR #284 `feat/visualblocks-data-contract`)**: four contract fields (`coin_fills`, `active_ska_count`, `max_block_size`, `regular_coin_counts`) now wire-symmetric across HTTP and `/ws` via a shallow-copy + `(*BlockInfo).Trim` patch on the WS path; trim logic moved into `explorer/types` as `(*BlockInfo).Trim(maxBlockSize, issuedSKA)` and `(*MempoolInfo).Trim(maxBlockSize)`; `computeCoinFills` exported as `types.ComputeCoinFills`; `TrimmedTxInfo.Voted` added; `pubsub/ps:sigNewBlock` is NOT patched (known divergence); `visualblocks.tmpl` / `visualBlocks_controller.js` do not yet consume the new fields._

- flow (compact): code-analysis/visualblocks/flow.compact.md — current data path, contract-field patch sequence, lock-order refactor, mutation checklist
- flow (full): code-analysis/visualblocks/flow.full.md — detailed function trace covering handler, DB memo, `(*BlockInfo).Trim`, WS shallow-copy + patch, pubsub divergence, contract test, JS controller, and template
- patterns: code-analysis/visualblocks/patterns.md — cross-pipeline tile rendering, JS-side server-filter mirror, **cross-transport contract via WS shallow-copy + Trim patch (PR #284)**, Subsidy struct asymmetry, triple-enforced 30-cap, memoized BlockInfo, **Trim methods on the types package**, lock order, WS subsidy patch, contract test as enforcement
- impact: code-analysis/visualblocks/impact.md — mutation impact across HTTP/WS/JS/DB/pubsub layers, contract-field safe-change checklist, `/ps` divergence as known gap, loud and silent failure modes

### Attack-Cost

_The `/attack-cost` majority-attack calculator: a no-compute Go handler reads a shared VAR-only `HomeInfo` snapshot into `data-*` attributes; all PoW/PoS math runs client-side in `attackcost_controller.js`. VAR-only by construction (legacy flat `CoinSupply`/`DCR` labels); not portable to SKA without a BigInt rewrite._

- flow (compact): code-analysis/attack-cost/flow.compact.md — high-level summary of the no-compute handler, VAR-only snapshot, untyped Go→JS contract, and client-side math
- flow (full): code-analysis/attack-cost/flow.full.md — detailed trace: node→Store→HomeInfo→handler→template→Stimulus, exchange-bot price-zero trap, snapshot staleness, SKA precision boundary
- patterns: code-analysis/attack-cost/patterns.md — no-compute handler, VAR-only legacy snapshot, untyped `data-*`↔Stimulus contract, vendored-Dygraphs private override
- impact: code-analysis/attack-cost/impact.md — SKA-through-VAR-pipeline corruption, shared `HomeInfo` blast radius, silently-zero exchange price, stale snapshot, Go→JS drift; mostly silent failure modes

### Parameters

_The `/parameters` page: active-network consensus config. ~95% static `chaincfg.Params` captured once at startup; only `MaximumBlockSize` is dynamic (tip-only RPC `GetBlockChainInfo`). Dual param injection (`commonData.ChainParams` + handler `ExtendedParams`), block-scoped ETag cache, VAR-only subsidy rows._

- flow (compact): code-analysis/parameters/flow.compact.md — high-level summary of the static-vs-dynamic split, dual injection, and silent/hard failure modes
- flow (full): code-analysis/parameters/flow.full.md — detailed, step-by-step trace from node config/RPC → pageData → handler → template, with cross-layer deps and mutation impact
- patterns: code-analysis/parameters/patterns.md — near-static chaincfg.Params page: dual-source commonData/ExtendedParams split, hardcoded network-name prefix table, VAR-only subsidy rows, unchecked MaximumBlockSizes[0] fallback
- impact: code-analysis/parameters/impact.md — commonData nil → .ChainParams deref crash, silent blank/misaligned address-prefix table on unknown network, stale/empty-slice MaximumBlockSize, unlocked pageData.BlockchainInfo race

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

### Ticketpool

_The `/ticketpool` page: form-shell HTML + three live data channels (HTTP `/api/ticketpool/charts`, HTTP `/api/ticketpool/bydate/{tp}`, WS `getticketpooldata`→`Resp`). Server `Ticketpool` handler injects only `commonData`; `sigNewBlock` carries no ticket data, the JS controller re-requests on every `newblock`. One `PoolTicketsData` struct populated by three positional Scans; process-global stale-while-revalidate cache keyed `(interval, height)` with `trylock.Mutex` updater election and an inner retry loop to keep all three sub-charts at one block. VAR-only float64 pipeline (tickets are a VAR PoS instrument by chain design); same JSON field `mempool.price` carries two different semantics across REST vs WS — a C8 manifestation inside a single field._

- flow (compact): code-analysis/ticketpool/flow.compact.md — high-level summary of the form-shell + three-channel data path, height-keyed cache, and dual-transport mempool divergence
- flow (full): code-analysis/ticketpool/flow.full.md — detailed handler → API/WS → DB → cache → SQL → Scan → JS controller trace, with REST/WS semantic asymmetry
- patterns: code-analysis/ticketpool/patterns.md — P1 form-shell over WS-RPC, P2 tri-modal struct with positional Scan, P3 process-global stale-while-revalidate cache, P4 dual-transport overlay with divergent semantics, P5 VAR-only float64 staking pipeline
- impact: code-analysis/ticketpool/impact.md — column-Scan desync, REST/WS payload drift, `Mempool.Price` semantic drift, WS event-name drift, TimeGrouping enum drift, SKA-through-VAR pipeline corruption, cache-loop removal, process-global cache cross-talk, C6 violation surface, legacy `DCR` label leak, `/bydate` response asymmetry

### Market

_The `/market` page: server-rendered shell + Stimulus chart controller fed by a single nullable `*exchanges.ExchangeBot` (Coinbase + Binance + Mexc + dex.decred.org polling, or optional DCRRates gRPC master). The bot snapshot is read three ways: HTML render via `MarketPage`/`getExchangeState`, WS pushes via `watchExchanges → "exchange" event → globalEventBus 'EXCHANGE_UPDATE'`, and lazily-encoded versioned chart bytes via `/api/chart/market/{token}/{candlestick|depth}`. The same bot also drives `xcBot.Conversion(float64)` fiat sidebars on home/tx/address (and the 410-gated treasury handler). Per [/wiki/core/pages.md](core/pages.md) this page is flagged "should be disabled" — no Monetarium asset trades anywhere; the entire surface is `float64` (VAR-safe, SKA-incompatible) and DCR-symbol-hard-coded across 5 layers. Network-name gate `Name != "mainnet"` is a no-op on Monetarium mainnet._

- flow (compact): code-analysis/market/flow.compact.md — three-channel data path, dual collection mode (DCRRates gRPC vs HTTP poll), snapshot/stateCopy invariant, mutation checklist
- flow (full): code-analysis/market/flow.full.md — detailed bot construction → updateState → MarketPage handler / watchExchanges / QuickSticks·QuickDepth → market.tmpl + market_controller.js trace, including cross-page `Conversion(...)` callsites
- patterns: code-analysis/market/patterns.md — P1 globally-shared optional collector, P2 dual collection source (gRPC vs poll), P3 lock-free stateCopy read, P4 versioned lazy-encoded chart cache, P5 untyped WS bridge via globalEventBus
- impact: code-analysis/market/impact.md — `float64`-only SKA precision trap, 5-layer DCR-symbol hard-coding, network-name gate no-op on Monetarium mainnet, cross-page conversion fan-out (~7 sites), WS event-id silent drift, C8 WS vs REST schema asymmetry, `IsFailed()` only honored by `/market` (cross-page conversions show stale fiat)

### Page-Rendering (cross-domain consolidation)

_Mode-4 consolidation of the shared mechanics behind every server-rendered HTML page (block, mempool, visualblocks, parameters, charts, address). Not a flow — read alongside the per-domain flows it links. Covers out-of-band shared `pageData`/`invs` state, the multi-lock discipline, `*CommonPageData` struct-embedding template injection, and block-scoped ETag caching._

- patterns: code-analysis/page-rendering/patterns.md — out-of-band shared page state via saver fan-out, `pageData`/`invsMtx` lock discipline, `*CommonPageData` embedding, block-scoped ETag cache
- impact: code-analysis/page-rendering/impact.md — `commonData` nil render crash (all pages), saver writer/reader drift (HTML≠WS), lock-order inversion against `Store`
