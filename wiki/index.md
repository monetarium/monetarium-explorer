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
- patterns: code-analysis/address/patterns.md — `CoinCtx` URL contract, coin-aware aggregation, per-coin caching, SKA decimal-string pipeline, TurboQuery URL ownership ⚠️ **stale (pre-#265/#266: dual-field shim) — reconcile via `Consolidate: address`**
- impact (summary card): code-analysis/address/summary.impact.md ⚠️ **stale** — describes the now-completed VAR-only→multi-coin summary migration (`FiatBalance` removed, per-coin card shipped)
- impact (transactions): code-analysis/address/transactions.impact.md ⚠️ **stale** — per-row coin fields are now read by the template (Coin column + SKA branches shipped)
- impact (charts): code-analysis/address/charts.impact.md ⚠️ **partially stale** — frontend now emits `?coin=`; SKA SQL precision bug fixed (PR #263)

### Windows

_Ticket price window intervals, calculating and displaying current and upcoming ticket prices._

- flow (compact): code-analysis/windows/flow.compact.md — high-level summary of ticket window calculations and database queries
- flow (full): code-analysis/windows/flow.full.md — detailed, step-by-step function trace for deep debugging of window intervals

### Time-Based Blocks

_Aggregation and grouping of blocks over specific time intervals (days, weeks, months, years)._

- flow (compact): code-analysis/time-based-blocks/flow.compact.md — high-level summary of how blocks are grouped by time periods
- flow (full): code-analysis/time-based-blocks/flow.full.md — detailed, step-by-step function trace for deep debugging of time aggregations

### Mempool

_Multi-coin aggregation (CoinStats + derived CoinFills), dual collection paths (batch ParseTxns at block boundary vs. incremental addTxToCoinStats per tx), multi-saver fan-out, dual-transport WS delivery, and live indicator rendering._

- flow (compact): code-analysis/mempool/flow.compact.md — high-level summary of mempool state aggregation, fan-out, and WS delivery
- flow (full): code-analysis/mempool/flow.full.md — detailed, step-by-step function trace covering monitor/collector, savers, CoinFills derivation, WS encoders, templates, and JS controller
- patterns: code-analysis/mempool/patterns.md — batch+incremental aggregation, multi-saver fan-out, dual-transport WS, atom-string arithmetic, derived-view dual write, inventory locking, rAF indicator batching
- impact: code-analysis/mempool/impact.md — precision, batch/incremental drift, CoinFills recompute gaps, saver nil-guard, DeepCopy/Trim omissions, WS schema drift, Go↔JS drift, mempool.tmpl SKA gap, lock-order inversion

### Charts

_Historical data fetching, cache aggregation, and payload serialization for UI charts. Covers the legacy VAR `coin-supply` pipeline alongside the per-coin SKA `coin-supply/{N}` pipeline (lazy load, `*big.Int` cumulation, exact-precision legend)._

- flow (compact): code-analysis/charts/flow.compact.md — high-level summary of both VAR and SKA chart pipelines
- flow (full): code-analysis/charts/flow.full.md — detailed, step-by-step function trace covering RPC/SQL → cache → API → controller → Dygraphs for both pipelines

### VisualBlocks

_The `/visualblocks` page: latest-N blocks plus mempool rendered as flex-grow tiles. Dual pipeline (HTTP `TrimmedBlockInfo` vs WebSocket full `BlockInfo`) with two different `Subsidy` struct shapes and a JS-side coinbase filter._

- flow (compact): code-analysis/visualblocks/flow.compact.md — high-level summary of the HTTP + WS pipelines and the trim asymmetry
- flow (full): code-analysis/visualblocks/flow.full.md — detailed, step-by-step function trace covering handler, DB memo, WS encoder, JS controller, and template
- patterns: code-analysis/visualblocks/patterns.md — cross-pipeline tile rendering, JS-side server-filter mirror, Subsidy struct asymmetry, triple-enforced 30-cap, memoized BlockInfo, lock order, WS subsidy patch
- impact: code-analysis/visualblocks/impact.md — mutation impact across HTTP/WS/JS/DB layers, loud and silent failure modes, safe-change checklist
