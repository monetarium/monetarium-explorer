# Block Domain – Mutation Impact

## When modifying: BlockData or block-related logic

You MUST verify all of the following layers.

---

## 1. Direct Consumers

### explorerUI

- File: `explorer.go`
- Risk: compile-time break if structure changes
- Dependency: `map[uint8]string` → slice conversion, CBlockSubsidy population, ActiveMiners query

### PubSubHub

- File: `pubsubhub.go`
- Risk: compile-time break + WebSocket payload mismatch
- Dependency: same transformation logic as explorerUI; CBlockSubsidy + ActiveMiners must mirror explorer.go

---

## 2. Frontend Dependencies

### Stimulus Controllers

- `mining_controller.js`: reads `cblock_subsidy.pow` (with fallback to `subsidy.pow`), `active_miners`
- `supply_controller.js`: reads multi-coin supply arrays
- `home_latest_blocks_controller.js`: subscribes to `getlatestblocksResp`; rebuilds home block table
- `blocks_controller.js`: subscribes to `getlatestblocksResp`; rebuilds /blocks page on reconnect/gap

Expect:
- array format for multi-coin amounts
- raw integer strings (no formatting)
- `cblock_subsidy.pow` as integer atoms (divide by 1e8 to get VAR)

Risk:

- NaN errors from formatted strings
- broken DOM updates
- stale table after reconnect if `getlatestblocks` response diverges from server-render

---

## 3. Serialization Boundaries

### REST API

- File: `api/apiroutes.go`
- Format: map-based JSON

### WebSocket API

- File: `pubsubhub.go`
- Format: array-based JSON

Risk:

- breaking one interface but not the other

### getlatestblocks WS Pull

- File: `websockethandlers.go`, `explorerroutes.go` (`latestExplorerBlocks`)
- Format: `[]*BlockBasic` JSON
- Risk: if `latestBlocksEnd()` or `homeBlocksSpan` diverges from `Home()`, client refresh shows wrong row range

---

## 4. Database Layer (Critical Divergence)

### ChainDB

- File: `pgblockchain.go`

### Conversion

- File: `dbtypes/conversion.go`

Important:

- DOES NOT use `BlockData`
- recalculates everything from `wire.MsgBlock`

Risk:

- UI and DB diverge silently

---

## 5. RemainingWindowText / Window Countdown Parity

`RemainingWindowText(idx, max, blockTime)` in `explorer/types/remaining.go` is the single source of truth for the window countdown string (ticket-price window: `WindowRemaining`; subsidy-reduction window: `RewardRemaining`). Both fields are pre-computed in `explorerUI.Store()` (explorer.go:568,570) and `PubSubHub.Store()` (pubsubhub.go:734,736).

- Changing `RemainingWindowText` behavior/signature affects server-rendered page template AND live WS updates simultaneously.
- `voting_controller.js:35` reads `ex.window_remaining` directly as DOM text (no parsing); `mining_controller.js:48` reads `ex.reward_remaining`. A format change is reflected automatically but must be intentional.
- Both Store() call-sites use different `max` params (`WindowSize` vs `RewardWindowSize`) — verify both when changing the function.

Risk: changing only one Store() call-site → template vs WS divergence.

---

## 6. Chart Tip Alignment

`explorerUI.Store()` at `explorer.go:652-665` type-asserts `exp.chartSource` to `*cache.ChartData` and calls `cd.SetTip(cache.ChartTip{Height, Time, TicketPrice, Difficulty, PoolValue, CoinSupply})` on every block.

- `SetTip` invalidates cached chart series that depend on the live tip (calls `invalidateTipCharts()`); the next `Chart()` request re-runs the maker with fresh values.
- This path is NOT present in `PubSubHub.Store()` — intentional asymmetry.
- Test stubs implementing `ChartDataSource` are exempt (type assertion misses).
- `cache.ChartTip` fields are all VAR-only numeric types (`uint64` atoms, `float64` difficulty); no SKA precision concern here.

Risk: updating how `HomeInfo` computes `TicketPrice`/`Difficulty`/`PoolValue`/`CoinSupply` without updating the `SetTip` call → chart last data point silently mismatches home page.

---

## 8. MiningFee / FeeReward Parity

`computeMinerVARFeeAtoms` (in `blockdata/blockdata.go`) and `TxInfo.FeeReward()` (in `explorertypes.go`) use the same conservation formula for the coinbase tx. They are kept consistent by construction.

- Changing `computeMinerVARFeeAtoms` without reviewing `FeeReward()` breaks this parity.
- `HomeInfo.LBlockTotal` and `LBlockTotalAtoms` depend on `MiningFeeAtoms` + `CBlockSubsidy.PoW`.

---

## 9. CBlockSubsidy Mutation

`HomeInfo.CBlockSubsidy` carries the actual vote-scaled subsidy for the current block.

- Both `explorerUI.Store()` and `PubSubHub.Store()` must be updated together.
- `LBlockTotal` / `LBlockTotalAtoms` use `CBlockSubsidy.PoW` — not `NBlockSubsidy.PoW`.
- `mining_controller.js` reads `cblock_subsidy.pow` from WS (with `subsidy.pow` fallback).

Risk: using `NBlockSubsidy.PoW` silently wrong-values `LBlockTotal` for blocks with fewer than 5 votes.

---

## 10. Loud Failures

These will break immediately:

- Changing `map[uint8]string` → different type
- Changing struct fields used in:
  - `explorerUI`
  - `PubSubHub`
- Breaking `wire.MsgBlock` assumptions

---

## 11. Silent Failures (High Risk)

### Precision corruption

- converting SKA to float/int
- formatting values before frontend

### UI inconsistencies

- mismatch between:
  - server templates
  - WebSocket updates

### DB vs UI divergence

- changing Collector logic only

### Vote-scaled subsidy wrong

- using NBlockSubsidy instead of CBlockSubsidy for LBlockTotal

### Block list mismatch

- diverging `latestBlocksEnd()` between `Home()` and `latestExplorerBlocks()`

### Chart last-data-point mismatch

- updating Home page values (TicketPrice/Difficulty/PoolValue/CoinSupply) without updating `SetTip` call in `explorer.go:652-665`

### Window countdown mismatch

- changing `RemainingWindowText` formatting without checking both `voting_controller.js` (window_remaining) and `mining_controller.js` (reward_remaining) consumers

---

## 12. Safe Change Checklist

Before committing changes:

- [ ] explorerUI updated
- [ ] PubSubHub updated (mirror explorerUI exactly for HomeInfo fields: CBlockSubsidy + ActiveMiners + WindowRemaining + RewardRemaining)
- [ ] frontend controllers verified (mining, supply, home_latest_blocks, blocks, voting)
- [ ] API responses checked (REST + WS)
- [ ] DB logic reviewed (`dbtypes`)
- [ ] no precision loss introduced
- [ ] CBlockSubsidy.PoW used for LBlockTotal (not NBlockSubsidy)
- [ ] latestBlocksEnd / homeBlocksSpan not diverged between Home() and WS handler
- [ ] if RemainingWindowText changed: verify voting_controller.js (window_remaining) + mining_controller.js (reward_remaining)
- [ ] if home chart values (TicketPrice/Difficulty/PoolValue/CoinSupply) changed: update SetTip at explorer.go:652-665
