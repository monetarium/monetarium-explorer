# Knowledge Index

## 🧠 Core Architecture & Domain

_Human-curated rules, architecture, and constraints. Read these to understand the project._

- product: core/product.md — what are we building, token limits
- structure: core/structure.md — Go modules, folders boundaries
- tech-stack: core/tech-stack.md — packages, node engines
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
- attack-cost: specs/attack-cost/spec.md — `/attack-cost` page Monetarium adjustment: VAR-only domain (no SKA), `DCR`→`VAR` labels, manual-only exchange rate (no auto price), keep formula but drop Decred citation, replace hardcoded Decred miner list with manual hashrate/power/cost inputs

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

_Ticket price window intervals, calculating and displaying current and upcoming ticket prices._

- flow (compact): code-analysis/windows/flow.compact.md — high-level summary of ticket window calculations and database queries
- flow (full): code-analysis/windows/flow.full.md — detailed, step-by-step function trace for deep debugging of window intervals
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

_The `/visualblocks` page: latest-N blocks plus mempool rendered as flex-grow tiles. Dual pipeline (HTTP `TrimmedBlockInfo` vs WebSocket full `BlockInfo`) with two different `Subsidy` struct shapes and a JS-side coinbase filter._

- flow (compact): code-analysis/visualblocks/flow.compact.md — high-level summary of the HTTP + WS pipelines and the trim asymmetry
- flow (full): code-analysis/visualblocks/flow.full.md — detailed, step-by-step function trace covering handler, DB memo, WS encoder, JS controller, and template
- patterns: code-analysis/visualblocks/patterns.md — cross-pipeline tile rendering, JS-side server-filter mirror, Subsidy struct asymmetry, triple-enforced 30-cap, memoized BlockInfo, lock order, WS subsidy patch
- impact: code-analysis/visualblocks/impact.md — mutation impact across HTTP/WS/JS/DB layers, loud and silent failure modes, safe-change checklist

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

### Page-Rendering (cross-domain consolidation)

_Mode-4 consolidation of the shared mechanics behind every server-rendered HTML page (block, mempool, visualblocks, parameters, charts, address). Not a flow — read alongside the per-domain flows it links. Covers out-of-band shared `pageData`/`invs` state, the multi-lock discipline, `*CommonPageData` struct-embedding template injection, and block-scoped ETag caching._

- patterns: code-analysis/page-rendering/patterns.md — out-of-band shared page state via saver fan-out, `pageData`/`invsMtx` lock discipline, `*CommonPageData` embedding, block-scoped ETag cache
- impact: code-analysis/page-rendering/impact.md — `commonData` nil render crash (all pages), saver writer/reader drift (HTML≠WS), lock-order inversion against `Store`
