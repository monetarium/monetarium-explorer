# Architectural Patterns

Based on the end-to-end tracing across both Block and Transaction flows, the Monetarium Explorer exhibits several non-obvious structural patterns. When modifying the codebase, recognize that the architecture heavily favors optimization over unification.

## Core Invariant

A transaction is strictly single-coin.

- A transaction belongs to exactly one CoinType
- Inputs and outputs cannot mix coins
- Multi-coin support exists at the system level, not transaction level

### 1. Divergent State Parsing (Dual Source of Truth)

The system fundamentally bifurcates how it determines truth based on chronological state (Pending vs. Historical).

- **The Pattern:** Real-time pipelines (Mempool, newly minted blocks) rely on internal Go-memory parsing and custom helper functions (`txhelpers`, `blockdata.Collector`) to calculate state. Persistent pipelines (Confirmed Blocks, Archived Transactions) ignore these Go helpers entirely, instead treating the underlying Node's RPC and the PostgreSQL recalculation functions as the ultimate source of truth.
- **Implication for Mutation:** See [core/constraints.md#C2](../../core/constraints.md#C2)

### 2. The Presentation Layer Schism

The application leverages two entirely different rendering paradigms side-by-side.

- **The Pattern:** Historical, persisted data relies on Go `html/template` executing server-side loops (`range`) on the initial page load. Transient, real-time data relies heavily on Stimulus JS Controllers consuming WebSockets and cloning inert HTML `<template>` elements.
- **Implication for Mutation:** See [core/constraints.md#C3](../../core/constraints.md#C3)

### 3. Stringified Precision Preservation

The codebase distrusts standard numeric serialization across boundaries.

- **The Pattern:** To prevent precision loss or overflow in cross-layer communication (especially regarding high-precision SKA arithmetic), the system eagerly converts high-precision types into `map[uint8]string` or explicit `string` properties (`SKAValue`, `FeeRaw`, `TotalRaw`) before pushing them across API or WebSocket boundaries. `ssFeeNetReward()` uses `*big.Int` throughout and stores the result as `string` in `FeeRaw`.
- **Implication for Mutation:** See [core/constraints.md#C1](../../core/constraints.md#C1)

### 4. Perimeter Flattening Pattern (Ingestion-Time Aggregation)

To optimize for bandwidth and UI speed, the system aggressively strips context from live entities at ingestion.

- **The Pattern:** In motion (Mempool, WebSocket broadcasts), complex structural arrays (such as `Vout` outputs) are summed into a single total for the transaction's CoinType right at the ingestion layer. At rest (DB, REST API), the full dimensional array structure is provided.
- **Implication for Mutation:** See [core/constraints.md#C4](../../core/constraints.md#C4) and [core/constraints.md#C8](../../core/constraints.md#C8) — the resulting `SKATotals` map vs verbatim `Vout` array is one of the named dual-transport shape asymmetries; cross-cutting tx features must reconcile both.

### 5. Semantic Field Overloading (FeeRaw)

A single struct field carries values with opposite sign conventions depending on tx type.

- **The Pattern:** `TxBasic.FeeRaw` holds a *fee* for regular txs (Σinputs − Σoutputs, ≥ 0) but holds a *net reward* for SSFee txs (Σoutputs − Σinputs, ≥ 0). The computation (`ssFeeNetReward`) is intentionally inverted because the tx distributes a reward rather than consuming one. The template branches on `IsSSFee()` before rendering to pick the right display path.
- **Implication for Mutation:** Any new consumer of `FeeRaw` must check `IsSSFee()` first. Adding a universal "fee total" that sums `FeeRaw` across all tx types would silently double-count or negate SSFee rewards.

### 6. Dual Independent Implementation (ssFeeNetReward)

The same domain formula is implemented in two separate packages that do not share code.

- **The Pattern:** `db/dcrpg/pgblockchain.go:ssFeeNetReward` and `txhelpers/ssfee.go:blockSSFeeTotalsInternal` compute the same Σoutputs − Σinputs formula for SSFee transactions. They are kept in sync by convention (a code comment in `ssFeeNetReward` says "This matches blockSSFeeTotalsInternal"), not by compile-time coupling.
- **Implication for Mutation:** A protocol change affecting SSFee output encoding must be applied to both. There is no unit test that cross-checks them against each other — the risk is silent divergence.

### 7. Ticket Stage Classification (Pessimistic Staging)

Mempool ticket purchases are classified by input confirmation state using a pessimistic fallback.

- **The Pattern:** `ticketStage(vin, txnsStore)` returns "Ready" only when ALL vin parents are confirmed (`BlockHeight > 0` in `txnsStore`). If any parent is missing from `txnsStore` or has `BlockHeight == 0`, it returns "Staging". The pessimistic fallback (missing = Staging) avoids falsely presenting an unmineable ticket as ready. The function exists in `mempool/collector.go` and is called from both `DataCollector.processTransaction` and `MempoolMonitor.processTransaction`.
- **Implication for Mutation:** Both call sites must be updated if the classification logic changes. Adding a new staging criterion requires updating `ticketStage()` once, but the pessimistic missing-parent fallback must be preserved.
