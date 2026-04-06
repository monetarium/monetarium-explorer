# Monetarium Explorer — Rewrite Plan

## Notes
- **Every task is a separate branch feature/name_of_the_feature.**
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


### Task 14: Fix missing coin_type on vins in processTransactions
Commit: fix: set coin_type on VinTxProperty in processTransactions

Objective: Every vin stored in the vins table has coin_type = 0 (VAR) even when it spends an SKA output, because CoinType is never assigned when building VinTxProperty 
in processTransactions. Fix it.

Root cause:

In db/dbtypes/extraction.go, the vin construction loop omits CoinType:

go
dbTxVins[txIndex] = append(dbTxVins[txIndex], VinTxProperty{
    // ... all fields set ...
    // CoinType never assigned → defaults to 0 (VAR)
})


The vout loop directly below it correctly reads ct := txout.CoinType. The wire TxIn type has no CoinType field — the coin type of an input is the coin type of the output
it spends. Since the codebase already assumes transactions are single-coin (see the skaSpent placeholder comment), the tx's coin type can be derived from its outputs.

Fix — db/dbtypes/extraction.go:

Before the vin loop, derive the transaction's coin type from its outputs (reusing the already-computed skaSent map):

go
// Derive vin coin type from outputs (tx is single-coin).
vinCoinType := uint8(cointype.CoinTypeVAR)
for ct := range skaSent {
    vinCoinType = ct
    break
}


Then set it in the VinTxProperty literal:

go
dbTxVins[txIndex] = append(dbTxVins[txIndex], VinTxProperty{
    // ... existing fields ...
    CoinType: vinCoinType,
})


No other files need changes — insertVinsStmt in queries.go already passes vin.CoinType as $8 to the SQL statement.

Test: Add a case to db/dbtypes/extraction_test.go Test_processTransactions with a synthetic SKA-1 transaction (one TxIn with SKAValueIn set, one TxOut with CoinType=1). 
Assert that the resulting VinTxProperty.CoinType == 1.

Demo: After re-syncing, SELECT count(*) FROM vins WHERE coin_type != 0 returns a non-zero count matching the number of SKA inputs in the chain.


> ### Task 15: Persist coin_amounts to the blocks table
Commit: fix: persist coin_amounts in blocks table so SKA data survives restart

Objective: CoinAmounts is computed at sync time and cached in memory, but never written to the DB. After a restart the cache is cold, retrieveBlockSummaryByHash returns 
CoinAmounts == nil, and no SKA data appears in the UI. Fix by adding a coin_amounts JSONB column to blocks and round-tripping it through all affected insert/select 
paths.

db/dcrpg/internal/blockstmts.go:

Add column to CreateBlockTable:
sql
coin_amounts JSONB


Add to insertBlockRow (becomes $26):
sql
INSERT INTO blocks (..., coin_amounts) VALUES (..., $26)


Add to SelectBlockDataByHash and SelectBlockDataByHeight SELECT lists:
sql
, blocks.coin_amounts


db/dcrpg/queries.go — wherever insertBlockRow is executed, pass the new arg:
go
dbtypes.ToJSONB(blockSummary.CoinAmounts)  // $26


In retrieveBlockSummaryByHash and retrieveBlockSummary, scan the new column and unmarshal:
go
var coinAmountsJSON []byte
// add &coinAmountsJSON to the Scan call
_ = json.Unmarshal(coinAmountsJSON, &bd.CoinAmounts)


Do the same in retrieveBlockSummaryRange / retrieveBlockSummaryRangeStepped if they use the same SELECT.

db/dcrpg/upgrades.go:
sql
ALTER TABLE blocks ADD COLUMN IF NOT EXISTS coin_amounts JSONB;


Test: After a full restart with a cold cache, GET /api/block/{height} for a block containing SKA outputs must return a non-nil coin_amounts field. Assert in the existing
TestGetBlockSummary_CoinAmounts handler test that the value survives a round-trip through json.Marshal → json.Unmarshal (i.e. no float64 precision loss on the atom 
strings).

Demo: Restart the explorer against a synced DB; the homepage latest-blocks table shows SKA-1 rows without requiring a re-sync.

> ### Task 16: Display SKA amounts on transaction and address pages
Commit: fix: display SKA amounts on tx and address pages

Objective: Six display bugs cause SKA amounts to show as 0 on the transaction and address pages. All stem from the same root: Value int64 is 0 for SKA outputs/inputs; 
the real amount lives in SKAValue string. The display layer never reads it.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━


explorer/types/explorertypes.go — extend Vout and AddressTx:

go
type Vout struct {
    // ... existing fields ...
    CoinType        uint8
    SKAValue        string // raw atom string for SKA outputs; empty for VAR
    FormattedAmount string // already exists; set correctly for both coin types
}

type AddressTx struct {
    // ... existing fields ...
    CoinType      uint8
    SKAValue      string // raw atom string; empty for VAR
}


━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━


cmd/dcrdata/internal/explorer/explorerroutes.go — vout loop:

Replace:
go
amount := dcrutil.Amount(int64(vouts[iv].Value)).ToCoin()
tx.Vout = append(tx.Vout, types.Vout{
    Amount:          amount,
    FormattedAmount: humanize.Commaf(amount),
    ...
})

With:
go
vout := types.Vout{
    Addresses: vouts[iv].ScriptPubKeyData.Addresses,
    Type:      vouts[iv].ScriptPubKeyData.Type.String(),
    Spent:     spendingTx != "",
    Index:     vouts[iv].TxIndex,
    Version:   vouts[iv].Version,
    CoinType:  vouts[iv].CoinType,
    SKAValue:  vouts[iv].SKAValue,
}
if vouts[iv].CoinType == 0 {
    amount := dcrutil.Amount(int64(vouts[iv].Value)).ToCoin()
    vout.Amount = amount
    vout.FormattedAmount = humanize.Commaf(amount)
} else {
    vout.FormattedAmount = exptypes.FormatSKAAmount(vouts[iv].SKAValue, vouts[iv].CoinType, true)
}
tx.Vout = append(tx.Vout, vout)


vin loop — replace:
go
amount := dcrutil.Amount(vins[iv].ValueIn).ToCoin()
// ...
AmountIn:      amount,
// ...
FormattedAmount: humanize.Commaf(amount),

With:
go
var formattedAmt string
var amountIn float64
if vins[iv].CoinType == 0 {
    amountIn = dcrutil.Amount(vins[iv].ValueIn).ToCoin()
    formattedAmt = humanize.Commaf(amountIn)
} else {
    formattedAmt = exptypes.FormatSKAAmount(/* need SKAValue on VinTxProperty — see below */)
}


This requires adding SKAValue string to dbtypes.VinTxProperty (currently missing — vins store ValueIn int64 which is 0 for SKA). Populate it in processTransactions 
alongside CoinType:
go
// in the vin loop in extraction.go
SKAValue: func() string {
    if vinCoinType != 0 {
        // sum SKAValueIn from this input
        if txin.SKAValueIn != nil {
            return txin.SKAValueIn.String()
        }
    }
    return ""
}(),

And add ska_value TEXT to the vins INSERT statement + SelectAllVinInfoByID SELECT (mirrors the vouts pattern).

TxBasic.Total — set from dbTx0.Sent (VAR only). Add a SKASent map[uint8]string field to TxBasic and populate from dbTx0.SentByCoin:
go
TxBasic: &types.TxBasic{
    Total:   dcrutil.Amount(dbTx0.Sent).ToCoin(), // VAR
    SKASent: dbTx0.SentByCoin,                    // SKA
    ...
}


━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━


db/dbtypes/types.go — ReduceAddressHistory:

Replace:
go
coin := dcrutil.Amount(addrOut.Value).ToCoin()
tx.ReceivedTotal = coin  // or SentTotal

With:
go
if addrOut.CoinType == 0 {
    coin := dcrutil.Amount(addrOut.Value).ToCoin()
    if addrOut.IsFunding { tx.ReceivedTotal = coin } else { tx.SentTotal = coin }
} else {
    tx.SKAValue = addrOut.SKAValue
    tx.CoinType = addrOut.CoinType
}


Also skip SKA rows in the VAR-only received/sent int64 accumulators (they're already 0 but make it explicit with a CoinType == 0 guard).

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━


Test: Add cases to db/dbtypes/extraction_test.go asserting that a SKA-1 vout produces SKAValue != "" and Value == 0. Add a ReduceAddressHistory test with a SKA 
AddressRow (CoinType=1, Value=0, SKAValue="1000000000000000000") asserting tx.SKAValue == "1000000000000000000" and tx.ReceivedTotal == 0.

Demo: Navigate to a transaction with SKA-1 outputs — vout amounts show the correct SKA-1 value instead of 0. Navigate to the receiving address — the transaction row 
shows the SKA-1 amount.


### Task 17: Add coin_type and ska_value to API vout responses
Commit: fix: expose coin_type and ska_value on API vout responses

Objective: GET /api/tx/{txid} returns value: 0 for SKA outputs with no coin type indicator. The node RPC response carries the SKA amount in a separate field on 
chainjson.Vout; the explorer never reads it. Fix by extending apitypes.Vout and populating it in GetAPITransaction and GetAllTxOut.

api/types/apitypes.go — extend Vout:

go
type Vout struct {
    Value               float64      `json:"value"`
    N                   uint32       `json:"n"`
    Version             uint16       `json:"version"`
    ScriptPubKeyDecoded ScriptPubKey `json:"scriptPubKey"`
    Spend               *TxInputID   `json:"spend,omitempty"`
    CoinType            uint8        `json:"coin_type,omitempty"`
    SKAValue            string       `json:"ska_value,omitempty"` // decimal atom string
}


db/dcrpg/pgblockchain.go — GetAPITransaction vout loop:

Check what field chainjson.Vout uses for SKA (it will be something like SKAValue *string or SKAAmount string — confirm from the node's jsonrpc types). Then populate:

go
tx.Vout[i].Value = vout.Value
tx.Vout[i].CoinType = uint8(vout.CoinType)   // from chainjson.Vout
if vout.SKAValue != nil {
    tx.Vout[i].SKAValue = *vout.SKAValue      // field name TBD from chainjson
}


Apply the same two lines in GetAllTxOut:
go
allTxOut = append(allTxOut, &apitypes.TxOut{
    Value:    txouts[i].Value,
    Version:  txouts[i].Version,
    CoinType: uint8(txouts[i].CoinType),
    SKAValue: ...,
    ...
})


Note: apitypes.TxOut also needs the same two fields added.

First step: grep chainjson.Vout in the monetarium-node module to find the exact field names for coin type and SKA value on the RPC result struct, then use those names 
above.

Test: Add a case to cmd/dcrdata/internal/api/apiroutes_test.go that constructs a mock chainjson.GetRawTransactionVerboseResult with a SKA-1 vout and asserts the 
resulting apitypes.Vout has CoinType == 1 and SKAValue != "".

Demo: GET /api/tx/{ska-tx-id} returns vouts with "coin_type": 1 and "ska_value": "900000000000000000000000000000000" instead of "value": 0.

Task 18: Per-coin tx count and size in the blocks table
Commit: feat: persist per-coin tx count and size in blocks table

Objective: Mirror the coin_amounts pattern to store per-coin transaction counts and total sizes, so the blocks table and API expose how many transactions and how many 
bytes each coin type contributes per block.

Status: Largely complete. One bug remains.

What is already implemented:

- blockdata/blockdata.go — blockCoinTxStats function and CollectBlockInfo wiring (CoinTxStats populated on both blockdata and extrainfo)
- blockdata/blockdata_test.go — TestBlockCoinTxStats_Mixed and TestBlockCoinTxStats_Empty
- db/dbtypes/types.go — CoinTxStats struct and DBBlock.CoinTxStats field
- api/types/apitypes.go — CoinTxStats type alias; CoinTxStats field on BlockDataBasic and BlockExplorerExtraInfo
- db/dcrpg/internal/blockstmts.go — coin_tx_stats JSONB column in CreateBlockTable; $27 in insertBlockRow; included in all SELECT statements alongside coin_amounts
- db/dcrpg/queries.go — $27 arg (ToJSONB(dbBlock.CoinTxStats)) on insert; coinTxStatsJSON scanned and unmarshalled in retrieve functions
- db/dcrpg/upgrades.go — ALTER TABLE blocks ADD COLUMN IF NOT EXISTS coin_tx_stats JSONB
- db/dcrpg/internal/schema_test.go — column presence assertion
- db/dcrpg/pgblockchain.go — coinRowsFromSummary merges CoinTxStats into CoinRowData (used by the block list path at line 6086)

Remaining bug — pgblockchain.go line 5933:

The BlockInfo path (used by the websocket and block detail page) calls coinRowsFromAmounts instead of coinRowsFromSummary, so TxCount and Size are always 0 in coin_rows 
on that path:

go
// line 5933 — WRONG
block.BlockBasic.CoinRows = coinRowsFromAmounts(summary.CoinAmounts)

// fix
block.BlockBasic.CoinRows = coinRowsFromSummary(summary)


Test: Existing tests cover all other paths. Add one assertion to the BlockInfo path test (or the existing TestBuildHomeBlockRows_WithCoinRows) that a CoinRowData built 
via the BlockInfo path has non-zero TxCount and Size when CoinTxStats is present.

Demo: Block detail page and websocket block events show correct per-coin tx_count and size in coin_rows. GET /api/block/{height} returns 
"coin_tx_stats": {"0": {"tx_count": 5, "size": 2048}, "1": {"tx_count": 2, "size": 512}}.

Task 19: Per-coin mempool tracking (size, amount, tx count)
Commit: fix: per-coin tx count, size, and amount tracking in mempool

Objective: Mempool currently tracks only a single VAR-based TotalOut float64 and a single LikelyMineable.Size int32. SKA transactions contribute 0 to all totals. Mirror 
the block-level CoinTxStats pattern to track per-coin tx count, size, and amount in mempool.

Root cause — three broken sites:

1. txhelpers.TotalOutFromMsgTx sums v.Value (int64) for all outputs — SKA outputs have Value == 0, their amount is in v.SKAValue *big.Int, never read.
2. MempoolTx has no per-coin amount field — only TotalOut float64 (VAR only).
3. ParseTxns in collector.go accumulates out, _ := dcrutil.NewAmount(tx.TotalOut) into regularTotal, ticketTotal, etc. — all zero for SKA. LikelyMineable totals and 
CoinFills in StoreMPData are therefore wrong for SKA.

Changes:

txhelpers/txhelpers.go — fix TotalOutFromMsgTx to guard on VAR only:
go
func TotalOutFromMsgTx(msgTx *wire.MsgTx) dcrutil.Amount {
    var amtOut int64
    for _, v := range msgTx.TxOut {
        if v.CoinType == cointype.CoinTypeVAR {
            amtOut += v.Value
        }
    }
    return dcrutil.Amount(amtOut)
}


Add SKATotalsFromMsgTx(msgTx *wire.MsgTx) map[uint8]string — mirrors blockCoinAmounts but for a single tx, returns atom strings keyed by SKA coin type.

explorer/types/explorertypes.go — add to MempoolTx:
go
SKATotals map[uint8]string `json:"ska_totals,omitempty"`

Update DeepCopy to copy the map.

Add MempoolCoinStats struct (mirrors CoinTxStats):
go
type MempoolCoinStats struct {
    TxCount int   `json:"tx_count"`
    Size    int32 `json:"size"`
    Amount  string `json:"amount"` // VAR: atom int64 string; SKA: big.Int atom string
}


Add to MempoolShort:
go
CoinStats map[uint8]MempoolCoinStats `json:"coin_stats,omitempty"`

Update DeepCopy to copy the map.

mempool/monitor.go and mempool/collector.go — populate SKATotals in MempoolTx{}:
go
SKATotals: txhelpers.SKATotalsFromMsgTx(msgTx),


mempool/collector.go — ParseTxns: after the existing per-type accumulation loop, build CoinStats by iterating all txs, grouping by coin type (VAR from tx.TotalOut, SKA 
from tx.SKATotals), accumulating count, size, and amount. Assign to mpInfo.MempoolShort.CoinStats.

cmd/dcrdata/internal/explorer/explorer.go — StoreMPData: replace the stub SKA fill loop with one driven by inv.CoinStats:
go
// VAR: 10% of bar; SKA types share remaining 90% equally
for ct, stats := range inv.CoinStats {
    // compute fill from stats.Size / maxBlockSize
    // assign symbol, fill pct, color
}
inv.CoinFills = fills


Test:
- Unit test for TotalOutFromMsgTx with a mixed VAR+SKA tx — assert VAR amount correct, SKA does not corrupt it.
- Unit test for SKATotalsFromMsgTx — assert correct atom string for SKA-1 output.
- Unit test for ParseTxns with a slice containing one VAR tx and one SKA-1 tx — assert CoinStats[0].TxCount == 1 and CoinStats[1].TxCount == 1 with correct sizes.

Demo: Mempool API response includes coin_stats with per-coin tx count, size, and amount. Homepage fill bars show non-zero SKA fill when SKA transactions are in mempool.


