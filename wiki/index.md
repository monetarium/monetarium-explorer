# Knowledge Index

## 🧠 Core Architecture & Domain

_Human-curated rules, architecture, and constraints. Read these to understand the project._

- product: core/product.md — what are we building, token limits
- structure: core/structure.md — Go modules, folders boundaries
- tech-stack: core/tech-stack.md — packages, node engines
- staking-rewards: core/staking-rewards.md — mechanics of pow and pos yields and fee splits
- constraints: core/constraints.md — cross-domain architectural constraints
- maintenance: core/maintenance.md — guide for wiki upkeep and structure

## 📋 Feature Specifications

_Requirements and guidelines for specific features and pages._

- homepage-metrics: specs/homepage-metrics.md — mempool, latest blocks, and supply component rules
- block-details: specs/block-details.md — rendering rules for block details page
- blocks-list: specs/blocks-list.md — rules for rendering list of blocks (block table on block list page)
- chart-ska-coin-supply: specs/chart-ska-coin-supply.md — rendering and logic rules for SKA coin supply charts
- mempool-page: specs/mempool-page.md — full multi-coin mempool page layout and logic

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

### VAR & SKA

_Multi-coin architecture traces covering values, fee separation, and rendering for both token types._

- flow (compact): code-analysis/var-ska-data/flow.compact.md — high-level summary of token splitting, balances, and fee tracking
- flow (full): code-analysis/var-ska-data/flow.full.md — detailed, step-by-step function trace for deep debugging of multi-coin logic
- patterns: code-analysis/var-ska-data/patterns.md — recurring architectural concepts and invariants to follow when handling token types
- impact: code-analysis/var-ska-data/impact.md — downstream components and templates that break if token rendering logic changes

### Windows

_Ticket price window intervals, calculating and displaying current and upcoming ticket prices._

- flow (compact): code-analysis/windows/flow.compact.md — high-level summary of ticket window calculations and database queries
- flow (full): code-analysis/windows/flow.full.md — detailed, step-by-step function trace for deep debugging of window intervals

### Time-Based Blocks

_Aggregation and grouping of blocks over specific time intervals (days, weeks, months, years)._

- flow (compact): code-analysis/time-based-blocks/flow.compact.md — high-level summary of how blocks are grouped by time periods
- flow (full): code-analysis/time-based-blocks/flow.full.md — detailed, step-by-step function trace for deep debugging of time aggregations

### Mempool

_Multi-token aggregation, websocket data preparation, and template rendering for unconfirmed transactions._

- flow (compact): code-analysis/mempool/flow.compact.md — high-level summary of mempool state aggregation
- flow (full): code-analysis/mempool/flow.full.md — detailed, step-by-step function trace for deep debugging of mempool data tracking

### Charts

_Historical data fetching, cache aggregation, and payload serialization for UI charts._

- flow (compact): code-analysis/charts/flow.compact.md — high-level summary of the chart data pipeline
- flow (full): code-analysis/charts/flow.full.md — detailed, step-by-step function trace for debugging chart API and rendering
