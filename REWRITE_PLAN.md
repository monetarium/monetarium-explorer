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


> Task 10: SQL schema migration for multi-coin support
Commit: feat: complete SQL schema and Go code for multi-coin (VAR+SKA)

Objective: Extend the PostgreSQL schema to store per-coin data (VAR + SKA types), remove the treasury, and keep all Go insert/scan call sites in sync with the new column
counts.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━


## Schema changes

vins — add coin_type INT2 NOT NULL DEFAULT 0 after value_in.

vouts — add coin_type INT2 NOT NULL DEFAULT 0 after value; add ska_value TEXT after mixed. Update SelectCoinSupply to filter coin_type = 0 (VAR only).

transactions — add ska_fees JSONB after fees.

addresses — add coin_type INT2 NOT NULL DEFAULT 0 and ska_value TEXT after value.

swaps — add coin_type INT2 NOT NULL DEFAULT 0 after value.

tickets — change price FLOAT8 and fee FLOAT8 to TEXT. Add ::NUMERIC cast wherever these columns are compared or aggregated in queries.

votes — change ticket_price FLOAT8 and vote_reward FLOAT8 to TEXT.

treasury — stub out the entire file: empty-string constants for all statement names, no-op functions for MakeTreasuryInsertStatement and MakeSelectTreasuryIOStatement. 
The table is not created.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━


## Go struct changes (db/dbtypes/types.go)

Add CoinType uint8 to VinTxProperty, AddressRow, and UTXOData.
Add SKAValue string to AddressRow and UTXOData.
Add ToJSONB(v interface{}) []byte helper (marshal to JSON, return nil on error).

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━


## Go call site rules (db/dcrpg/queries.go and pgblockchain.go)

Rule: every stmt.QueryRow(...) or tx.QueryRow(sqlStmt, ...) that inserts into vins, vouts, transactions, or addresses must pass exactly as many arguments as the 
corresponding INSERT statement has $N placeholders. Every rows.Scan(...) or .Scan(...) that reads from those tables must have exactly as many destination pointers as the
SELECT returns columns.

Verify each of the following functions passes/scans the right count:

| Function | Table | Check |
|---|---|---|
| insertVinsStmt | vins | args match insertVinRow placeholder count |
| insertVoutsStmt | vouts | args match insertVoutRow placeholder count; also populate CoinType/SKAValue on the AddressRow built inside the loop |
| insertTxnsStmt | transactions | args match insertTxRow; pass ToJSONB(tx.FeesByCoin) for ska_fees |
| insertAddressRowsDbTx | addresses | args match insertAddressRow |
| insertSpendingAddressRow | addresses | args match insertAddressRow; source CoinType/SKAValue from spentUtxoData |
| retrieveTxOutData | vouts | Scan destinations match SelectVoutAddressesByTxOut column count |
| retrieveUTXOsStmt | vouts | Scan destinations match SelectUTXOs column count |
| scanAddressQueryRows | addresses | Scan destinations match addrsColumnNames column count |
| SelectAddressSpentUnspentCountAndValue scan | addresses | Scan destinations match the SELECT column count (includes coin_type) |
| retrieveDbTxByHash | transactions | Scan destinations match SelectFullTxByHash; scan ska_fees into []byte then json.Unmarshal into FeesByCoin |
| retrieveDbTxsByHash | transactions | Same as above inside rows.Next() loop |

pgblockchain.go — TreasuryBalance: replace the entire body with a no-op that returns &dbtypes.TreasuryBalance{Height: tipHeight}, nil. No DB query.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━


## Migration (db/dcrpg/upgrades.go)

Add a schema version bump that ALTER TABLE ... ADD COLUMN IF NOT EXISTS for all new columns, and ALTER COLUMN ... TYPE TEXT USING ...::TEXT for the ticket/vote price 
columns.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━


Test: go build ./... green; fresh DB init and block sync complete without any sql: expected N destination arguments or pq: got N parameters errors.

Demo: Blocks with VAR and SKA-1 outputs sync cleanly; address history and transaction lookups return without scan errors.


Task 11: Tests for Task 10 schema correctness
Commit: test: verify SQL column counts and select column consistency for multi-coin schema

Objective: Extend db/dcrpg/internal/schema_test.go to catch at compile/test time the class of bugs that caused the runtime 
sql: expected N destination arguments in Scan, not M errors.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━


### What to add to schema_test.go

TestSelectColumnCounts — for each SELECT statement that had a mismatched Scan, assert the expected column count using a simple comma-count helper on the SELECT list. 
This documents the contract between SQL and Go:

go
func countSelectColumns(sql string) int {
    // extract between SELECT and FROM
    upper := strings.ToUpper(sql)
    start := strings.Index(upper, "SELECT") + len("SELECT")
    end := strings.Index(upper, "FROM")
    if start < 0 || end < 0 || end <= start {
        return 0
    }
    cols := strings.TrimSpace(sql[start:end])
    return len(strings.Split(cols, ","))
}

func TestSelectColumnCounts(t *testing.T) {
    cases := []struct {
        name     string
        sql      string
        wantCols int
    }{
        // vouts
        {"SelectUTXOs",              SelectUTXOs,              8}, // id,tx_hash,tx_index,script_addresses,value,mixed,coin_type,ska_value
        {"SelectVoutAddressesByTxOut", SelectVoutAddressesByTxOut, 6}, // id,script_addresses,value,mixed,coin_type,ska_value
        // transactions
        {"SelectFullTxByHash",       SelectFullTxByHash,       24}, // id + 23 columns
        // addresses
        {"addrsColumnNames",         "SELECT " + addrsColumnNames + " FROM x", 13}, // id,address,...,coin_type,ska_value
        {"SelectAddressSpentUnspentCountAndValue", SelectAddressSpentUnspentCountAndValue, 6}, // is_regular,coin_type,count,sum,is_funding,all_empty_matching
    }
    for _, tc := range cases {
        t.Run(tc.name, func(t *testing.T) {
            got := countSelectColumns(tc.sql)
            if got != tc.wantCols {
                t.Errorf("%s: expected %d SELECT columns, got %d", tc.name, tc.wantCols, got)
            }
        })
    }
}


TestCoinSupplyVARFilter — assert SelectCoinSupply contains the VAR-only filter:
go
func TestCoinSupplyVARFilter(t *testing.T) {
    if !strings.Contains(SelectCoinSupply, "coin_type = 0") {
        t.Error("SelectCoinSupply must filter coin_type = 0 (VAR only)")
    }
}


TestNumericCastOnTicketPrice — assert price comparisons use ::NUMERIC:
go
func TestNumericCastOnTicketPrice(t *testing.T) {
    for _, sql := range []string{SelectTicketsForPriceAtLeast, SelectTicketsForPriceAtMost, SelectTicketsByPrice} {
        if !strings.Contains(sql, "::NUMERIC") {
            t.Errorf("ticket price query missing ::NUMERIC cast: %s", sql[:60])
        }
    }
}


━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━


### What cannot be tested without a DB

The Go-side Scan destination counts (e.g. retrieveUTXOsStmt, scanAddressQueryRows) require a live PostgreSQL connection. Those are covered by the existing 
*_online_test.go files. The tests above catch the SQL side of the contract so mismatches are caught before hitting a DB.

Test: go test ./db/dcrpg/internal/... passes with no failures.

Demo: Running the tests after a schema change that removes a column immediately fails with a descriptive error rather than a runtime panic.


> Task 12: Fix fatal error when treasury/subsidy address is absent
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


