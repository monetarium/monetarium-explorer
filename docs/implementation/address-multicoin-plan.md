# Address Page Multi-Coin Implementation Plan

## Overview

**Backend-only plan** - Transform the address page `/address/{address}` from single-coin (VAR-only) to multi-coin (VAR + SKA{n}) model, following the contracts defined in wiki specs.

Templates (`address.tmpl`, `extras.tmpl`), Stimulus controller (`address_controller.js`), and CSV download UX are **out of scope** and covered separately.

**Source References:**
- `wiki/specs/address-overview/spec.md` - Cross-feature contract
- `wiki/specs/address-summary/spec.md` - Summary card
- `wiki/specs/address-charts/spec.md` - Charts card
- `wiki/specs/address-transactions/spec.md` - Transactions table
- `wiki/code-analysis/address/summary.impact.md` - Technical analysis
- `wiki/code-analysis/address/charts.impact.md` - Charts analysis
- `wiki/code-analysis/address/transactions.impact.md` - Transactions analysis

## Not in Scope

The following are handled in separate plans:
- Template changes (`address.tmpl`, `extras.tmpl`, `addresstable.tmpl`)
- Frontend controller (`address_controller.js`)
- CSV download UX (frontend)

## Key Principles

1. **SKA precision**: All SKA values pass as strings end-to-end - no `float64` conversion
2. **Computation in Go**: All atom arithmetic happens in Go backend (`*big.Int` for SKA)
3. **URL contract**: `?coin=N` is the single new query param shared between charts and transactions
4. **ActiveCoins**: Central concept - determines which coins to display per address
5. **Precomputation in Go**: Per-coin totals (`TotalReceived`, `TotalOutputs`, `TotalInputs`) computed in Go so template never does SKA string arithmetic

## Dependencies

- `db/dbtypes/types.go` - AddressInfo, AddressBalance, AddressTx, AddressRow, ChartsData
- `db/dcrpg/queries.go` - retrieveAddressBalance, new queries
- `db/dcrpg/pgblockchain.go` - AddressData, AddressHistory, TxHistoryData, UnconfirmedTxnsForAddress
- `db/dcrpg/internal/addrstmts.go` - SQL statements
- `db/cache/addresscache.go` - Caching logic
- `cmd/dcrdata/internal/api/apiroutes.go` - Chart endpoints, CSV download
- `cmd/dcrdata/internal/api/apirouter.go` - Route registration
- `cmd/dcrdata/internal/explorer/explorerroutes.go` - Page handler
- `cmd/dcrdata/internal/explorer/explorer_test.go` - Test mocks
- `cmd/dcrdata/internal/api/noop_ds_test.go` - Test mocks
- `mempool/` package - Unconfirmed transactions per address

## Implementation Order

### Phase 1: Types & Mocks (Tasks 1-6)

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

Define new per-coin balance structure. Note: For VAR (CoinType=0), use `TotalSpent`/`TotalUnspent` (int64). For SKA (CoinType>0), use `TotalSpentSKA`/`TotalUnspentSKA` (string). The meaningful field depends on CoinType.

```go
type CoinBalance struct {
    CoinType         uint8
    NumSpent         int64
    NumUnspent       int64
    TotalSpent       int64        // VAR atoms (1e8) - meaningful when CoinType == 0
    TotalUnspent     int64        // VAR atoms (1e8) - meaningful when CoinType == 0
    TotalSpentSKA    string       // SKA atoms as string (1e18) - meaningful when CoinType > 0
    TotalUnspentSKA  string       // SKA atoms as string (1e18) - meaningful when CoinType > 0
    TotalReceived    int64        // VAR atoms - precomputed: TotalSpent + TotalUnspent
    TotalReceivedSKA string      // SKA atoms - precomputed: TotalSpentSKA + TotalUnspentSKA
}
```

**Rationale**: TotalReceived is precomputed in Go (not template) so the template never does SKA string arithmetic. See Summary spec §3.3.

**Verification**: Struct compiles, JSON marshaling produces correct SKA string format

---

#### Task 3: Transform AddressBalance to per-coin
**Files**: `db/dbtypes/types.go`

Replace flat balance with per-coin structure:
- Add `Coins map[uint8]*CoinBalance` to `AddressBalance`
- Remove flat `TotalUnspent`, `TotalSpent` (replaced by per-coin structure)
- Add `FromStake`, `ToStake` (computed from VAR only - see Task 21)
- Add precomputed `TotalOutputs int64 = Σ(NumSpent + NumUnspent)` across all coins
- Add precomputed `TotalInputs int64 = Σ(NumSpent)` across all coins

**Rationale**: Precomputed totals exist so template doesn't loop over Coins map. This avoids creating a template helper for SKA string addition - the spec deliberately prevents this.

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

#### Task 5: Add ChartsData type extension
**Files**: `db/dbtypes/types.go` (around line 2030-2040)

Extend `ChartsData` for server-side cumulative balance (per Charts spec §5.3):
```go
type ChartsData struct {
    // Existing fields...
    // Add for per-coin:
    Balance      []float64        // VAR running balance (float64, 8 decimals)
    BalanceAtoms []string         // SKA running balance (string, 18 decimals)
    ReceivedAtoms []string        // SKA received cumulative (string)
    SentAtoms    []string         // SKA sent cumulative (string)
    NetAtoms     []string         // SKA net cumulative (string)
}
```

**Rationale**: Running balance computed in Go via `*big.Int.Add` inside `parseRowsSentReceived`, not in JS. See Charts spec §3.3.1.

**Verification**: Type compiles, JSON marshaling correct

---

#### Task 6: Update test mocks
**Files**:
- `cmd/dcrdata/internal/explorer/explorer_test.go`
- `cmd/dcrdata/internal/api/noop_ds_test.go`

- Update `AddressHistory` return types (per Tasks 1-5)
- Update `AddressData` mock signatures
- Update `DevBalance` mock (implements AddressHistory, AddressData, AND DevBalance per explorer.go:84-86)
- Add empty `ActiveCoins` default

**Verification**: Test files compile

---

### Phase 2: Query Layer (Tasks 7-12)

#### Task 7: New coin type query
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

#### Task 8: Fix retrieveAddressBalance
**Files**: `db/dcrpg/queries.go` (around line 1453-1529)

Modify to preserve coin type dimension:
- SQL already groups by `coin_type` (addrstmts.go:220-232)
- Stop collapsing into single int64
- Populate new `Coins` map instead of flat totals
- Handle VAR (int64) vs SKA (string) separately

**Verification**: Query returns per-coin breakdown

---

#### Task 9: Fix ReduceAddressHistory
**Files**: `db/dbtypes/types.go` (around line 2380+)

- When `addrOut.CoinType != 0`, use SKA string fields
- Build per-coin totals in new structure instead of flat sum
- Don't use `dcrutil.Amount(addrOut.Value).ToCoin()` for SKA
- Precompute `TotalReceived` and `TotalReceivedSKA` per coin

**Verification**: Mixed addresses don't sum incorrectly

---

#### Task 10: Update AddressHistory
**Files**: `db/dcrpg/pgblockchain.go` (around line 2445-2496)

- Call `retrieveAddressCoinTypes`
- Set `AddressInfo.ActiveCoins`
- Build `AddressBalance.Coins` from query results

**Verification**: AddressData returns ActiveCoins populated

---

#### Task 11: Server-side cumulative balance
**Files**: `db/dcrpg/queries.go` (around line 4139-4163 - `parseRowsSentReceived`)

Modify to compute running balance in Go via `*big.Int.Add`:
- For VAR: compute running balance as `[]float64` (existing pattern)
- For SKA: compute running balance as `[]string` using `*big.Int`
- Populate `BalanceAtoms`, `ReceivedAtoms`, `SentAtoms`, `NetAtoms` in response

**Rationale**: Per Charts spec §3.3.1 - JS never does BigInt arithmetic. Balance cumsum must be in Go.

**Verification**: Chart endpoint returns monotonically updating balance series

---

#### Task 12: Fix stake metrics VAR-only
**Files**: `db/dcrpg/queries.go` (around line 1518-1524)

Compute `FromStake` and `ToStake` from VAR atoms only:
- Current query is coin-flattened, producing meaningless ratio on mixed addresses
- Filter to `coin_type = 0` when computing stake percentages

**Verification**: Stake % reflects actual VAR stake activity

---

### Phase 3: Mempool (Tasks 13-14)

#### Task 13: Unconfirmed transactions per-coin
**Files**: `db/dcrpg/pgblockchain.go` (around line 2587-2592), `mempool/` package

- Modify `pgb.mp.UnconfirmedTxnsForAddress` to return `map[uint8]int64` (per Summary spec §3.5, §6.4)
- Add `NumUnconfirmedByCoin` field to `AddressInfo`

**Verification**: Unconfirmed count broken down by coin type

---

#### Task 14: Mempool overlay coin-awareness
**Files**: `db/dcrpg/pgblockchain.go` (around line 2632-2634, 2693-2695)

- Modify mempool overlay to populate `CoinType` and `SKAValue` per row
- Don't route everything through `dcrutil.Amount(...).ToCoin()`

**Verification**: Mempool transactions include coin type

---

### Phase 4: API & Handler (Tasks 15-21)

#### Task 15: Add ?coin= to chart API endpoints
**Files**:
- `cmd/dcrdata/internal/api/apirouter.go`
- `cmd/dcrdata/internal/api/apiroutes.go`

Add coin filter to routes:
- `/api/address/{address}/types/{chartgrouping}?coin=N`
- `/api/address/{address}/amountflow/{chartgrouping}?coin=N`
- **Default behavior**: Use **first member of ActiveCoins** (VAR if present, else first SKA) - not always VAR
- Return error for invalid coin type

**Verification**: `GET /api/address/{addr}/types/day?coin=1` returns SKA1 data

---

#### Task 16: Update TxHistoryData for coin filtering
**Files**: `db/dcrpg/pgblockchain.go` (around line 3112-3182)

- Add coin type parameter to interface and implementation
- Modify SQL queries to filter by `coin_type`
- Return per-coin chart series with server-side cumsum (from Task 11)

**Verification**: Different coin params return different data with correct cumsum

---

#### Task 17: CSV download backend
**Files**:
- `db/dbtypes/types.go` - extend `AddressRowCompact`
- `cmd/dcrdata/internal/api/apiroutes.go` (around line 1729-1775)

- Extend `AddressRowCompact` (`db/dbtypes/types.go:1299-1309`) with `CoinType uint8` and `SKAValue string`
- Modify CSV serializer to emit `coin_type` + single string `amount` column instead of `dcrutil.Amount(...).ToCoin()`
- Add `?coin=` to cache key (180s cached route)

**Verification**: CSV includes coin type column, SKA amounts as strings

---

#### Task 18: AddressTable XHR parity
**Files**: `cmd/dcrdata/internal/explorer/explorerroutes.go`

- Parse `?coin=` in `AddressTable` handler (`:1654`) - same as `AddressPage`
- Apply coin filter to `mergedTxnCount` (`pgblockchain.go:2300-2331`)

**Rationale**: Per Transactions spec §8 - XHR refresh must paginate over same row set as initial SSR

**Verification**: XHR returns same filtered rows as SSR

---

#### Task 19: Update address handler
**Files**: `cmd/dcrdata/internal/explorer/explorerroutes.go`

- Add `?coin=` parsing in `parseAddressParams`
- Validate coin is in `ActiveCoins` (if specified)
- Pass coin filter to chart endpoints
- **Table**: empty `?coin=` means "all coins" (no filter)
- **Charts**: empty `?coin=` defaults to first ActiveCoins (per Task 15)

**Verification**: URL changes reflect in responses

---

#### Task 20: Summary ignores ?coin=
**Files**: `cmd/dcrdata/internal/explorer/explorerroutes.go`, `db/dcrpg/pgblockchain.go`

- `AddressData` populates `Coins` map for **all** `ActiveCoins` regardless of `?coin=` filter
- Summary card always shows full per-coin breakdown
- Only charts and transactions table respect `?coin=` filter

**Rationale**: Per Overview §4 and Summary §1 - summary always displays all coins

**Verification**: Summary shows all ActiveCoins even when ?coin= specified

---

#### Task 21: Remove fiat conversion
**Files**: `cmd/dcrdata/internal/explorer/explorerroutes.go`

Per Summary spec §3.7: fiat removed because **no coin in the network has a real market price** - not just SKA. VAR also has no exchange price.
- Remove `FiatBalance` field from `AddressPageData` (inline payload at `:1543`)
- Remove `xcBot.Conversion` call at `:1617`
- Template must not expect FiatBalance

**Verification**: Page renders without fiat errors

---

### Phase 5: Caching (Tasks 22-23)

#### Task 22: Extend address cache key
**Files**: `db/cache/addresscache.go`

- Add coin type to cache key (e.g., `address + coin_type`)
- Handle backward compatibility (existing VAR-only cache entries)

**Verification**: Different coins cache separately

---

#### Task 23: Cache per-coin data
**Files**: `db/cache/addresscache.go`

- Store `ActiveCoins` with address data
- Cache per-coin balance map
- Ensure invalidation works for multi-coin

**Verification**: Cached data matches fresh query

---

### Phase 6: Testing (Tasks 24-26)

#### Task 24: Unit tests for types
**Files**: `db/dbtypes/types_test.go` (create if needed)

- Test `CoinBalance` JSON marshaling (SKA as string)
- Test `AddressBalance` per-coin map population
- Test `ActiveCoins` sorting (ascending)
- Test `ChartsData` extension (BalanceAtoms, etc.)

**Verification**: All tests pass (in-memory)

---

#### Task 25: Integration tests for queries
**Files**: `db/dcrpg/pgblockchain_test.go` (or existing test file)

- Create test address with VAR + SKA
- Verify `ActiveCoins` returns [0, 1] for mixed
- Verify per-coin balances correct
- Verify server-side cumsum produces correct BalanceAtoms

**Verification**: All tests pass (in-memory with mocks)

---

#### Task 26: API endpoint tests
**Files**: `cmd/dcrdata/internal/api/apiroutes_test.go`

- Add `?coin=` param tests for chart endpoints
- Test default behavior (first ActiveCoins, not always VAR)
- Test invalid coin type error handling (404 or 400)
- Test CSV download includes coin_type column

**Verification**: All tests pass (in-memory)

---

## Risk Areas

| Risk | Impact | Mitigation |
|------|--------|------------|
| Breaking existing AddressInfo consumers | High | Update all callers in same PR |
| Cache invalidation on multi-coin | Medium | Test invalidation thoroughly |
| Performance on address with many coins | Medium | Index on (address, coin_type) already exists |
| Template changes required | High | Coordinate with frontend team |
| Server-side cumsum complexity | Medium | Test with large transaction histories |

---

## Key Invariants

From `wiki/specs/address-overview/spec.md`:

1. **Address is multi-coin**: One address can hold VAR + multiple SKA types
2. **Conditional display**: VAR always shown; SKA only if in `ActiveCoins`
3. **Precision**: SKA atoms pass as strings through all layers - no `float64`
4. **URL contract**: `?coin=` shared between charts and transactions; changing it resets `?start=0`
5. **Coin labels**: Only through `coinSymbol()` (Go) or `renderCoinType()` (JS)
6. **Computation in Go**: All atom arithmetic in backend, template only does formatting
7. **Precomputation**: Per-coin totals precomputed in Go to avoid template string arithmetic
8. **Charts defaults**: First ActiveCoins; Table defaults to all coins
9. **Summary ignores ?coin=**: Always shows all ActiveCoins

---

## Summary

| Phase | Tasks | Description |
|-------|-------|-------------|
| Types & Mocks | 1-6 | Data structure changes |
| Query Layer | 7-12 | Database layer + stake metrics fix |
| Mempool | 13-14 | Unconfirmed transactions per-coin |
| API/Handler | 15-21 | HTTP layer + CSV + XHR parity |
| Caching | 22-23 | Performance layer |
| Testing | 24-26 | Validation |

**Total: 26 sequential tasks**

---

## Answered Questions (from specs)

These questions were answered in the specs - no need to revisit:

1. **Deprecated fields**: `TotalUnspent`/`TotalSpent` - removed, replaced by `Coins map[uint8]*CoinBalance` (Overview §7.1)
2. **Empty ActiveCoins**: Summary spec §3.8 specifies empty state explicitly
3. **Cache backward compatibility**: `AddressCache` is in-memory (rebuilt per process), not persistent - not an issue