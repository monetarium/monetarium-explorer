# Address Page Multi-Coin Implementation Plan

## Overview

Transform the address page `/address/{address}` from single-coin (VAR-only) to multi-coin (VAR + SKA{n}) model, following the contracts defined in wiki specs.

**Source References:**
- `wiki/specs/address-overview/spec.md` - Cross-feature contract
- `wiki/specs/address-summary/spec.md` - Summary card
- `wiki/specs/address-charts/spec.md` - Charts card
- `wiki/specs/address-transactions/spec.md` - Transactions table
- `wiki/code-analysis/address/summary.impact.md` - Technical analysis
- `wiki/code-analysis/address/charts.impact.md` - Charts analysis
- `wiki/code-analysis/address/transactions.impact.md` - Transactions analysis

## Key Principles

1. **SKA precision**: All SKA values pass as strings end-to-end - no `float64` conversion
2. **Computation in Go**: All atom arithmetic happens in Go backend (`big.Int` for SKA)
3. **URL contract**: `?coin=N` is the single new query param shared between charts and transactions
4. **ActiveCoins**: Central concept - determines which coins to display per address

## Dependencies

- `db/dbtypes/types.go` - AddressInfo, AddressBalance, AddressTx, AddressRow
- `db/dcrpg/queries.go` - retrieveAddressBalance, new queries
- `db/dcrpg/pgblockchain.go` - AddressData, AddressHistory, TxHistoryData
- `db/dcrpg/internal/addrstmts.go` - SQL statements
- `db/cache/addresscache.go` - Caching logic
- `cmd/dcrdata/internal/api/apiroutes.go` - Chart endpoints
- `cmd/dcrdata/internal/api/apirouter.go` - Route registration
- `cmd/dcrdata/internal/explorer/explorerroutes.go` - Page handler
- `cmd/dcrdata/internal/explorer/explorer_test.go` - Test mocks
- `cmd/dcrdata/internal/api/noop_ds_test.go` - Test mocks

## Implementation Order

### Phase 1: Types & Mocks (Tasks 1-5)

#### Task 1: Add ActiveCoins to AddressInfo
**Files**: `db/dbtypes/types.go`

Add `ActiveCoins []uint8` field to `AddressInfo` struct:
- Field: `ActiveCoins []uint8 `json:"active_coins,omitempty"``
- Sorted list of coin types present at address
- Populated from `SELECT DISTINCT coin_type FROM addresses WHERE address = $1`

**Verification**: Code compiles, JSON marshal/unmarshal preserves field

---

#### Task 2: Create CoinBalance struct
**Files**: `db/dbtypes/types.go`

Define new per-coin balance structure:
```go
type CoinBalance struct {
    CoinType         uint8
    NumSpent         int64
    NumUnspent       int64
    TotalSpent       int64        // VAR atoms (1e8)
    TotalUnspent     int64        // VAR atoms (1e8)
    TotalSpentSKA    string       // SKA atoms as string (1e18)
    TotalUnspentSKA  string       // SKA atoms as string (1e18)
    TotalReceived    int64        // VAR atoms
    TotalReceivedSKA string       // SKA atoms as string
}
```

**Verification**: Struct compiles, JSON marshaling produces correct SKA string format

---

#### Task 3: Transform AddressBalance to per-coin
**Files**: `db/dbtypes/types.go`

Replace flat balance with per-coin structure:
- Add `Coins map[uint8]*CoinBalance` to `AddressBalance`
- Keep deprecated `TotalUnspent`, `TotalSpent` for compatibility or remove
- Add `FromStake`, `ToStake` (VAR-only)
- Add computed `TotalOutputs int64`, `TotalInputs int64`

**Breaking Change**: Requires handler/template updates in same PR

**Verification**: Build fails until consumers updated (expected)

---

#### Task 4: Add SKA fields to AddressTx/AddressRow
**Files**: `db/dbtypes/types.go`

- Verify `AddressRow.CoinType` exists
- Add `SKAValue string` to `AddressRow`
- Add `SentTotalSKA string`, `ReceivedTotalSKA string` to `AddressTx`

**Verification**: Fields present in structs

---

#### Task 5: Update test mocks
**Files**:
- `cmd/dcrdata/internal/explorer/explorer_test.go`
- `cmd/dcrdata/internal/api/noop_ds_test.go`

- Update `AddressHistory` return types
- Add empty `ActiveCoins` default
- Update `AddressData` mock signatures

**Verification**: Test files compile

---

### Phase 2: Query Layer (Tasks 6-9)

#### Task 6: New coin type query
**Files**: `db/dcrpg/internal/addrstmts.go`, `db/dcrpg/queries.go`

Create `MakeSelectAddressCoinTypes` statement:
```sql
SELECT DISTINCT coin_type
FROM addresses
WHERE address = $1
ORDER BY coin_type
```

Add `retrieveAddressCoinTypes(ctx, db, address) ([]uint8, error)`

**Verification**: Returns sorted coin types for multi-coin address

---

#### Task 7: Fix retrieveAddressBalance
**Files**: `db/dcrpg/queries.go` (around line 1453-1529)

Modify to preserve coin type dimension:
- SQL already groups by `coin_type` (addrstmts.go:220-232)
- Stop collapsing into single int64
- Populate new `Coins` map instead of flat totals
- Handle VAR (int64) vs SKA (string) separately

**Verification**: Query returns per-coin breakdown

---

#### Task 8: Fix ReduceAddressHistory
**Files**: `db/dbtypes/types.go` (around line 2380+)

- When `addrOut.CoinType != 0`, use SKA string fields
- Build per-coin totals in new structure instead of flat sum
- Don't use `dcrutil.Amount(addrOut.Value).ToCoin()` for SKA

**Verification**: Mixed addresses don't sum incorrectly

---

#### Task 9: Update AddressHistory
**Files**: `db/dcrpg/pgblockchain.go` (around line 2445-2496)

- Call `retrieveAddressCoinTypes`
- Set `AddressInfo.ActiveCoins`
- Build `AddressBalance.Coins` from query results

**Verification**: AddressData returns ActiveCoins populated

---

### Phase 3: API & Handler (Tasks 10-13)

#### Task 10: Add ?coin= to chart API endpoints
**Files**:
- `cmd/dcrdata/internal/api/apirouter.go`
- `cmd/dcrdata/internal/api/apiroutes.go`

Add coin filter to routes:
- `/api/address/{address}/types/{chartgrouping}?coin=N`
- `/api/address/{address}/amountflow/{chartgrouping}?coin=N`
- Default to VAR (0) if not specified
- Return error for invalid coin type

**Verification**: `GET /api/address/{addr}/types/day?coin=1` returns SKA1 data

---

#### Task 11: Update TxHistoryData for coin filtering
**Files**: `db/dcrpg/pgblockchain.go` (around line 3112-3182)

- Add coin type parameter to interface and implementation
- Modify SQL queries to filter by `coin_type`
- Return per-coin chart series

**Verification**: Different coin params return different data

---

#### Task 12: Update address handler
**Files**: `cmd/dcrdata/internal/explorer/explorerroutes.go`

- Add `?coin=` parsing in `parseAddressParams`
- Validate coin is in `ActiveCoins` (if specified)
- Pass coin filter to chart endpoints
- Handle "empty = all coins" case for transactions table

**Verification**: URL changes reflect in responses

---

#### Task 13: Remove fiat conversion
**Files**: `cmd/dcrdata/internal/explorer/explorerroutes.go`

Per spec: fiat conversion removed as SKA has no price model
- Remove `FiatBalance` field from `AddressPageData`
- Remove `xcBot.Conversion` call
- Update template to not expect FiatBalance

**Verification**: Page renders without fiat errors

---

### Phase 4: Caching (Tasks 14-15)

#### Task 14: Extend address cache key
**Files**: `db/cache/addresscache.go`

- Add coin type to cache key (e.g., `address + coin_type`)
- Handle backward compatibility (existing VAR-only cache entries)

**Verification**: Different coins cache separately

---

#### Task 15: Cache per-coin data
**Files**: `db/cache/addresscache.go`

- Store `ActiveCoins` with address data
- Cache per-coin balance map
- Ensure invalidation works for multi-coin

**Verification**: Cached data matches fresh query

---

### Phase 5: Testing (Tasks 16-18)

#### Task 16: Unit tests for types
**Files**: `db/dbtypes/types_test.go` (create if needed)

- Test `CoinBalance` JSON marshaling (SKA as string)
- Test `AddressBalance` per-coin map population
- Test `ActiveCoins` sorting (ascending)

**Verification**: All tests pass (in-memory)

---

#### Task 17: Integration tests for queries
**Files**: `db/dcrpg/pgblockchain_test.go` (or existing test file)

- Create test address with VAR + SKA
- Verify `ActiveCoins` returns [0, 1] for mixed
- Verify per-coin balances correct

**Verification**: All tests pass (in-memory with mocks)

---

#### Task 18: API endpoint tests
**Files**: `cmd/dcrdata/internal/api/apiroutes_test.go`

- Add `?coin=` param tests for chart endpoints
- Test default (no coin) behavior returns VAR
- Test invalid coin type error handling (404 or 400)

**Verification**: All tests pass (in-memory)

---

## Risk Areas

| Risk | Impact | Mitigation |
|------|--------|------------|
| Breaking existing AddressInfo consumers | High | Update all callers in same PR |
| Cache invalidation on multi-coin | Medium | Test invalidation thoroughly |
| Performance on address with many coins | Medium | Index on (address, coin_type) already exists |
| Template changes required | High | Coordinate with frontend team |

---

## Key Invariants

From `wiki/specs/address-overview/spec.md`:

1. **Address is multi-coin**: One address can hold VAR + multiple SKA types
2. **Conditional display**: VAR always shown; SKA only if in `ActiveCoins`
3. **Precision**: SKA atoms pass as strings through all layers - no `float64`
4. **URL contract**: `?coin=` shared between charts and transactions; changing it resets `?start=0`
5. **Coin labels**: Only through `coinSymbol()` (Go) or `renderCoinType()` (JS)
6. **Computation in Go**: All atom arithmetic in backend, template only does formatting

---

## Summary

| Phase | Tasks | Description |
|-------|-------|-------------|
| Types & Mocks | 1-5 | Data structure changes |
| Query Layer | 6-9 | Database layer |
| API/Handler | 10-13 | HTTP layer |
| Caching | 14-15 | Performance layer |
| Testing | 16-18 | Validation |

**Total: 18 sequential tasks**

---

## Open Questions

- [ ] Should deprecated `TotalUnspent`/`TotalSpent` be kept or removed?
- [ ] Cache backward compatibility - invalidate all on deploy or support both keys?
- [ ] What to do with addresses that have zero transactions (empty ActiveCoins)?