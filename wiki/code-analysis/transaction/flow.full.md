### 1. Overview

This trace documents the end-to-end transaction flow through the Monetarium Explorer, comparing unconfirmed (mempool) transactions against confirmed (block-persisted) transactions. The system exhibits heavy architectural divergence and duplicated multi-coin (VAR/SKA) parsing logic depending on the transaction's confirmation state. As of the current HEAD, SSFee (Stake Fee) transactions have their own rendering path with a semantically overloaded `FeeRaw` field that holds a *net reward* rather than a fee.

#### Core Invariant

A transaction is strictly single-coin.

- A transaction belongs to exactly one CoinType
- Inputs and outputs cannot mix coins
- Multi-coin support exists at the system level, not transaction level

### 2. End-to-End Data Flow

**Mempool (Unconfirmed) Flow:**
Node RPC (tx notification) → `mempoolmonitor` fetches raw hex → `txhelpers.MsgTxFromHex` (Go memory) → `txhelpers.SKATotalsFromMsgTx` (sums the transaction's single-coin outputs) → `explorertypes.MempoolTx.SKATotals` (map[uint8]string) → WebSocket → JS Controller clones `<template>` → Javascript formats `ska_totals` to UI.

For ticket purchase txs (`TxTypeSStx`): both `DataCollector` and `MempoolMonitor` additionally call `ticketStage(vin, txnsStore)` → sets `MempoolTx.TicketStage` ("Ready"/"Staging"), surfaced in the mempool Tickets table.

**Confirmed Flow:**
Postgres block height update → UI requests `GetAPITransaction` → `pgblockchain` queries Node RPC `GetRawTransactionVerbose` → Node maps `CoinType` and `SKAValue` into `Vout` array → `apitypes.TxShort` wraps array → Server renders `tx.tmpl`, which branches per tx type and `$.Data.CoinType` for display.

**Fee/Reward Display Path (tx.tmpl):**
- Coinbase or Vote: label = "Fee Reward", value = `.FeeReward()` — a VAR-only float64 method (outputs − consumed inputs, stakebase excluded for votes)
- SSFee (Stake Fee): label = "Fee Reward", value = `coinDecimalParts .FeeRaw .CoinType` — `.FeeRaw` holds `ssFeeNetReward()` (Σoutputs − Σinputs, big.Int), supports both VAR and SKA
- Regular VAR tx: label = "Fee", value = `float64AsDecimalParts .Fee.ToCoin`
- Regular SKA tx: label = "Fee", value = `skaDecimalParts .FeeRaw`

The confirmed page is server-rendered once; it does **not** live-update over WebSocket.

### 3. Per-Layer Breakdown

**Mempool Ingestion & Aggregation**

- **Location:** `mempool/monitor.go`, `mempool/collector.go`, `txhelpers/txhelpers.go`
- **Data Structures:** `wire.MsgTx`, `explorertypes.MempoolTx` (fields: `TxID string` (JSON: `"txid"`), `SKATotals map[uint8]string`, `TicketStage string`). The `Hash` field was **removed** (it was a duplicate of `TxID`); all dedup maps and identity checks now use `TxID`. The JSON wire format no longer includes a `"hash"` key.
- **Transformations Applied:** Raw transaction hex is decoded into `wire.MsgTx`. Outputs are summed for the tx's CoinType into `SKATotals` using `*big.Int` arithmetic. SKA amount parse errors in `ParseTxns()` now log an error and skip the coin type (previously silent). For `TxTypeSStx` ticket purchases, `ticketStage()` inspects each vin's parent in `txnsStore`: if any parent `BlockHeight == 0` (still in mempool), returns "Staging"; all confirmed → "Ready". Both `DataCollector.processTransaction` and `MempoolMonitor.processTransaction` set `TicketStage`. The `mpoolInfo` field in `MempoolMonitor` was narrowed from `MempoolInfo` to `CollectState` (tracking only `CurrentHeight`, `LastCollectTime`, `NumTicketPurchasesInMempool` — no longer tracks `NumTicketsSinceStatsReport`). `StoreMPData` goroutine now has panic recovery. `BlockHandler()` now propagates errors from `CollectAndStore()`.

**Confirmed Database & API — Basic Construction**

- **Location:** `db/dcrpg/pgblockchain.go` (`makeExplorerTxBasic`, `trimmedTxInfoFromMsgTx`)
- **Data Structures:** `chainjson.TxRawResult`, `explorertypes.TxBasic` (fields: `FeeRaw string`, `FeeRateRaw string`)
- **Transformations Applied:** `makeExplorerTxBasic` now populates both `FeeRaw` and `FeeRateRaw` for VAR regular txs and sets them to "0" for coinbase. `trimmedTxInfoFromMsgTx` handles SKA fee/rate computation inline (big.Int arithmetic) — this was previously a post-loop in `GetExplorerBlock` but is now co-located. The result is a `TrimmedTxInfo` with `FeeRaw`, `FeeRateRaw`, `Voted`, `CoinType`, and `SSFeeMarker`.

**Confirmed Database & API — SSFee Specialization**

- **Location:** `db/dcrpg/pgblockchain.go` (`GetExplorerBlock`, `GetExplorerTx`, `ssFeeNetReward`)
- **Data Structures:** `explorertypes.TxBasic.FeeRaw string` (semantically overloaded: holds net reward for SSFee, fee for others), `TrimmedTxInfo.SSFeeMarker string` ("SF"/"MF")
- **Transformations Applied:** For `TxTypeSSFee` txs, both `GetExplorerBlock` and `GetExplorerTx` scan `msgTx.TxOut` to find the first output with `CoinType.IsSKA()` (TxOut[0] may be a CoinType-0 marker), set `tx.CoinType`, call `ssFeeNetReward(msgTx)` (Σoutputs − Σinputs via `out.SKAValue`/`vin.SKAValueIn`, big.Int, ≥ 0), and store the result in `tx.FeeRaw`. `GetExplorerBlock` additionally detects the `stake.SSFeeMarker` (SF=staker, MF=miner) via `stake.HasSSFeeMarker(out.PkScript)` and stores it in `stx.SSFeeMarker`.
- **Critical:** `ssFeeNetReward` (`pgblockchain.go`) explicitly mirrors `blockSSFeeTotalsInternal` in `txhelpers/ssfee.go`. These are two independent implementations of the same formula — they must stay in sync manually.

**Confirmed Database & API — Transaction Page**

- **Location:** `db/dcrpg/pgblockchain.go` (`GetExplorerTx`), `api/types/apitypes.go`
- **Data Structures:** `chainhash.Hash`, `chainjson.TxRawResult`, `apitypes.TxShort`, `apitypes.Vout`
- **Transformations Applied:** For `/tx/{txid}`, the DB does not reconstruct outputs from Postgres. It queries the `dcrd` node for verbose JSON; the node parses coins and outputs them into a raw `Vout` slice, copied directly to `apitypes.TxShort.Vout[i].CoinType` and `SKAValue`.

**Frontend Rendering Boundaries**

- **Location:** `cmd/dcrdata/views/tx.tmpl`, `cmd/dcrdata/views/home_mempool.tmpl`, `cmd/dcrdata/public/js/controllers/homepage_controller.js`
- **Data Structures:** WebSocket JSON (`TrimmedMempoolTx`), Template Data (`explorertypes.TxInfo`)
- **Transformations Applied:**
  - The mempool relies on Javascript checking `if (tx.ska_totals)` and formatting it live. `homepage_controller.js` now reads `tx.txid` (not `tx.hash`) for link construction and `humanize.hashElide` display.
  - `home_mempool.tmpl` renders hash cells using `.TxID` (not `.Hash`) in the `hashlink` template call.
  - The confirmed view uses a four-way branch for the fee/reward header cell (see Section 2 "Fee/Reward Display Path").
  - Fee rate display unified: `coinFeeRateDecimalParts .FeeRateRaw .CoinType` + `coinFeeRateUnit .CoinType` (replaces the old `.FeeRate`/`FeeRateRaw` split).
  - Vin rows: stakebase inputs now render "N/A" via `.IsStakeBase()` check (not just `AmountIn < 0`). This makes the Inputs Consumed table consistent with `.FeeReward()` which also skips stakebase.
  - Coinbase type label shows "Miner Reward" (was "PoW Reward", renamed from raw `.Type`).
  - USD conversion (`$conv`) blocks removed from tx page summary header.
  - `TicketInfo.PoolStatus` displayed on revocation pages.

### 4. Cross-Layer Dependencies

- The REST API and confirmed UI are heavily coupled to the underlying node's verbose JSON structure (`chainjson`). Changes to how the node exposes multi-coins immediately affect the explorer.
- The mempool UI is directly coupled to `txhelpers.SKATotalsFromMsgTx`. It depends entirely on the Go backend replicating node decoding logic accurately in memory.
- `FeeRaw` is used by two incompatible callers: the normal fee path (inputs − outputs, ≥ 0) and the SSFee reward path (outputs − inputs, ≥ 0). The template must branch on `IsSSFee()` before rendering or it will display a reward as a fee (or vice-versa).
- `ssFeeNetReward` in `pgblockchain.go` duplicates `blockSSFeeTotalsInternal` in `txhelpers/ssfee.go`. Changing one without the other causes the block page (which calls `ssFeeNetReward`) and any txhelpers-level caller to disagree.
- The Stimulus Javascript controllers handle the live mempool single-coin total (`ska_totals`); confirmed SKA transactions are rendered server-side by `tx.tmpl`. The two render paths are independent and must be kept coin-consistent (C3).
- `ticketStage()` logic lives independently in both `mempool/collector.go` and `mempool/monitor.go` — they call the same function, so a single-site change to `ticketStage()` covers both paths.
- **Tx type string canonical location:** All `TxType*` string constants (`TxTypeVote`, `TxTypeTicket`, `TxTypeSSFee`, etc.) now live exclusively in `txhelpers/txhelpers.go` (exported `string` vars). The local duplicates in `explorertypes.go` were removed; only `CoinbaseTypeStr` remains there (coinbase has no counterpart in the stake package). All `TxInfo.Is*()` methods compare against `txhelpers.TxTypeXxx`. Adding a new tx type string must go into `txhelpers`, not `explorertypes`.
- **`MempoolInfo.DeepCopy()` completeness:** Now copies `Ident` and `CoinFills` fields — previously omitted, which silently dropped these from WS broadcast copies. Any future additions to `MempoolInfo` must be added to `DeepCopy()` or they will be dropped in broadcast.
- **`HomeInfo` new fields:** `WindowRemaining string` and `RewardRemaining string` added (JSON: `"window_remaining"`, `"reward_remaining"`). Populated in `pubsubhub.go:Store()` via `exptypes.RemainingWindowText(idx, max, blockTime)`. WS clients reading `HomeInfo` now receive pre-formatted time-remaining text for both windows.

### 5. Critical Constraints

- **Precision Rules (C1):** Multi-coin SKA values use 18 decimal places and must traverse the stack as `*big.Int` or `string`. `ssFeeNetReward` uses `out.SKAValue` (*big.Int) directly — never float. `FeeReward()` on `TxInfo` is VAR-only float64 and must never be called for SKA txs. As of HEAD=1bc57372, `FeeReward()` enforces this defensively: it returns `0` immediately if `CoinType != 0` — callers see a silent 0, not a precision-corrupted value. SKA tx fee display must use `skaDecimalParts .FeeRaw` or `coinDecimalParts .FeeRaw .CoinType`.
- **`FeeRaw` semantic overload:** For SSFee txs, `FeeRaw` = Σoutputs − Σinputs (net reward, ≥ 0). For regular txs, `FeeRaw` = Σinputs − Σoutputs (fee, ≥ 0). The sign convention is opposite. Template MUST branch on `IsSSFee()` before rendering.
- **`UnspentOutputIndices()` SKA fix:** Prior to HEAD=1bc57372, the function excluded all vouts with `Amount == 0.0` — which incorrectly excluded every SKA output (VAR amount is always 0 for SKA txs). Now correctly: skip `Spent` vouts first, then skip only vouts where `SKAValue == "" && Amount == 0.0` (genuinely zero-value). Callers written against old behavior that added SKA-specific workarounds should be reviewed.
- **Divergent Source of Truth (C2):** Confirmed data trusts the node's RPC parsing. Mempool data trusts `txhelpers` internal parsing.
- **Dual implementation of ssFeeNetReward:** `pgblockchain.go:ssFeeNetReward` and `txhelpers/ssfee.go:blockSSFeeTotalsInternal` are independent. Any protocol change that affects SSFee output structure requires updating both.
- **Missing WebSocket Events:** Confirmed transactions are not broadcast via WebSockets with full datasets; clients are only pinged a `sigNewBlock` signal.
- **Per-coin render branch (C3):** `tx.tmpl` amount cells branch on `$.Data.CoinType` — SKA uses the precise `.ValueRaw` decimal string via `skaDecimalParts`; only the VAR branch uses the float64 `.Amount`/`float64AsDecimalParts` path. Breaking or bypassing this branch silently corrupts SKA precision.
- **`MiningFee` scope:** Block header fee total now only counts regular-tree txs and ticket purchases (`block.Tx + block.Tickets`). Votes, revocations, and treasury are excluded. The SQL chart query `internal.SelectFeesPerBlockAboveHeight` must mirror this definition (issue #405).

### 6. Mutation Impact

When modifying **transaction data structures or multi-coin logic**, check ALL of the following:

- **Direct dependencies:** `apitypes.Vout`, `apitypes.TxShort`, `explorertypes.MempoolTx`, `explorertypes.TxBasic`, `explorertypes.TrimmedTxInfo`
- **Indirect dependencies:** `txhelpers.SKATotalsFromMsgTx`, `pgblockchain.GetRawTransactionVerbose`, `ssFeeNetReward`, `txhelpers/ssfee.go:blockSSFeeTotalsInternal`
- **Serialization boundaries:** The `TrimmedMempoolTx` WebSocket schema.
- **Rendering layers:** `tx.tmpl` fee/reward cell branches on both `IsSSFee()` and `CoinType`; a new coin-dependent field must extend all relevant branches. The live mempool path (`homepage_controller.js` + `home_mempool.tmpl`) is separate and must be updated in parallel.
- **`FeeRaw` users:** Any code that reads `TxBasic.FeeRaw` must know whether the tx is SSFee (net reward) or regular (fee). Adding a new caller that treats `FeeRaw` as always-a-fee will misread SSFee txs.

**Silently breaks:** Changing SSFee detection logic (e.g. `CoinType.IsSKA()` scan) without updating both `GetExplorerBlock` and `GetExplorerTx` leaves one page showing the correct coin/reward and the other showing 0 or wrong coin.

**Silently breaks:** Adding a new fee-consuming field to `GetExplorerBlock`'s `MiningFee` total without updating `internal.SelectFeesPerBlockAboveHeight` creates a chart/header divergence (silent, no compile error).

**Fails loudly:** Altering `apitypes.Vout` JSON tags breaks downstream API clients instantly.

### 7. Common Pitfalls

- Treating `FeeRaw` as always-a-fee: for SSFee txs it is a net reward (outputs − inputs). Always check `IsSSFee()` before interpreting.
- Updating `MempoolTx` and expecting the REST API (`TxShort`) to inherit the change. They are entirely disconnected structs.
- Assuming confirmed transactions stream over WebSockets to update the `tx/{txid}` page dynamically.
- Modifying `ssFeeNetReward` in `pgblockchain.go` without applying the same change to `txhelpers/ssfee.go:blockSSFeeTotalsInternal` (or vice-versa).
- Adding a new SSFee rendering field to `GetExplorerBlock` but not `GetExplorerTx` (block page and tx page have independent SSFee specialization blocks).
- Routing coinbase/vote fee reward through `coinDecimalParts` instead of `float64AsDecimalParts .FeeReward` — they are different code paths; coinbase/vote is VAR-only float, SSFee can be VAR or SKA big.Int.
- Assuming `ticketStage` is only in `collector.go`: `monitor.go` has a parallel call site.
- Parsing the transaction's coin data using only the legacy `.Amount` (float64) field.
- Accessing `MempoolTx.Hash` — the field was removed; use `TxID` (JSON key `"txid"`). Any JS, stored JSON, or Go code that referenced the `"hash"` key on a mempool tx object will silently receive `undefined`/zero-value.
- Expecting `FeeReward()` to fail visibly on SKA txs — it now returns `0` silently (defensive guard at `explorertypes.go:497`). Callers must use `FeeRaw` + `CoinType` path for SKA.
- Defining new tx-type comparison strings in `explorertypes.go` — canonical strings live in `txhelpers/txhelpers.go` (exported vars `TxTypeVote`, `TxTypeTicket`, etc.). Adding a duplicate locally creates two constants that can drift.
- Adding fields to `MempoolInfo` without updating `DeepCopy()` — fields not copied there will be silently dropped from WS broadcasts.

### 8. Evidence

- **Mempool Decoding:** `mempool/monitor.go` — `txhelpers.MsgTxFromHex(rawTx.Hex)`
- **Mempool SKA extraction:** `mempool/collector.go` — `SKATotals: txhelpers.SKATotalsFromMsgTx(msgTx)`
- **TicketStage computation:** `mempool/collector.go:ticketStage()` and `mempool/monitor.go` (parallel call site) — "Staging" if any vin parent has `BlockHeight == 0` in `txnsStore`, else "Ready"
- **FeeRaw + FeeRateRaw in basic builder:** `db/dcrpg/pgblockchain.go:makeExplorerTxBasic` — sets `FeeRaw` and `FeeRateRaw` for VAR and coinbase; `trimmedTxInfoFromMsgTx` handles SKA via inline big.Int arithmetic
- **ssFeeNetReward function:** `db/dcrpg/pgblockchain.go:ssFeeNetReward` — `net = Σ(out.SKAValue or out.Value) − Σ(vin.SKAValueIn or vin.ValueIn)`, skipping coinbase-marker inputs
- **SSFee specialization in GetExplorerBlock:** `db/dcrpg/pgblockchain.go` — scans TxOut for first `CoinType.IsSKA()` output, sets `CoinType`, calls `ssFeeNetReward`, detects `stake.HasSSFeeMarker` for SF/MF
- **SSFee specialization in GetExplorerTx:** `db/dcrpg/pgblockchain.go` — mirrors block path: scans TxOut, sets `tx.CoinType`, sets `tx.FeeRaw = ssFeeNetReward(msgTx).String()`
- **FeeReward() method:** `explorer/types/explorertypes.go:496` — VAR-only float64: returns 0 early if `CoinType != 0` (SKA guard at line 497), then Σvout.Amount − Σvin.AmountIn (skips stakebase, skips negative AmountIn)
- **IsSSFee() method:** `explorer/types/explorertypes.go:TxInfo.IsSSFee()` — `t.Type == txhelpers.TxTypeSSFee` (no longer a local constant; all Is*() methods now use `txhelpers.TxTypeXxx` vars)
- **tx.tmpl fee/reward branch (line 88–92):** `cmd/dcrdata/views/tx.tmpl` — label: `{{if or .Coinbase .IsVote .IsSSFee}}Fee Reward{{else}}Fee{{end}}`; value: 4-way branch on `Coinbase/IsVote` → `float64AsDecimalParts .FeeReward`, `IsSSFee` → `coinDecimalParts .FeeRaw .CoinType`, VAR → `.Fee.ToCoin`, SKA → `skaDecimalParts .FeeRaw`
- **Stakebase vin N/A:** `cmd/dcrdata/views/tx.tmpl:486` — `{{if or (lt .AmountIn 0.0) .IsStakeBase}} N/A {{else}}...{{end}}`
- **Fee rate unified display:** `cmd/dcrdata/views/tx.tmpl:233` — `{{template "decimalParts" (coinFeeRateDecimalParts .FeeRateRaw .CoinType false)}} {{coinFeeRateUnit .CoinType}}`
- **MiningFee scope:** `db/dcrpg/pgblockchain.go` — `block.MiningFee = (getTotalFee(block.Tx) + getTotalFee(block.Tickets)).ToCoin()`
- **Confirmed API Node usage:** `db/dcrpg/pgblockchain.go` — `pgb.Client.GetRawTransactionVerbose`
- **Per-coin output rendering:** `cmd/dcrdata/views/tx.tmpl:559` — `{{if eq $.Data.CoinType 0}}{{float64AsDecimalParts .Amount 8 false}}{{else}}{{skaDecimalParts .ValueRaw false}}{{end}}`
- **Mempool UI Logic:** `cmd/dcrdata/public/js/controllers/homepage_controller.js` — `mempoolTableRow(tx)` reads `tx.txid` (not `tx.hash`) at lines 26, 45; handles `ska_totals` via DOM templates
- **home_mempool.tmpl hash cell:** `cmd/dcrdata/views/home_mempool.tmpl:120` — `hashlink .TxID (print "/tx/" .TxID)` (not `.Hash`)
- **MempoolTx struct (Hash removed):** `explorer/types/explorertypes.go:1473` — `Hash string` field gone; canonical field is `TxID string json:"txid"` at line 1474
- **UnspentOutputIndices SKA fix:** `explorer/types/explorertypes.go:1751` — now checks `vout.SKAValue == "" && vout.Amount == 0.0` (SKA vouts have Amount==0; were incorrectly excluded before)
- **addAtomStrings hardened:** `mempool/monitor.go:656` — uses `strconv.ParseInt` for VAR (explicit error) and checks `big.Int.SetString` ok flag explicitly for SKA; logs warnings on bad input
- **HomeInfo window fields:** `explorer/types/explorertypes.go:911,913` — `WindowRemaining string json:"window_remaining"`, `RewardRemaining string json:"reward_remaining"`; populated in `pubsub/pubsubhub.go:733-734`
- **TxType constants canonical home:** `txhelpers/txhelpers.go:1185-1194` — `TxTypeVote`, `TxTypeTicket`, `TxTypeRevocation`, `TxTypeSSFee`, etc. are the single source of truth; `explorertypes.go` retains only `CoinbaseTypeStr` (no stake-package counterpart)

### 9. Compact Knowledge (LLM-Optimized)

- **One-line Flow:** Mempool txs are decoded in Go (`txhelpers`) into a single coin total (`MempoolTx.SKATotals`); confirmed txs proxy Node RPC (`GetRawTransactionVerbose`) verbatim into array slices (`TxShort.Vout[]`); SSFee txs additionally trigger `ssFeeNetReward()` to populate `FeeRaw` with a net reward (Σout − Σin, ≥ 0).
- **Key Architectural Patterns:**
  1. **Structural Bifurcation:** Mempool = struct maps; Confirmed = property-injected array slices.
  2. **`FeeRaw` semantic overload:** For SSFee txs `FeeRaw` = net reward (outputs − inputs); for regular txs `FeeRaw` = fee (inputs − outputs). Same field, opposite sign convention; template MUST branch on `IsSSFee()`.
  3. **Dual ssFeeNetReward implementations:** `pgblockchain.go:ssFeeNetReward` mirrors `txhelpers/ssfee.go:blockSSFeeTotalsInternal` — independent; must stay in sync.
  4. **TicketStage:** Mempool ticket purchases classified "Ready"/"Staging" by both `collector.go` and `monitor.go` (parallel call sites for same `ticketStage()` function).
- **Critical Constraints:**
  - `FeeReward()` on `TxInfo` is VAR-only float64 (coinbase/vote); SSFee uses `coinDecimalParts .FeeRaw .CoinType` (supports VAR and SKA big.Int). Never call `FeeReward()` for SKA txs.
  - SKA amounts must stay `*big.Int`/string end-to-end. `tx.tmpl` amount cells branch on `$.Data.CoinType 0` — VAR via `float64AsDecimalParts .Amount`, SKA via `skaDecimalParts .ValueRaw`. A new coin-dependent field must extend **both** branches.
  - `MiningFee` in block header = `Tx + Tickets` only (no votes/revocations/treasury); the SQL chart query must mirror this definition.
- **Mutation Checklist:**
  - [ ] Does your change affect `FeeRaw`? — verify SSFee vs regular tx distinction is preserved
  - [ ] Did you update `apitypes.Vout` / `apitypes.TxShort` (Confirmed)?
  - [ ] Did you update `explorertypes.MempoolTx` (Unconfirmed)?
  - [ ] SSFee path: did you update BOTH `GetExplorerBlock` and `GetExplorerTx`?
  - [ ] `ssFeeNetReward` change: did you mirror it in `txhelpers/ssfee.go:blockSSFeeTotalsInternal`?
  - [ ] Are changes reflected in `homepage_controller.js`?
  - [ ] Are changes reflected in `cmd/dcrdata/views/tx.tmpl` (all four fee/reward branches)?

See also:
- /wiki/code-analysis/address/flow.full.md — the address page lists per-tx rows via `FillAddressTransactions` and shares the multi-coin `{{if eq .CoinType 0}}` render idiom
- /wiki/core/constraints.md (depends-on: C1 numeric precision & bifurcation; C2 dual pipeline mutation; C3 template + WebSocket parity; C4 perimeter flattening & array stability; C8 dual-transport shape asymmetry)
- /wiki/code-analysis/mempool/impact.md (depends-on: "Dual collection path divergence" — per-tx `SKATotals`/fee construction differs between `mempoolTxns` and `TxHandler`)
