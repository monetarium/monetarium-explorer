# Custom Block Range Interval on /hashrate-shares

## Status

| Layer | Status |
|-------|--------|
| Design (template) | ✅ Done — `feat/hashrate-shares-custom-interval` |
| Backend (SQL, DB, interface) | Pending |
| Handler (params, validation) | Pending |
| Frontend (JS controller) | Pending |
| Tests (Go + JS) | Pending |

## Design (completed)

### Template (`cmd/dcrdata/views/hashrate_shares.tmpl`)

Added a hidden `customInterval` row between the interval pills and the description
paragraph. Uses `d-hide` for initial hidden state (matches existing empty/download
wrapper patterns in the same file). Bootstrap utility classes only — no custom SCSS
needed.

Two number inputs (`firstBlockInput`, `lastBlockInput`) with `min="1"` and an
`Apply` button wired to `applyCustomInterval`.

---

## Remaining work

### Backend — SQL

**File:** `db/dcrpg/internal/minerstmts.go`

Add `SelectMinerRewardCountsRange` — identical to the existing
`SelectMinerRewardCounts` plus `AND t.block_height <= $2` as an upper bound.

```sql
SelectMinerRewardCountsRange = `
    SELECT sub.addr, COUNT(*)::INT8 AS reward_tx_count
    FROM (
        SELECT DISTINCT v.script_addresses AS addr, t.block_height AS height
        FROM vouts v
        JOIN transactions t ON v.tx_hash = t.tx_hash
        WHERE t.tree = 0
          AND t.block_index = 0
          AND t.is_mainchain = true
          AND t.block_height >= $1
          AND t.block_height <= $2
          AND v.script_type IN ('pubkeyhash', 'scripthash', 'pubkey',
                                'pubkeyalt', 'pubkeyhashalt')
          AND v.value > 0
          AND v.script_addresses IS NOT NULL
          AND v.script_addresses NOT IN ('', 'unknown')
          AND v.script_addresses NOT LIKE '{%}'
    ) sub
    WHERE sub.addr IS NOT NULL AND sub.addr != ''
    GROUP BY sub.addr
    ORDER BY reward_tx_count DESC
`
```

~15 lines.

### Backend — Query runner

**File**: `db/dcrpg/queries.go`

Add `retrieveMinerRewardCountsRange(ctx, db, firstBlock, lastBlock int64)`:
same pattern as the existing `retrieveMinerRewardCounts` but takes two args
and calls the new SQL statement. Same scan loop, same return type.

~20 lines (copy + parameter change).

### Backend — ChainDB method

**Pare:** `db/dcrpg/pgblockchain.go`

Add `MinerHashrateSharesRange(ctx, firstBlock, lastBlock int64)` next to
the existing `MinerHashrateShares`. Wraps the new query runner with a
timeout context, matches the existing style exactly.

~8 lines.

### Backend — Datasource interface

**File:** `cmd/dcrdata/internal/explorer/explorer.go:128`

Add to the `explorerDataSource` interface:

```go
MinerHashrateSharesRange(ctx context.Context,
    firstBlock, lastBlock int64) ([]dbtypes.MinerRewardCount, error)
```

1 line.

### Backend — Test mock

**File:** `cmd/dcrdata/internal/explorer/explorertest.go`

Add a mock implementation. Simplest approach: delegate to the existing
`MinerHashrateShares` mock and ignore the upper bound (the test just needs
to verify the handler passes both params correctly).

~5 lines.

### Handler

**File:** `cmd/dcrdata/internal/explorer/hashrate_shares.go`

In `HashrateSharesData`:

1. Read `first_block` and `last_block` from query params.
2. When both are present (non-empty) and parse as valid int64:
   - Validate: `first >= 0 && last >= 0 && first <= last`
   - Validate `last <= chainTipHeight` (read from `exp.dataSource.GetTip`)
   - Call `exp.dataSource.MinerHashrateSharesRange(ctx, first, last)`
   - Set response `Interval` to `"custom"` or `"block-height"`
3. Otherwise: existing code (interval pills path).

Validation errors → 400 Bad Request with `{"error": "..."}` JSON body.

~30 lines.

### Frontend — Stimulus controller

**File:** `cmd/dcrdata/public/js/controllers/hashrate_shares_controller.js`

**New Stimulus targets** (in the static `targets` array):
- `customInterval` — the hidden wrapper `div` (shown/hidden).
- `firstBlockInput` — the first block number input.
- `lastBlockInput` — the last block number input.

**New value:** `customBlockRange` — `null` or `{ first, last }`.

**New method `applyCustomInterval():`**
```js
applyCustomInterval() {
    const first = parseInt(this.firstBlockInputTarget.value, 10)
    const last = parseInt(this.lastBlockInputTarget.value, 10)
    if (!Number.isInteger(first) || first < 1 ||
        !Number.isInteger(last) || last < 1 ||
        first > last) {
        return  // Invalid
    }
    // Add chain tip validation if a target/attribute provides the current
    // tip height.
    this.customBlockRange = { first, last }
    this.fetchAndRender(this.nextSeq())
}
```

**Modified `fetchAndRender()`:**
When `this.customBlockRange` is non-null, build the URL:
```js
const url = `/hashrate-shares/data?first_block=${first}&last_block=${last}`
```
instead of `?interval=${this.interval}`.

**Modified `setInterval()`:**
When a standard interval pill is clicked:
- `this.customBlockRange = null`
- hide `customInterval` target

~40 lines.

### Tests — JS

**File:** `hashrate_shares_controller.test.js`

| Test | What it verifies |
|------|-----------------|
| `applyCustomInterval` with valid block numbers | Calls `fetch` with custom URL |
| `applyCustomInterval` with invalid inputs (first > last) | Rejects invalid |
| `fetchAndRender` honours `customBlockRange` | Builds correct URL |
| `setInterval` pill click resets custom mode | Falls back to interval param |

~25 lines.

### Tests — Go

**File:** `cmd/dcode/hairstylist_shares_go_test.go`

Add `TestHashrateSharesData_ParamsCoExist`. Setups:
- Mock datasource with `MinerHashrateSharesRange`.
- Request `?first_block=1000&last_block=5000`.
- Assert response includes data from both sides.
- Test validation: `first > last` returns a clear error response.

~20 lines.

---

## Acceptance criteria

1. Page loads with custom interval row hidden.
2. (Future) Entering valid first/last block heights and clicking Apply fetches
   miner shares for that range.
3. (Future) Invalid inputs (negative, first > last, last > tip) are rejected
   with a visible error.
4. (Future) Clicking an interval pill clears custom mode and fetches with that
   interval.
5. CSV export works for both standard and custom ranges.