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
Postgres block height update → UI requests `GetAPITransaction` → `pgblockchain` queries Node RPC `GetRawTransactionVerbose` → Node maps `CoinType` and `SKAValue` into `Vout` array → `apitypes.TxShort` wraps array → Server renders `tx.tmpl`, which branches per `$.Data.CoinType` (VAR → `float64AsDecimalParts`; SKA → `skaDecimalParts .ValueRaw`) with `coinSymbol` for the unit. The confirmed page is server-rendered once; it does **not** live-update over WebSocket.

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
- **Transformations Applied:** The mempool relies on Javascript checking `if (tx.ska_totals)` and formatting it live. The confirmed view relies on Go templates iterating `range $i, $v := .Vout`; each amount cell branches on `$.Data.CoinType` — VAR renders via `float64AsDecimalParts .Amount` (8-dec, float64-safe per C1), SKA via `skaDecimalParts .ValueRaw` (decimal string, no float) — with `coinSymbol $.Data.CoinType` for the unit (`tx.tmpl:573`, mirrored at `:500`/`:60`/`:101`).

### 4. Cross-Layer Dependencies

- The REST API and confirmed UI are heavily coupled to the underlying node's verbose JSON structure (`chainjson`). Changes to how the node exposes multi-coins immediately affect the explorer.
- The mempool UI is directly coupled to `txhelpers.SKATotalsFromMsgTx`. It depends entirely on the Go backend replicating node decoding logic accurately in memory.
- The Stimulus Javascript controllers handle the live mempool single-coin total (`ska_totals`); confirmed SKA transactions are rendered server-side by `tx.tmpl`'s `{{if eq $.Data.CoinType 0}}` branches, not by JS. The two render paths are independent and must be kept coin-consistent (C3).

### 5. Critical Constraints

- **Precision Rules:** Multi-coin values use 18 decimal places. They must always traverse the stack as `*big.Int` or `string` (`SKAValue`, `SKATotals`), never as `float64`.
- **Divergent Source of Truth:** Confirmed data trusts the node's RPC parsing. Mempool data trusts the `monetarium-explorer`'s internal `txhelpers` parsing.
- **Missing WebSocket Events:** Confirmed transactions are not broadcast explicitly via WebSockets with full datasets; clients are only pinged a `sigNewBlock` signal.
- **Per-coin render branch:** `tx.tmpl`'s amount cells branch on `$.Data.CoinType` — SKA uses the precise `.ValueRaw` decimal string via `skaDecimalParts`; only the VAR branch uses the float64 `.Amount` / `float64AsDecimalParts` path (safe for 8-dec VAR, C1). Breaking or bypassing this branch (rendering SKA through the VAR `.Amount` path) silently corrupts SKA precision.

### 6. Mutation Impact

When modifying **transaction data structures or multi-coin logic**, you MUST check ALL of the following:

- **Direct dependencies:** `apitypes.Vout`, `apitypes.TxShort`, `explorertypes.MempoolTx`
- **Indirect dependencies:** `txhelpers.SKATotalsFromMsgTx`, the `dcrpg.GetRawTransactionVerbose` RPC wrapper.
- **Serialization boundaries:** The `TrimmedMempoolTx` WebSocket schema.
- **Rendering layers:** `cmd/dcrdata/views/tx.tmpl` already renders per `$.Data.CoinType` (VAR `float64AsDecimalParts` vs SKA `skaDecimalParts .ValueRaw`, `coinSymbol`); a new coin-dependent field must extend **both** branches there. The live mempool path is separate (`homepage_controller.js` + `home_mempool.tmpl`) and must be updated in parallel.

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
- **Per-coin output rendering:** `cmd/dcrdata/views/tx.tmpl:573` renders the Vout amount as `{{if eq $.Data.CoinType 0}}{{float64AsDecimalParts .Amount …}}{{else}}{{skaDecimalParts .ValueRaw …}}{{end}}` (same idiom at `:60`, `:101`, `:500`); unit via `coinSymbol $.Data.CoinType`.
- **Mempool UI Logic:** `cmd/dcrdata/public/js/controllers/homepage_controller.js` handles `ska_totals` via DOM templates correctly.

### 9. Data Flow Priority Rule

The overriding flow concept is **aggregation vs. index-preservation**. Mempool flows squash output data immediately into maps. Confirmed flows proxy node-provided arrays verbatim. Any cross-cutting concern (like tracking a specific coin's movement) must reconcile these two formats.

See also:
- /wiki/code-analysis/address/flow.full.md — the address page lists per-tx rows via `FillAddressTransactions` and shares the multi-coin `{{if eq .CoinType 0}}` render idiom (address links upstream with `depends-on`).
- /wiki/core/constraints.md (depends-on: C1 numeric precision & bifurcation; C2 dual pipeline mutation; C3 template + WebSocket parity; C4 perimeter flattening & array stability; shares-pattern-with: C8 dual-transport shape asymmetry — mempool `SKATotals` aggregation vs confirmed verbatim `Vout` array)
- /wiki/code-analysis/mempool/impact.md (depends-on: "Dual collection path divergence (batch vs incremental)" — per-tx `SKATotals`/fee construction differs between `mempoolTxns` and `TxHandler`)
