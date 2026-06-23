RPC → Notifier → ChainMonitor → Collector → BlockData → BlockDataSaver
→ [ChainDB (MsgBlock) | explorerUI (HomeInfo) | PubSubHub (HomeInfo)]
→ [Templates | WebSocket → Stimulus JS]

Pull path: JS sends `getlatestblocks` → websockethandlers.go → latestExplorerBlocks() → DB → BlockBasic[] → blocks_controller / home_latest_blocks_controller rebuilds table

Key Patterns:

- **Fan-out architecture** via BlockDataSaver (3 independent consumers)
- **Multi-source-of-truth:** Collector (UI path) ≠ dbtypes (DB path)
- **Duplication:** explorerUI ≈ PubSubHub (same map → array + CBlockSubsidy + ActiveMiners + WindowRemaining + RewardRemaining)
- **API divergence:** REST (map) vs WebSocket (array)
- **getlatestblocks pull path:** clients send a reconnect or gap-triggered list rebuild request; span is client-supplied, capped at maxExplorerRows
- **homeBlocksSpan single source:** Home() and latestExplorerBlocks() share latestBlocksEnd(); divergence = list mismatch
- **RemainingWindowText single source (PR #502):** `explorer/types/remaining.go:RemainingWindowText` pre-computes `WindowRemaining` (ticket-price window) and `RewardRemaining` (subsidy window) formatted strings in both explorerUI.Store() and PubSubHub.Store(); same function used by template `remaining` func → server-render and WS live update cannot diverge
- **Chart tip alignment:** `explorerUI.Store()` type-asserts `chartSource` to `*cache.ChartData` and calls `SetTip(ChartTip{...})` on each block; invalidates tip-dependent chart caches; no-ops on test stubs; not present in PubSubHub path

Critical Constraints:

- SKA: `big.Int → string` (no float, no formatting before frontend)
- DB ignores `BlockData.ExtraInfo` (always recomputes from `wire.MsgBlock`)
- Frontend requires arrays (not maps) + stable ordering
- `CBlockSubsidy.PoW` (vote-scaled actual, from `GetBlockSubsidy(height, header.Voters)`) MUST be used for LBlockTotal — `NBlockSubsidy.PoW` gives wrong values on low-vote blocks
- `computeMinerVARFeeAtoms` uses conservation (Σ VAR outputs − Σ inputs) = PoW-Reward tx FeeReward by construction
- `ActiveMiners` DB queries are hoisted above PubSubHub lock to avoid blocking WS readers
- `WindowRemaining` / `RewardRemaining` are pre-computed strings (not raw numbers); JS (`voting_controller.js`, `mining_controller.js`) writes them directly to DOM via `textContent`

Mutation Checklist:

- update `blockdata.Collector` (if logic changes)
- update `dbtypes.MsgBlockToDBBlock` (or DB/UI diverge)
- check `explorerUI.Store` AND `PubSubHub.Store` together (both need CBlockSubsidy + ActiveMiners + WindowRemaining + RewardRemaining)
- if changing `RemainingWindowText`: verify both Store() call-sites + template `remaining` func; check `voting_controller.js` (window_remaining) and `mining_controller.js` (reward_remaining)
- if changing chart fields (TicketPrice, Difficulty, PoolValue, CoinSupply): update `SetTip` call at `explorer.go:652-665`
- verify REST vs WebSocket schemas
- verify template vs WebSocket consistency
- verify JS parsing (`amount` must remain raw string → otherwise NaN)
- on `latestBlocksEnd`/`homeBlocksSpan` change: verify Home() + WS getlatestblocks return same range

Silent Risks:

- changing Collector → affects UI only (DB stays old)
- formatting numbers on backend → breaks JS parsing
- using NBlockSubsidy instead of CBlockSubsidy → wrong LBlockTotal on <5-vote blocks
- updating only one of explorerUI/PubSubHub → page-load vs WS state split
- forgetting SetTip update → chart last data point mismatches home page

Loud Failures:

- changing `map[uint8]string` → breaks explorer + pubsub
- changing `wire.MsgBlock` → breaks ingestion + DB
