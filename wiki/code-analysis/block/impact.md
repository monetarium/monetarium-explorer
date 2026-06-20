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

## 5. MiningFee / FeeReward Parity

`computeMinerVARFeeAtoms` (in `blockdata/blockdata.go`) and `TxInfo.FeeReward()` (in `explorertypes.go`) use the same conservation formula for the coinbase tx. They are kept consistent by construction.

- Changing `computeMinerVARFeeAtoms` without reviewing `FeeReward()` breaks this parity.
- `HomeInfo.LBlockTotal` and `LBlockTotalAtoms` depend on `MiningFeeAtoms` + `CBlockSubsidy.PoW`.

---

## 6. CBlockSubsidy Mutation

`HomeInfo.CBlockSubsidy` carries the actual vote-scaled subsidy for the current block.

- Both `explorerUI.Store()` and `PubSubHub.Store()` must be updated together.
- `LBlockTotal` / `LBlockTotalAtoms` use `CBlockSubsidy.PoW` — not `NBlockSubsidy.PoW`.
- `mining_controller.js` reads `cblock_subsidy.pow` from WS (with `subsidy.pow` fallback).

Risk: using `NBlockSubsidy.PoW` silently wrong-values `LBlockTotal` for blocks with fewer than 5 votes.

---

## 7. Loud Failures

These will break immediately:

- Changing `map[uint8]string` → different type
- Changing struct fields used in:
  - `explorerUI`
  - `PubSubHub`
- Breaking `wire.MsgBlock` assumptions

---

## 8. Silent Failures (High Risk)

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

---

## 9. Safe Change Checklist

Before committing changes:

- [ ] explorerUI updated
- [ ] PubSubHub updated (mirror explorerUI exactly for HomeInfo fields)
- [ ] frontend controllers verified (mining, supply, home_latest_blocks, blocks)
- [ ] API responses checked (REST + WS)
- [ ] DB logic reviewed (`dbtypes`)
- [ ] no precision loss introduced
- [ ] CBlockSubsidy.PoW used for LBlockTotal (not NBlockSubsidy)
- [ ] latestBlocksEnd / homeBlocksSpan not diverged between Home() and WS handler
