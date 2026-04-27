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
- **Implication for Mutation:** See [system/constraints.md#C2](../system/constraints.md#C2)

### 2. The Presentation Layer Schism

The application leverages two entirely different rendering paradigms side-by-side.

- **The Pattern:** Historical, persisted data relies on Go `html/template` executing server-side loops (`range`) on the initial page load. Transient, real-time data relies heavily on Stimulus JS Controllers consuming WebSockets and cloning inert HTML `<template>` elements.
- **Implication for Mutation:** See [system/constraints.md#C3](../system/constraints.md#C3)

### 3. Stringified Precision Preservation

The codebase distrusts standard numeric serialization across boundaries.

- **The Pattern:** To prevent precision loss or overflow in cross-layer communication (especially regarding high-precision SKA and VAR arithmetic), the system eagerly converts high-precision types into `map[uint8]string` or explicit `string` properties (`SKAValue`) before pushing them across the API or WebSocket boundaries.
- **Implication for Mutation:** See [system/constraints.md#C1](../system/constraints.md#C1)

### 4. Perimeter Flattening Pattern (Ingestion-Time Aggregation)

To optimize for bandwidth and UI speed, the system aggressively strips context from live entities at ingestion.

- **The Pattern:** In motion (Mempool, WebSocket broadcasts), complex structural arrays (such as `Vout` outputs) are summed into a single total for the transaction's CoinType right at the ingestion layer. At rest (DB, REST API), the full dimensional array structure is provided.
- **Implication for Mutation:** See [system/constraints.md#C4](../system/constraints.md#C4)
