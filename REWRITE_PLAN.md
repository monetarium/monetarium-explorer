# Monetarium Explorer — Rewrite Plan

## Notes
- **Every task is a separate commit.**
- **Frontend tasks (7, 8): bare minimum for compatibility only — no polish.**

---

## Problem Statement
Rewrite `monetarium-explorer` (a `dcrdata` fork targeting Decred/`master`) to be
compatible with `monetarium-node/main`, which introduces a dual-coin system
(VAR + up to 255 SKA types) with big.Int precision for SKA amounts, new wire
protocol (versions 12 & 13), new chain params, and new RPC types.

---

## Background: master vs main differences in monetarium-node

| Area | master (Decred upstream) | main (Monetarium fork) |
|---|---|---|
| Module paths | `github.com/decred/dcrd/...` with version suffixes (`/v3`, `/v4`, etc.) | `github.com/monetarium/monetarium-node/...` no version suffixes |
| Coin model | Single coin DCR, int64 atoms | VAR (int64, 1e8 atoms/coin) + SKA-1..255 (big.Int, 1e18 atoms/coin) |
| `TxOut` | `Value int64`, no coin type | `Value int64` (VAR) or variable-length big.Int (SKA) + `CoinType uint8` |
| Wire protocol | v12 | v12 (DualCoinVersion) + v13 (SKABigIntVersion) |
| `FeesByType` | n/a | `map[CoinType]*big.Int` |
| Chain params | Decred mainnet | Monetarium mainnet: port 9508, prefix `M`, genesis 2026-02-24, no treasury, no DNS seeds |
| `SKACoins` in Params | n/a | Map of SKACoinConfig per type (supply, emission height/window, addresses, keys) |
| RPC fee types | `float64` amounts | String-encoded atoms for full big.Int precision |
| Network magic | Decred values | `MainNet=0x4d4e5401`, `TestNet3=0x4d4e5403`, `SimNet=0x4d4e5404` |

---

## Critical Parsing Path Analysis

The import pipeline flows:


SyncChainDB (sync.go)
 └─ importBlocks loop
      ├─ rpcutils.GetBlock → wire.MsgBlock via RPC
      ├─ stakeDB.ConnectBlock
      └─ StoreBlock (pgblockchain.go)
           ├─ dbtypes.MsgBlockToDBBlock
           └─ storeBlockTxnTree ×2 (goroutines: regular + stake)
                └─ dbtypes.ExtractBlockTransactions
                     └─ processTransactions  ← ALL coin-type bugs here
                          ├─ spent += txin.ValueIn        (int64, ignores CoinType)
                          ├─ sent  += txout.Value         (int64, SKA big.Int TRUNCATED)
                          ├─ fees   = spent - sent        (meaningless cross-coin)
                          ├─ Vout.Value = uint64(txout.Value)  (SKA precision lost)
                          └─ Mixed: mixDenom == txout.Value    (wrong for SKA)

Post-sync `updateSpendingInfoInAllAddresses` operates on the already-corrupted
`Value` fields, so damage propagates into the addresses table.

Also broken:
- `txhelpers.FeeRateInfoBlock` — iterates all TxOut.Value as int64
- `txhelpers.OutPointAddresses` — returns `dcrutil.Amount` (VAR only)
- `blockdata.CollectBlockInfo` — no SKA coin totals collected
- `rpcutils.ConnectNodeRPC` — wrong semver list, possibly wrong API version key
- `insight/apiroutes.go` line ~492 — `dcrutil.Amount(txOut.Value).ToCoin()` ignores CoinType

---

## Requirements (from MAIN_MANIFEST.md)

- Up to 255 SKA coin types; VAR uses 8 decimals, SKA uses 18 decimals
- All SKA backend calculations use big.Int via `cointype.SKAAmount`
- Homepage amounts: 3 significant figures with K/M/B/T suffixes
- Detail pages: full decimal precision
- Mobile-first UI, dark theme support
- Latest Blocks table: expandable rows (VAR row + SKA-n rows per block)
- Mempool: per-coin vertical fill bars (VAR=10%, 90% split among active SKA types)
- Voting section: VAR reward + per-SKA reward blocks
- Mining section: PoW VAR reward + PoW SKA reward
- Supply section replaces Distribution: VAR supply + per-SKA (circulating/issued/burned)

---

## Task Breakdown

### Task 1: Dependency migration & build baseline
**Commit:** `chore: migrate all imports to monetarium-node modules`

**Objective:** Replace all `github.com/decred/dcrd/...` imports with
`github.com/monetarium/monetarium-node/...` equivalents. Update `netparams`
to Monetarium ports and chain params.

**Guidance:**
- Find-and-replace module paths in `go.mod` and all `.go` files
- Remove version suffixes: `chaincfg/v3` → `chaincfg`, `rpcclient/v8` → `rpcclient`, etc.
- Update `netparams/netparams.go`: ports 9508/9509/9510, use `chaincfg.MainNetParams()`
- Update root `go.mod` module path: `github.com/decred/dcrdata/v8` → `github.com/monetarium/monetarium-explorer`
- Fix any API breakage from removed version suffixes (method signature changes)

**Test:** `go build ./...` passes with zero import errors.

**Demo:** Project compiles against monetarium-node modules.

---

### Task 2: CoinType-aware transaction parsing (critical path)
**Commit:** `fix: coin-type-aware parsing in processTransactions and txhelpers`

**Objective:** Fix every place in the parsing pipeline that reads `txout.Value`
or `txin.ValueIn` without considering `CoinType`, so VAR and SKA amounts are
correctly separated and SKA big.Int values are never truncated.

**Guidance:**

`db/dbtypes/extraction.go` — `processTransactions`:
- Replace `var spent, sent int64` with `spentByType, sentByType map[cointype.CoinType]*big.Int`
- For VAR outputs: accumulate as int64 (safe); for SKA: use `cointype.SKAAmount`
- `fees` becomes per-coin: `feesByType map[cointype.CoinType]*big.Int`
- Add `CoinType uint8` and `SKAValue string` (atoms as decimal string) to `Vout` and `Tx` db structs
- `Mixed` check (`mixDenom == txout.Value`) must guard `txout.CoinType == cointype.CoinTypeVAR`
- Keep existing `Spent`/`Sent`/`Fees` int64 fields on `Tx` for VAR only (backward compat with stake txs)

`txhelpers/txhelpers.go`:
- `FeeRateInfoBlock`: scope to VAR outputs only (`txout.CoinType == cointype.CoinTypeVAR`)
- `OutPointAddresses`: add `coinType cointype.CoinType` to return; for SKA return amount as string
- `valsIn[inIdx] = txOut.Value` (line ~502): guard to VAR only; SKA inputs tracked separately

`blockdata/blockdata.go` — `CollectBlockInfo`:
- Add `SKACoinAmounts map[uint8]string` to `BlockExplorerExtraInfo`
- After fetching `msgBlock`, iterate `msgBlock.Transactions`, group `TxOut` by `CoinType`,
  accumulate per-coin totals (VAR int64, SKA big.Int), store as decimal strings

`rpcutils/rpcclient.go`:
- Update `compatibleChainServerAPIs` semver list to monetarium-node's API version
- Check whether `Version()` response key is still `"dcrdjsonrpcapi"` or renamed

**Test:** Unit tests for `processTransactions` with synthetic blocks:
- (a) VAR-only transactions
- (b) SKA-1 transactions with amounts exceeding int64 max
- (c) Mixed VAR + SKA-1 block

Assert: per-coin fees/sent/spent correct, SKA values not truncated, VAR unaffected.

**Demo:** A block with both VAR and SKA-1 outputs is parsed without data loss;
per-coin totals are correct.

---

### Task 3: Multi-coin db types & data models
**Commit:** `feat: extend db/api/explorer types for per-coin amounts`

**Objective:** Extend db structs and API/explorer types to carry per-coin amounts.

**Guidance:**
- Add `CoinType uint8`, `SKAValue string` to `dbtypes.Vout` and `dbtypes.Tx`
- Add `CoinAmounts map[uint8]string` to `apitypes.BlockDataBasic`,
  `apitypes.BlockExplorerExtraInfo`, `exptypes.BlockInfo`
- Add formatting helpers: `FormatVARAmount(int64) string` (3-sig-fig / full),
  `FormatSKAAmount(string, *big.Int) string`
- Keep existing `DCR`/`Amount` float64 fields as VAR for backward compat

**Test:** JSON marshal/unmarshal round-trip for structs with SKA amounts
(verify no float64 precision loss on big.Int strings).

**Demo:** Block and tx data structs carry both VAR and SKA-n amounts without loss.

---

### Task 4: blockdata collector & RPC compatibility
**Commit:** `feat: multi-coin blockdata collector and RPC handshake`

**Objective:** Wire per-coin totals from Task 2 into `BlockData`; confirm RPC
client connects to monetarium-node.

**Guidance:**
- `NodeClient` interface: `GetCoinSupply` stays VAR-only (returns `dcrutil.Amount`)
- Add `GetSKACoinAmounts` if node exposes an RPC for it; otherwise derive from block data
- Populate `BlockData.ExtraInfo.SKACoinAmounts` from `CollectBlockInfo`
- Verify `ConnectNodeRPC` handshake succeeds against a running monetarium-node

**Test:** Integration test with mock RPC returning a multi-coin block response.

**Demo:** Collector produces correct per-coin totals for a test block.

---

### Task 5: API routes & JSON responses
**Commit:** `feat: expose per-coin amounts in API responses`

**Objective:** Expose per-coin data in block/tx API responses.

**Guidance:**
- Update `apiroutes.go` block/tx endpoints to include `coin_amounts` field
- Fee endpoints: parse string-encoded atoms from new `GetFeeResult`/`GetMempoolFeesInfoResult`
  types (no float64 conversion)
- Remove or stub Decred-specific endpoints: treasury (`/api/treasury/...`),
  politeia (`/api/proposals/...`)
- Insight API (`insight/apiroutes.go`): `dcrutil.Amount(txOut.Value).ToCoin()` at line ~492
  must guard on `txout.CoinType == VAR`; SKA outputs need separate handling

**Test:** HTTP handler tests for `/api/block/{idx}` with multi-coin mock data.

**Demo:** `GET /api/block/1` returns both VAR and SKA-1 amounts in response JSON.

---

### Task 6: Explorer routes & template data
**Commit:** `feat: multi-coin data in explorer routes and template structs`

**Objective:** Update `explorerroutes.go` and template data structs to pass
multi-coin block data to templates.

**Guidance:**
- Add `CoinRows []CoinRowData` to block summary structs for expandable table:
  go
 type CoinRowData struct {
     CoinType uint8
     Symbol   string   // "VAR", "SKA-1", ...
     TxCount  int
     Amount   string   // formatted
     Size     uint32
 }
 
- Add mempool per-coin fill fields to MempoolInfo:
  CoinFills []CoinFillData with {Symbol, FillPct, Color}

- Remove/stub governance, treasury, politeia routes

**Test:** Template rendering test with multi-coin block data (0, 1, 2 SKA types).

**Demo:** Block detail page shows VAR and SKA amounts correctly.

---

### Task 7: Frontend — Latest Blocks table (bare minimum)
**Commit:** 
feat: minimal multi-coin Latest Blocks table


**Objective:** Render VAR and SKA amounts in the blocks table. No animation,
no polish — just correct data display.

**Guidance:**
- Add VAR and SKA columns to the existing blocks table template
- Expandable rows: toggle visibility of sub-rows on click (plain JS, no framework)
- Amount formatting: 3-sig-fig + K/M/B/T on main page; full decimals on detail pages
- Default state: collapsed

**Test:** Template renders without error for 0, 1, and 2 active SKA types.

**Demo:** Homepage table shows VAR and SKA-1 amounts; rows expand/collapse.

---

### Task 8: Frontend — Mempool & homepage sections (bare minimum)
**Commit:** 
feat: minimal per-coin mempool indicators and homepage sections


**Objective:** Show per-coin mempool fill and update Voting/Mining/Supply sections
with correct coin labels. No visual polish beyond functional correctness.

**Guidance:**

Mempool fill bars:
- One bar per coin in mempool; VAR=10%, SKA-n share remaining 90% equally
- Fill height = 
min(mempool_size / guaranteed_space, 1.0)  100%
- Color: green (fits), yellow (fits with borrowed space), red (won't all fit)

Voting/Mining/Supply:
- Rename Vote Reward
 → Vote VAR Reward; add Vote SKA-n Reward rows
- Rename POW Reward → PoW VAR Reward; add PoW SKA Reward rows
- Replace Distribution section with Supply
: VAR circulating + per-SKA issued/burned

**Test:** Fill percentage and color logic covered by JS unit tests.

**Demo:** Homepage loads with per-coin mempool bars and correct section labels.

---

### Task 9: Branding & cleanup
**Commit:** 
chore: replace Decred/dcrdata branding with Monetarium

**Objective:** Remove all remaining Decred/dcrdata references.

**Guidance:**
- Replace CoinbaseFlags = "/dcrd/"
 → "/monetarium-node/"
- Replace "DCR" string literals with "VAR" throughout templates and Go code
- Update Dockerfile: binary name, config paths
- Update .github/
workflows/build.yml and docker.yml
- Update README.md
- Verify: grep -r 'decred/dcrd\|dcrdata\|"DCR"' . returns no hits outside
  vendor/testdata

**Test:** Full go 
build ./... + go test ./...
 green.

**Demo:** Full build and smoke-test against a local monetarium-node simnet node;
homepage loads, blocks appear with VAR and SKA-1 data.



Task 10 (final): Complete SQL schema migration for multi-coin support
Commit: feat: complete SQL schema and Go code for multi-coin (VAR+SKA)

Objective: Add coin_type/ska_value to vouts, vins, addresses, swaps; add ska_fees to transactions; convert FLOAT8 price/reward to TEXT; update every Go struct, QueryRow 
argument list, and Scan call to match.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━


## 1. SQL DDL — db/dcrpg/internal/

### vinoutstmts.go

CreateVinTable — add after value_in INT8:
sql
coin_type INT2 NOT NULL DEFAULT 0,


CreateVoutTable — add after value INT8:
sql
coin_type INT2 NOT NULL DEFAULT 0,

Add after mixed BOOLEAN DEFAULT FALSE:
sql
ska_value TEXT,


insertVinRow — 11→12 params:
sql
value_in, coin_type, is_valid, is_mainchain, block_time, tx_type)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)


UpsertVinRow ON CONFLICT — shift $8,$9,$10 → $9,$10,$11:
sql
SET is_valid = $9, is_mainchain = $10, block_time = $11,
    prev_tx_hash = $4, prev_tx_index = $5, prev_tx_tree = $6


insertVoutRow — 8→10 params:
sql
INSERT INTO vouts (tx_hash, tx_index, tx_tree, value, coin_type,
    version, script_type, script_addresses, mixed, ska_value)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)


UpsertVoutRow ON CONFLICT — shift $5 → $6:
sql
SET version = $6 RETURNING id;


SelectUTXOs — add to SELECT:
sql
vouts.coin_type, vouts.ska_value


SelectVoutAddressesByTxOut — add to SELECT:
sql
SELECT id, script_addresses, value, mixed, coin_type, ska_value FROM vouts ...


SelectCoinSupply — add to WHERE:
sql
AND vins.coin_type = 0


### txstmts.go

CreateTransactionTable — add after fees INT8:
sql
ska_fees JSONB,


insertTxRow — 22→23 params, ska_fees at $15, all subsequent shift +1:
sql
-- columns: ..., fees, ska_fees, mix_count, mix_denom, ...
-- values:  ..., $14,  $15,      $16,       $17, ..., $22, $23


UpsertTxRow ON CONFLICT — shift $21,$22 → $22,$23:
sql
SET is_valid = $22, is_mainchain = $23 RETURNING id;


SelectFullTxByHash / SelectFullTxsByHash — add ska_fees to SELECT list after fees.

### addrstmts.go

CreateAddressTable — add after value INT8:
sql
coin_type INT2 NOT NULL DEFAULT 0,
ska_value TEXT,


insertAddressRow — 10→12 params (appended at end):
sql
INSERT INTO addresses (..., tx_type, coin_type, ska_value)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)


addrsColumnNames — add coin_type, ska_value.

SelectAddressSpentUnspentCountAndValue — add coin_type to SELECT and GROUP BY:
sql
SELECT (tx_type = 0) AS is_regular, coin_type, COUNT(*), SUM(value),
    is_funding, (matching_tx_hash IS NULL) AS all_empty_matching
FROM addresses WHERE address = $1 AND valid_mainchain
GROUP BY tx_type=0, coin_type, is_funding, matching_tx_hash IS NULL
ORDER BY count, is_funding;


### stakestmts.go

CreateTicketsTable — price FLOAT8 → price TEXT, fee FLOAT8 → fee TEXT

CreateVotesTable — ticket_price FLOAT8 → ticket_price TEXT, vote_reward FLOAT8 → vote_reward TEXT

SelectTicketsForPriceAtLeast/AtMost — price → price::NUMERIC

SelectTicketsByPrice / selectTicketsByPurchaseDate — price → price::NUMERIC

### swap.go

CreateAtomicSwapTable — add after value INT8:
sql
coin_type INT2 NOT NULL DEFAULT 0,


InsertContractSpend — 10→11 params, add coin_type as $11.

### treasury.go

Replace entire file:
go
package internal
// Treasury removed: monetarium-node has no treasury subsystem.


━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━


## 2. Go Structs — db/dbtypes/types.go

VinTxProperty — add:
go
CoinType uint8 `json:"coin_type"`


AddressRow — add:
go
CoinType uint8  `json:"coin_type"`
SKAValue string `json:"ska_value,omitempty"`


UTXOData — add:
go
CoinType uint8
SKAValue string


(Vout already has CoinType/SKAValue; Tx already has FeesByCoin ✓)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━


## 3. QueryRow argument fixes — db/dcrpg/queries.go

### insertVoutsStmt (~line 2053) — 8→10 args
go
err := stmt.QueryRow(
    vout.TxHash, vout.TxIndex, vout.TxTree, vout.Value, vout.CoinType,
    int32(vout.Version), vout.ScriptPubKeyData.Type,
    addressList(vout.ScriptPubKeyData.Addresses), vout.Mixed, vout.SKAValue).Scan(&id)

Also add to AddressRow population: CoinType: vout.CoinType, SKAValue: vout.SKAValue

### insertVinsStmt (~line 1930) — 11→12 args
go
err := stmt.QueryRow(vin.TxID, vin.TxIndex, vin.TxTree,
    vin.PrevTxHash, vin.PrevTxIndex, vin.PrevTxTree,
    vin.ValueIn, vin.CoinType, vin.IsValid, vin.IsMainchain, vin.Time, vin.TxType).Scan(&id)


### insertTxnsStmt (~line 2865) — 22→23 args
go
err := stmt.QueryRow(
    tx.BlockHash, tx.BlockHeight, tx.BlockTime,
    tx.TxType, int16(tx.Version), tx.Tree, tx.TxID, tx.BlockIndex,
    int32(tx.Locktime), int32(tx.Expiry), tx.Size, tx.Spent, tx.Sent, tx.Fees, dbtypes.ToJSONB(tx.FeesByCoin),
    tx.MixCount, tx.MixDenom,
    tx.NumVin, dbtypes.UInt64Array(tx.VinDbIds),
    tx.NumVout, dbtypes.UInt64Array(tx.VoutDbIds), tx.IsValid,
    tx.IsMainchainBlock).Scan(&id)


### insertAddressRowsDbTx (~line 1335) — 10→12 args
go
err := stmt.QueryRow(dbA.Address, dbA.MatchingTxHash, dbA.TxHash,
    dbA.TxVinVoutIndex, dbA.VinVoutDbID, dbA.Value, dbA.TxBlockTime,
    dbA.IsFunding, dbA.ValidMainChain, dbA.TxType, dbA.CoinType, dbA.SKAValue).Scan(&id)


### insertSpendingAddressRow (~line 2728) — 10→12 args
go
err := tx.QueryRow(sqlStmt, addrs[i], fundingTxHash, spendingTxHash,
    spendingTxVinIndex, vinDbID, value, blockTime, isFunding,
    mainchain && valid, txType, spentUtxoData.CoinType, spentUtxoData.SKAValue).Scan(&rowID)


━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━


## 4. Scan fixes — db/dcrpg/queries.go

### retrieveUTXOsStmt (~line 2445) — 6→8 scans
go
err = rows.Scan(&utxo.VoutDbID, &utxo.TxHash, &utxo.TxIndex, &addresses,
    &utxo.Value, &utxo.Mixed, &utxo.UTXOData.CoinType, &utxo.UTXOData.SKAValue)


### retrieveTxOutData (~line 2663) — 4→6 scans
go
err := tx.QueryRow(internal.SelectVoutAddressesByTxOut, txid, idx, tree).
    Scan(&data.VoutDbID, &addrArray, &data.Value, &data.Mixed, &data.CoinType, &data.SKAValue)


### scanAddressQueryRows (~line 1772) — 11→13 scans
go
err = rows.Scan(&id, &addr.Address, &addr.MatchingTxHash, &addr.TxHash, &addr.TxType,
    &addr.ValidMainChain, &txVinIndex, &addr.TxBlockTime, &vinDbID,
    &addr.Value, &addr.IsFunding, &addr.CoinType, &addr.SKAValue)


### retrieveDbTxByHash (~line 2956) — 22→23 scans

Scan ska_fees into a []byte, then unmarshal into FeesByCoin:
go
var skaFeesJSON []byte
err = db.QueryRowContext(ctx, internal.SelectFullTxByHash, txHash).Scan(&id,
    &dbTx.BlockHash, &dbTx.BlockHeight, &dbTx.BlockTime,
    &dbTx.TxType, &dbTx.Version, &dbTx.Tree, &dbTx.TxID, &dbTx.BlockIndex,
    &dbTx.Locktime, &dbTx.Expiry, &dbTx.Size, &dbTx.Spent, &dbTx.Sent,
    &dbTx.Fees, &skaFeesJSON, &dbTx.MixCount, &dbTx.MixDenom, &dbTx.NumVin, &vinDbIDs,
    &dbTx.NumVout, &voutDbIDs, &dbTx.IsValid, &dbTx.IsMainchainBlock)
if len(skaFeesJSON) > 0 {
    _ = json.Unmarshal(skaFeesJSON, &dbTx.FeesByCoin)
}


### retrieveDbTxsByHash (~line 3005) — same pattern as above inside rows.Next() loop.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━


## 5. pgblockchain.go — TreasuryBalance

go
func (pgb *ChainDB) TreasuryBalance(ctx context.Context) (*dbtypes.TreasuryBalance, error) {
    _, tipHeight := pgb.BestBlock()
    return &dbtypes.TreasuryBalance{Height: tipHeight}, nil
}


━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━


## 6. Migration — db/dcrpg/upgrades.go

sql
ALTER TABLE vins      ADD COLUMN IF NOT EXISTS coin_type INT2 NOT NULL DEFAULT 0;
ALTER TABLE vouts     ADD COLUMN IF NOT EXISTS coin_type INT2 NOT NULL DEFAULT 0;
ALTER TABLE vouts     ADD COLUMN IF NOT EXISTS ska_value TEXT;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS ska_fees JSONB;
ALTER TABLE addresses ADD COLUMN IF NOT EXISTS coin_type INT2 NOT NULL DEFAULT 0;
ALTER TABLE addresses ADD COLUMN IF NOT EXISTS ska_value TEXT;
ALTER TABLE swaps     ADD COLUMN IF NOT EXISTS coin_type INT2 NOT NULL DEFAULT 0;
ALTER TABLE tickets   ALTER COLUMN price TYPE TEXT USING price::TEXT;
ALTER TABLE tickets   ALTER COLUMN fee   TYPE TEXT USING fee::TEXT;
ALTER TABLE votes     ALTER COLUMN ticket_price TYPE TEXT USING ticket_price::TEXT;
ALTER TABLE votes     ALTER COLUMN vote_reward  TYPE TEXT USING vote_reward::TEXT;


━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━


Test: go build ./... green; fresh DB init succeeds; block sync with VAR+SKA outputs completes without any sql: expected N destination arguments or pq: got N parameters 
errors.

Demo: Full block import stores VAR and SKA-1 outputs correctly; address history, UTXO retrieval, and transaction lookups all return without scan errors.

> Task 11: Fix fatal error when treasury/subsidy address is absent
Commit: fix: allow empty OrganizationPkScript when no treasury

Objective: Remove the fatal startup error caused by DevSubsidyAddress failing on a nil OrganizationPkScript, which is the case for all monetarium-node network params.

Root cause: stdscript.ExtractAddrs called on a nil script returns 0 addresses. DevSubsidyAddress treats this as an error. pubsubhub.go treats that error as fatal. All 
other call sites already handle it as a warning.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━


db/dbtypes/extraction.go — DevSubsidyAddress:

Add a nil guard at the top so a missing org script is a valid no-treasury case, not an error:

go
func DevSubsidyAddress(params *chaincfg.Params) (string, error) {
    if len(params.OrganizationPkScript) == 0 {
        return "", nil
    }
    _, devSubsidyAddresses := stdscript.ExtractAddrs(
        params.OrganizationPkScriptVersion, params.OrganizationPkScript, params)
    if len(devSubsidyAddresses) != 1 {
        return "", fmt.Errorf("failed to decode dev subsidy address")
    }
    return devSubsidyAddresses[0].String(), nil
}


pubsub/pubsubhub.go — NewPubSubHub:

Change the fatal return to a warning, consistent with pgblockchain.go and explorer.go:

go
// before
devSubsidyAddress, err := dbtypes.DevSubsidyAddress(params)
if err != nil {
    return nil, fmt.Errorf("bad project fund address: %v", err)
}

// after
devSubsidyAddress, err := dbtypes.DevSubsidyAddress(params)
if err != nil {
    log.Warnf("NewPubSubHub: bad project fund address: %v", err)
}


━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━


No other call sites need changes:

| File | Behavior |
|---|---|
| db/dcrpg/pgblockchain.go:668 | already log.Warnf + continues |
| cmd/dcrdata/internal/explorer/explorer.go:345 | already log.Warnf + continues |
| cmd/dcrdata/config.go:573 | already sets NoDevPrefetch + continues |

Side effect: DevAddress in HomeInfo will be "". The address template guards {{if eq .Address $.DevAddress}} so an empty value never matches — correct behavior with no 
treasury.

Test: Start the explorer against a monetarium-node simnet; NewPubSubHub must succeed without error.

Demo: Explorer starts up cleanly; homepage loads with no treasury-related errors in the log.

Task 13: Fix or remove tests broken by Monetarium wire/chain migration
Commit: test: fix txhelpers and dbtypes tests for monetarium-node

Objective: The test suite has 8 failing tests, all caused by Decred-specific imports, wire-format test data, or hardcoded Decred chain values. Fix or remove each one.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━


### txhelpers/subsidy_test.go

TestUltimateSubsidy — hardcoded Decred subsidy totals. Either:
- Update expected values to Monetarium mainnet/testnet subsidy totals (compute from chaincfg.MainNetParams()), or
- Delete the test if UltimateSubsidy is not used in the Monetarium explorer

### txhelpers/txhelpers_test.go

- TestGenesisTxHash — expects Decred genesis tx hash. Update to Monetarium genesis tx hash, or delete.
- TestIsZeroHashP2PHKAddress — uses a Decred address (DsQxu...). Replace with a valid Monetarium address or delete.
- TestFeeRateInfoBlock / TestFeeInfoBlock — load block138883.bin (Decred block file). Delete or replace with a Monetarium block fixture.
- TestMsgTxFromHex — decodes a Decred-format transaction hex. Replace hex with a valid Monetarium transaction or delete.

### txhelpers/cspp_test.go

TestIsMixedSplitTx / TestIsMixTx — decode Decred transaction hex constants. If CoinShuffle++ mixing is not used in Monetarium, delete both tests and the hex constants. 
If it is used, replace hex with Monetarium-format transactions.

### db/dbtypes/extraction_test.go

Test_processTransactions — hardcoded Decred block hex. Replace with a Monetarium-format block hex, or delete if processTransactions is covered by integration tests.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━


Rule for each test: if the underlying function is still used in the Monetarium explorer, fix the test data. If the function is Decred-specific and unused, delete both 
the function and its test.

Test: go test ./... passes with zero failures (excluding pgonline/chartdata tags that require a live DB).

Demo: CI green on the go test ./... step.


> Task 13: Fix hardcoded Decred values in cmd/dcrdata tests
Commit: test: replace Decred addresses and app name in cmd/dcrdata tests

Objective: Two test files use hardcoded Decred-specific values that fail against Monetarium params.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━


cmd/dcrdata/config_test.go — TestDefaultConfigAppDataDir:

go
// before
expected := dcrutil.AppDataDir("dcrdata", false)

// after
expected := dcrutil.AppDataDir("monetarium-explorer", false)


━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━


cmd/dcrdata/internal/middleware/apimiddleware_test.go — TestGetAddressCtx:

Replace all Decred addresses with valid Monetarium mainnet addresses:

| Old (Decred) | New (Monetarium) |
|---|---|
| Dcur2mcGjmENx4DhNqDctW5wJCVyT3Qeqkx | MsMfPyfBF2ztzKkT8ged6EaNrJ3iwQXmZR8 |
| DseXBL6g6GxvfYAnKqdao2f7WkXDmYTYW87 | MscT5B47fV5tUaAJiGEUnuikzwV9TdJQkCs |
| Dsi8hhDzr3SvcGcv4NEGvRqFkwZ2ncRhukk | Msepfi5oGbZFsiaHkLHRo8R23bqgmy84RUf |

Also update the invalid test case's errMsg to reference the new invalid address string, and the wrong_net case's errMsg to reference TsWmwignm9Q6iBQMSHw9WhBeR5wgUPpD14Q 
(already a non-mainnet address, keep as-is).

Test: go test ./cmd/dcrdata/... passes with zero failures.

Demo: CI green on the cmd/dcrdata module step.


