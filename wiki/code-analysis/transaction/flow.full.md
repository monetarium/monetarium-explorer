### 1. Overview

This trace documents the end-to-end transaction flow through the Monetarium Explorer, comparing unconfirmed (mempool) transactions against confirmed (block-persisted) transactions. The system exhibits heavy architectural divergence and duplicated multi-coin (VAR/SKA) parsing logic depending on the transaction's confirmation state.

#### Core Invariant

A transaction is strictly single-coin.

- A transaction belongs to exactly one CoinType
- Inputs and outputs cannot mix coins
- Multi-coin support exists at the system level, not transaction level

### 2. End-to-End Data Flow

**Mempool (Unconfirmed) Flow:**
Node RPC (tx notification) → `mempoolmonitor` fetches raw hex → `txhelpers.MsgTxFromHex` (Go memory) → `txhelpers.SKATotalsFromMsgTx` (sums the transaction's single-coin outputs) → `explorertypes.MempoolTx.SKATotals` (map[uint8]string) → WebSocket → JS Controller clones `<template>` → Javascript formats `ska_totals` to UI.

**Confirmed Flow:**
Postgres block height update → UI requests `GetAPITransaction` → `pgblockchain` queries Node RPC `GetRawTransactionVerbose` → Node maps `CoinType` and `SKAValue` into `Vout` array → `apitypes.TxShort` wraps array → Server renders `tx.tmpl` → Template ignores coin data and hardcodes generic `Amount`.

### 3. Per-Layer Breakdown

**Mempool Ingestion & Aggregation**

- **Location:** `mempool/monitor.go`, `mempool/collector.go`, `txhelpers/txhelpers.go`
- **Data Structures:** `wire.MsgTx`, `explorertypes.MempoolTx`
- **Transformations Applied:** Raw transaction hex is manually decoded into `wire.MsgTx`. Instead of keeping output indexes, the transaction's outputs are summed for its specific CoinType and assigned to `SKATotals` utilizing `*big.Int` arithmetic to prevent precision loss.

**Confirmed Database & API Interception**

- **Location:** `db/dcrpg/pgblockchain.go`, `api/types/apitypes.go`
- **Data Structures:** `chainhash.Hash`, `chainjson.TxRawResult`, `apitypes.TxShort`, `apitypes.Vout`
- **Transformations Applied:** For `/tx/{txid}`, the DB does not attempt to reconstruct outputs from Postgres. Instead, it queries the `dcrd` node for a verbose JSON representation. The node parses the coins and outputs them inside a raw `Vout` slice, which gets directly copied to `apitypes.TxShort.Vout[i].CoinType` and `SKAValue`.

**Frontend Rendering Boundaries**

- **Location:** `cmd/dcrdata/views/home_mempool.tmpl`, `homepage_controller.js`, `cmd/dcrdata/views/tx.tmpl`
- **Data Structures:** WebSocket JSON (`TrimmedMempoolTx`), Template Data (`explorertypes.TxInfo`)
- **Transformations Applied:** The mempool relies on Javascript checking `if (tx.ska_totals)` and formatting it live. The confirmed view relies on Go templates iterating `range $i, $v := .Vout` and applying `float64AsDecimalParts .Amount`, completely discarding coin context.

### 4. Cross-Layer Dependencies

- The REST API and confirmed UI are heavily coupled to the underlying node's verbose JSON structure (`chainjson`). Changes to how the node exposes multi-coins immediately affect the explorer.
- The mempool UI is directly coupled to `txhelpers.SKATotalsFromMsgTx`. It depends entirely on the Go backend replicating node decoding logic accurately in memory.
- The Stimulus Javascript controllers expect a single-coin total for the SKA coin in the mempool but hold no logic for displaying confirmed SKA transactions (which fall back to static HTML arrays).

### 5. Critical Constraints

- **Precision Rules:** Multi-coin values use 18 decimal places. They must always traverse the stack as `*big.Int` or `string` (`SKAValue`, `SKATotals`), never as `float64`.
- **Divergent Source of Truth:** Confirmed data trusts the node's RPC parsing. Mempool data trusts the `monetarium-explorer`'s internal `txhelpers` parsing.
- **Missing WebSocket Events:** Confirmed transactions are not broadcast explicitly via WebSockets with full datasets; clients are only pinged a `sigNewBlock` signal.
- **UI Template Flaw:** `tx.tmpl` does not use `.CoinType` or `.SKAValue` properties for the Outputs table, meaning confirmed SKA transactions are improperly rendered as base `Amount`.

### 6. Mutation Impact

When modifying **transaction data structures or multi-coin logic**, you MUST check ALL of the following:

- **Direct dependencies:** `apitypes.Vout`, `apitypes.TxShort`, `explorertypes.MempoolTx`
- **Indirect dependencies:** `txhelpers.SKATotalsFromMsgTx`, the `dcrpg.GetRawTransactionVerbose` RPC wrapper.
- **Serialization boundaries:** The `TrimmedMempoolTx` WebSocket schema.
- **Rendering layers:** Support for rendering the transaction's specific CoinType must be explicitly added to `cmd/dcrdata/views/tx.tmpl`, mimicking logic found in `homepage_controller.js` or `home_mempool.tmpl`.

**Silently breaks:** Altering `.Amount` types or coin processing in `txhelpers` vs `dcrd` will cause silent data divergence.
**Fails loudly:** Altering `apitypes.Vout` missing JSON tags will break downstream API clients instantly.

### 7. Common Pitfalls

- Attempting to parse the transaction's specific coin data using only the legacy `.Amount` (float64) field.
- Updating `MempoolTx` and expecting the REST API (`TxShort`) to automatically inherit the change. They are entirely disconnected structs.
- Assuming confirmed transactions stream over WebSockets to update the `tx/{txid}` page dynamically.
- Forgetting to update the Javascript controllers `<template>` injection when modifying the single-coin totals.

### 8. Evidence

- **Mempool Decoding:** `mempool/monitor.go` (Line ~134) - `txhelpers.MsgTxFromHex(rawTx.Hex)`
- **Mempool SKA extraction map:** `mempool/collector.go` (Line ~162) - `SKATotals: txhelpers.SKATotalsFromMsgTx(msgTx)`
- **Confirmed API Node usage:** `db/dcrpg/pgblockchain.go` (Line ~5019) - `pgb.Client.GetRawTransactionVerbose`
- **Confirmed Struct Binding:** `db/dcrpg/pgblockchain.go` (Line ~5058) - maps `Vout[i].CoinType` and `Vout[i].SKAValue` manually.
- **Template Misrepresentation:** `cmd/dcrdata/views/tx.tmpl` (Line 561) loops over `.Vout` but exclusively renders `(float64AsDecimalParts .Amount)`.
- **Mempool UI Logic:** `cmd/dcrdata/public/js/controllers/homepage_controller.js` handles `ska_totals` via DOM templates correctly.

### 9. Data Flow Priority Rule

The overriding flow concept is **aggregation vs. index-preservation**. Mempool flows squash output data immediately into maps. Confirmed flows proxy node-provided arrays verbatim. Any cross-cutting concern (like tracking a specific coin's movement) must reconcile these two formats.
