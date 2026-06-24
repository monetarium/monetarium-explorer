### 1. Overview

Tracing the flow of block data (specifically `blockdata.BlockData` and multi-coin data like `CoinAmounts`) from initial RPC ingestion through backend aggregation, database persistence, and outward to the UI templates and WebSocket consumers.

Includes: `MiningFeeAtoms` computation, `CBlockSubsidy` (vote-scaled current-block subsidy), `ActiveMiners` live count, and the `getlatestblocks` pull path that lets JS controllers rebuild a block table after a reconnect or height gap.

### 2. End-to-End Data Flow

**Push path (new block arrives):**
`dcrd` RPC Node → `notification.Notifier` (receives hash) → `blockdata.ChainMonitor` (fetches `wire.MsgBlock`) → `blockdata.Collector.CollectBlockInfo` (transforms to `BlockData`) → `BlockDataSaver` Interface (fan-out) →
↳ `ChainDB` — Database persistence via `pgblockchain.go` / `dbtypes.MsgBlockToDBBlock`
↳ `explorerUI.Store()` — Transforms to `HomeInfo` state → Go `html/template` engine
↳ `PubSubHub.Store()` — Transforms to `HomeInfo` state → JSON WebSockets → Stimulus JS Controllers

**Pull path (JS requests list rebuild):**
Client WS sends `{event_id:"getlatestblocks", message:"<span>"}` → `websockethandlers.go` → `clampLatestBlocksSpan()` → `exp.latestExplorerBlocks(ctx, span)` → `pgblockchain.GetExplorerBlocks` → `[]*BlockBasic` JSON → `blocks_controller.js` / `home_latest_blocks_controller.js` rebuilds table

**CBlockSubsidy/ActiveMiners sub-flow (inside Push path):**
`CollectBlockInfo` calls `GetBlockSubsidy(height, header.Voters)` → `ExtraInfo.CurrentBlockSubsidy` → both `explorerUI.Store()` and `PubSubHub.Store()` copy it to `HomeInfo.CBlockSubsidy` → WS broadcasts `cblock_subsidy` → `mining_controller.js` reads `cblock_subsidy.pow`

### 3. Per-Layer Breakdown

**Layer 1: Ingestion & Hydration**

- **Location:** `cmd/dcrdata/internal/notification/notifier.go`, `blockdata/chainmonitor.go`
- **Data Structures:** `wire.BlockHash`, `wire.MsgBlock`
- **Transformations:** Bare block hashes are queued. `ChainMonitor` fetches the full `wire.MsgBlock` structure from the node via RPC.

**Layer 2: Collection (API/UI Path)**

- **Location:** `blockdata/blockdata.go` (`Collector.CollectBlockInfo`)
- **Data Structures:** `wire.MsgBlock` → `blockdata.BlockData` / `apitypes.BlockExplorerExtraInfo`
- **Transformations:**
  - Calls `GetBlockSubsidy(height, header.Voters)` (actual vote count, not hardcoded 5) for `ExtraInfo.CurrentBlockSubsidy` and `ExtraInfo.NextBlockSubsidy`.
  - Calls `computeMinerVARFeeAtoms(msgBlock)` — **conservation approach**: `Σ(VAR outputs in coinbase) − Σ(coinbase inputs)`. This matches the PoW-Reward tx page's FeeReward by construction. Result stored as `ExtraInfo.MiningFeeAtoms`.
  - Calls `blockCoinAmounts(msgBlock)` — iterates tx outputs, accumulates VAR and SKA values using `big.Int` arithmetic. SKA values are serialized as exact decimal strings in `ExtraInfo.CoinAmounts map[uint8]string`.

**Layer 3A: Persistence (Database Path)**

- **Location:** `db/dcrpg/pgblockchain.go` (`StoreBlock`), `db/dbtypes/conversion.go` (`MsgBlockToDBBlock`)
- **Data Structures:** `wire.MsgBlock` → `dbtypes.Block`
- **Transformations:** Ignores `BlockData.ExtraInfo` entirely. Manually recalculates `CoinAmounts` and `CoinTxStats` from scratch from `wire.MsgBlock`, storing the resulting structures natively in PostgreSQL `JSONB` columns.

**Layer 3B: Presentation State (Explorer)**

- **Location:** `cmd/dcrdata/internal/explorer/explorer.go` (`explorerUI.Store()`)
- **Data Structures:** `BlockData` → `HomeInfo` (`exptypes.PoWSKAReward`, `exptypes.BlockSubsidy`)
- **Transformations:**
  - Queries `dataSource.ActiveMiners(ctx, minHeight)` (DB round-trip, 7-day lookback via `GetHeightByTimestamp`) → `HomeInfo.ActiveMiners`.
  - Copies `ExtraInfo.CurrentBlockSubsidy` into `HomeInfo.CBlockSubsidy`; falls back to `NBlockSubsidy` if `CurrentBlockSubsidy.PoW == 0`.
  - `LBlockTotal = CBlockSubsidy.PoW + MiningFeeAtoms` (vote-scaled subsidy + miner fee).
  - Sorts `map[uint8]string` → `[]PoWSKAReward` for frontend.
  - **New (PR #502):** Calls `types.RemainingWindowText(IdxBlockInWindow, WindowSize, BlockTime)` → `HomeInfo.WindowRemaining` (ticket-price window countdown) and `types.RemainingWindowText(IdxInRewardWindow, RewardWindowSize, BlockTime)` → `HomeInfo.RewardRemaining` (subsidy-reduction window countdown). Both are pre-computed formatted strings ("1d 2h 30m remaining" / "imminent"); function lives in `explorer/types/remaining.go`.
  - **New (chart alignment):** Type-asserts `exp.chartSource` to `*cache.ChartData`; if successful, calls `cd.SetTip(cache.ChartTip{Height, Time, TicketPrice, Difficulty, PoolValue, CoinSupply})`. This invalidates cached chart series that depend on the live tip so the next chart request re-runs the maker with fresh values. No-ops when a test stub is wired in (assertion misses).

**Layer 3C: Presentation State (PubSubHub)**

- **Location:** `pubsub/pubsubhub.go` (`PubSubHub.Store()`)
- **Data Structures:** Same `BlockData` → `GeneralInfo *HomeInfo`
- **Transformations:** Mirrors `explorerUI.Store()` exactly. Also hoists `GetHeightByTimestamp` + `ActiveMiners` DB queries **above** the `p.mtx.Lock()` to avoid blocking WS readers during DB round-trips. Both `CBlockSubsidy` and `ActiveMiners` are populated identically to the explorer path. **New (PR #502):** Also computes `WindowRemaining` and `RewardRemaining` via the same `exptypes.RemainingWindowText()` calls as `explorerUI.Store()` — these fields must stay in sync (C3 parity). No chart tip push in this path (chart alignment is explorer-only).

**Layer 4: Pull Path — Latest Blocks**

- **Location:** `cmd/dcrdata/internal/explorer/explorerroutes.go`, `websockethandlers.go`
- **Data Structures:** `[]*types.BlockBasic`
- **Transformations:**
  - `clampLatestBlocksSpan(message string)` parses the WS message as a page size; empty/invalid falls back to `homeBlocksSpan = 8`; any value is capped at `maxExplorerRows = 400`.
  - `latestBlocksEnd(height, span)` is the single source of truth for the GetExplorerBlocks `end` argument — both `Home()` and `latestExplorerBlocks()` call it. Clamps to -1 (never below genesis).
  - `latestExplorerBlocks()` filters out zero-value placeholder blocks (empty hash) before returning.
  - Same span logic in `Blocks()` via `normalizeExplorerRows()` defaults to 100 rows and `IsLatest` flag.

**Layer 5: JS Controllers (Consumer)**

- **Location:** `cmd/dcrdata/public/js/controllers/mining_controller.js`, `supply_controller.js`, `home_latest_blocks_controller.js`, `blocks_controller.js`, `voting_controller.js`
- **Data Structures:** JSON from WS `getlatestblocksResp` / push `extra`
- **Transformations:**
  - `mining_controller.js`: reads `(ex.cblock_subsidy || ex.subsidy).pow / 1e8` for PoW reward. Renders `active_miners` count. **New (PR #502):** reads `ex.reward_remaining` (pre-computed formatted string from `RemainingWindowText`) into `rewardRemainingTarget`.
  - `voting_controller.js`: **New (PR #502):** reads `ex.window_remaining` (pre-computed formatted string) into `windowRemainingTarget`. Previously this was a static server-render; now the countdown updates live on every block.
  - `home_latest_blocks_controller.js`: subscribes to `getlatestblocksResp` + `reconnect` events; on each, sends `getlatestblocks` and rebuilds the home block table via `_refreshList`.
  - `blocks_controller.js`: same reconnect/gap pattern as home; additionally sends the page row count as message so the server returns the right span; gate refreshes to `IsLatest` page only.

### 4. Cross-Layer Dependencies

- **`BlockData.ExtraInfo` Coupling:** `explorerUI` and `PubSubHub` are highly coupled to the specific map signatures generated by `blockdata.Collector`.
- **API Boundary Drift:** REST API JSON exposes `map[uint8]string` (`{"0":"...","1":"..."}`). WebSocket API emits sorted arrays (`[{coin_type: 1, amount: "..."}]`). Frontend strictly depends on the WS array schema.
- **Template + WebSocket Parity (C3):** `explorerUI.Store()` and `PubSubHub.Store()` must populate `HomeInfo` identically — any field added to one must be added to the other. `CBlockSubsidy`, `ActiveMiners`, `WindowRemaining`, and `RewardRemaining` are all present in both paths; a future field addition here is a two-file change. `WindowRemaining` / `RewardRemaining` (string) are now pre-computed via `RemainingWindowText()` in both paths — the template `remaining` func and WS payload builder call the same function (issue #502 fix; single source of truth in `explorer/types/remaining.go`).
- **`homeBlocksSpan` Single Source:** The `homeBlocksSpan = 8` constant and `latestBlocksEnd()` helper in `explorerroutes.go` are shared by `Home()` (server-render) and `latestExplorerBlocks()` (WS pull). If either is diverged, the home table and the reconnect-refresh show different block ranges. `blocks_controller.js` passes its own `rowsValue` as the span to correctly size /blocks refreshes.
- **MiningFee → FeeReward Parity:** `computeMinerVARFeeAtoms` now uses the same conservation formula as the PoW-Reward tx page's `TxInfo.FeeReward()`. They are by-construction consistent — but only for the coinbase tx. Modifying either independently breaks this invariant silently.
- **`ActiveMiners` Lock Order:** In `PubSubHub.Store()`, the `GetHeightByTimestamp` + `ActiveMiners` DB queries run **before** `p.mtx.Lock()`. Reversing this order would block WS readers for the duration of two DB round-trips.

### 5. Critical Constraints

- **Independent Multi-Coin Re-calculation:** `Collector` and `dbtypes.MsgBlockToDBBlock` independently compute the same `big.Int` extraction. C2 applies.
- **CBlockSubsidy vs NBlockSubsidy:** `CBlockSubsidy` is the vote-scaled actual subsidy for the current block (`GetBlockSubsidy(height, header.Voters)`); `NBlockSubsidy` is the estimated next-block subsidy. `LBlockTotal`/`LBlockTotalAtoms` MUST use `CBlockSubsidy.PoW` — using `NBlockSubsidy.PoW` gives a wrong value whenever a block has fewer than 5 votes.
- **High-Precision Numeric Handling (C1):** At no point before hitting JavaScript do SKA coin amounts ever become floats or integers in the Go codebase. They are maintained as `*big.Int`, stored as `string`, broadcast as `string`, and parsed locally on the client.
- **Array-based Frontend Logic (C4):** Even though backend maps coins by numeric ID, the frontend requires a sorted array. Both `explorer.go` and `pubsubhub.go` perform duplicate `sort.Slice` operations.
- **getlatestblocks cap (security):** `clampLatestBlocksSpan()` caps client-supplied spans at `maxExplorerRows = 400`. Removing this cap allows any unauthenticated WS client to trigger a tip-to-genesis DB scan.
- **RemainingWindowText single source (issue #502):** `explorer/types/remaining.go:RemainingWindowText(idx, max, blockTime)` is the single source of truth for countdown strings. Both the Go template `remaining` func and the WS payload builders (`explorerUI.Store()` and `PubSubHub.Store()`) call it. A change here affects server-rendered pages AND live WS updates simultaneously — they cannot diverge.
- **Chart tip push (concrete-type assertion):** `explorerUI.Store()` calls `cd.SetTip()` only if `exp.chartSource.(*cache.ChartData)` succeeds. This is intentional: test stubs implementing `ChartDataSource` are exempt. The push invalidates tip-dependent chart caches (`invalidateTipCharts()`), so the next `Chart()` request re-runs the maker with fresh RPC values for the last data point.

### 6. Mutation Impact

**When modifying `BlockData` or multi-coin extraction logic:**
- Direct: `explorerUI.Store`, `PubSubHub.Store`
- Indirect: `mining_controller.js`, `supply_controller.js` (array structure assumptions)
- Serialization: `apiroutes.go` JSON payloads vs WebSocket JSON encoding
- Database: `db/dbtypes/conversion.go` (does not use `BlockData`)

**When modifying `computeMinerVARFeeAtoms`:**
- Also affects the PoW-Reward tx page's `FeeReward()` display — they use the same conservation formula. Changing one without reviewing the other silently breaks parity.
- Also affects `HomeInfo.LBlockTotal` / `LBlockTotalAtoms` (both `explorerUI` and `PubSubHub`).

**When modifying `HomeInfo.CBlockSubsidy` or `ExtraInfo.CurrentBlockSubsidy`:**
- Breaks vote-scaled PoW reward on home mining card (WS delivery via `cblock_subsidy.pow`).
- Both `explorerUI.Store()` and `PubSubHub.Store()` must be updated together (C3).

**When modifying `HomeInfo.WindowRemaining` or `HomeInfo.RewardRemaining`:**
- Both `explorerUI.Store()` (explorer.go:568,570) and `PubSubHub.Store()` (pubsubhub.go:734,736) compute these via `RemainingWindowText()`. A change to the function signature or behavior simultaneously affects: server-rendered template, WS live update on `voting_controller.js` (`window_remaining`), WS live update on `mining_controller.js` (`reward_remaining`).
- Changing `RemainingWindowText` parameters (`idx`, `max`, `blockTime`) here requires checking both Store() call-sites — different params for `WindowRemaining` (uses `WindowSize`) vs `RewardRemaining` (uses `RewardWindowSize`).

**When modifying the chart tip push (`explorerUI.Store()` → `cache.ChartData.SetTip`):**
- Affects cached chart series for `TicketPrice`, `Difficulty`, `PoolValue`, `CoinSupply` — the last chart data point will no longer align with the home page's current value.
- `SetTip` is only in `explorerUI.Store()`, not `PubSubHub.Store()` — intentional; chart alignment is not a WS concern.
- Changing `cache.ChartTip` fields requires updating the push in `explorer.go:652-665`.

**When modifying `homeBlocksSpan`, `latestBlocksEnd()`, or `latestExplorerBlocks()`:**
- `Home()` server-rendered block list and WS `getlatestblocks` response diverge.
- Both `home_latest_blocks_controller.js` (home) and `blocks_controller.js` (/blocks) depend on this path.

**When modifying `HomeInfo` fields:**
- Must update both `explorerUI.Store()` (explorer.go) and `PubSubHub.Store()` (pubsubhub.go) together.
- Must update `mining_controller.js` WS field reads if WS shape changes.

**What will fail loudly (compile/runtime errors):**
- Modifying `BlockData.ExtraInfo` map signatures (`map[uint8]string`) will break compilation in `explorer.go` and `pubsubhub.go`.
- Renaming fields in `wire.MsgBlock` will cause immediate ingestion panics in both `chainmonitor.go` and `pgblockchain.go`.

**What will silently break (wrong data, UI bugs):**
- Altering calculation logic inside `blockdata.Collector` will only impact the Web UI, causing the Web UI to diverge silently from Postgres historical data.
- Introducing decimal placement or commas into the strings at the backend aggregation layer will cause JavaScript parsing (`r.amount`) to return `NaN`, destroying the live Web UI without logging backend errors.
- Using `NBlockSubsidy.PoW` instead of `CBlockSubsidy.PoW` for `LBlockTotal` shows wrong values on low-vote blocks.

### 7. Common Pitfalls

- **Assuming Database Integration:** Developers might update `BlockData.ExtraInfo.CoinAmounts` expecting the PostgreSQL records to inherit the change, unaware that `pgblockchain.go` completely ignores it and runs its own `msgBlock` parsing.
- **Formatting Backend Side:** Developers might add formatting behavior to the strings in `explorer.go` to "help" the templates, fundamentally breaking the WebSocket array parsing logic which requires unformatted, raw integer strings.
- **Updating the WebSocket Only:** Developers might modify `PubSubHub.Store()` array extraction to fix a UI bug, forgetting to update `explorerUI.Store()` — resulting in page loads flashing incorrect data before WebSockets overwrite them (C3 violation).
- **Forgetting the chart tip push:** Developers modifying how the home page computes `TicketPrice`, `Difficulty`, `PoolValue`, or `CoinSupply` fields may update `HomeInfo` but forget to update the `SetTip` call at `explorer.go:652-665`. The chart's last data point would then silently show a stale value instead of the current RPC value.
- **Treating `RemainingWindowText` as template-only:** It was originally a template helper. It now also populates live WS fields (`WindowRemaining`, `RewardRemaining`). Changes to formatting, precision, or edge cases affect both the server-rendered page and live countdown updates.
- **Confusing CBlockSubsidy with NBlockSubsidy:** `CBlockSubsidy` is the actual vote-scaled subsidy for the block just stored (used for `LBlockTotal` display). `NBlockSubsidy` is the estimate for the next block. Using the wrong one silently wrong-values blocks with fewer than 5 votes.
- **Breaking latestBlocksEnd parity:** `Home()` uses `latestBlocksEnd(height, homeBlocksSpan)` and the WS handler uses the same. If these diverge (e.g., someone adds a different clamp to `Home()`), the home table and reconnect-rebuild show different rows — a hard-to-notice split screen bug.

### 8. Evidence

- **RPC Ingestion:** `cmd/dcrdata/internal/notification/notifier.go` lines 200+
- **Hydration / Maps via `big.Int`:** `blockdata/blockdata.go` lines 400-692 (`CollectBlockInfo`, `blockCoinAmounts`, `computeMinerVARFeeAtoms`)
- **Conservation MiningFee:** `blockdata/blockdata.go:668-691` (`computeMinerVARFeeAtoms` — Σ(VAR outputs) − Σ(inputs), zero-clamped)
- **CBlockSubsidy fetch (actual Voters):** `blockdata/blockdata.go:201-203` (`GetBlockSubsidy(ctx, height, header.Voters)`)
- **BlockDataSaver Fan-Out:** `cmd/dcrdata/main.go` registers `pgb`, `explore`, and `psHub` as savers
- **Database Divergence:** `db/dbtypes/conversion.go` line 18 (`blockCoinAmounts` manually parses `msgBlock`)
- **Postgres JSONB Integration:** `db/dcrpg/pgblockchain.go` `StoreBlock` calls `MsgBlockToDBBlock` and ignores `BlockData`
- **CBlockSubsidy in explorerUI:** `cmd/dcrdata/internal/explorer/explorer.go:577-586`
- **CBlockSubsidy in PubSubHub:** `pubsub/pubsubhub.go:743-751`
- **ActiveMiners hoisted above lock:** `pubsub/pubsubhub.go:703` (queries before `p.mtx.Lock()` at line 718)
- **WindowRemaining + RewardRemaining in explorerUI:** `cmd/dcrdata/internal/explorer/explorer.go:568,570`
- **WindowRemaining + RewardRemaining in PubSubHub:** `pubsub/pubsubhub.go:734,736`
- **RemainingWindowText (single source of truth):** `explorer/types/remaining.go:17`
- **Chart tip push from explorerUI:** `cmd/dcrdata/internal/explorer/explorer.go:652-665` (`cd.SetTip(cache.ChartTip{...})`)
- **ChartTip struct:** `db/cache/charts.go:487-497`
- **SetTip + cache invalidation:** `db/cache/charts.go:905-921`
- **mining_controller.js reward_remaining read:** `cmd/dcrdata/public/js/controllers/mining_controller.js:48`
- **voting_controller.js window_remaining read:** `cmd/dcrdata/public/js/controllers/voting_controller.js:35`
- **Presentation State Duplication:** `cmd/dcrdata/internal/explorer/explorer.go:~592` and `pubsub/pubsubhub.go:~757` both run identical loops transforming `map[uint8]string` → sorted `[]PoWSKAReward`
- **getlatestblocks WS handler:** `cmd/dcrdata/internal/explorer/websockethandlers.go:233-255`
- **latestBlocksEnd / homeBlocksSpan single source:** `cmd/dcrdata/internal/explorer/explorerroutes.go:155-186`
- **mining_controller.js CBlockSubsidy read:** `cmd/dcrdata/public/js/controllers/mining_controller.js:34` (`(ex.cblock_subsidy || ex.subsidy).pow / 1e8`)
- **blocks_controller.js reconnect+gap refresh:** `cmd/dcrdata/public/js/controllers/blocks_controller.js:28-51`

See also:
- /wiki/code-analysis/page-rendering/patterns.md (shares-pattern-with: out-of-band shared page state via `BlockDataSaver` fan-out; shared-state lock discipline)
- /wiki/code-analysis/page-rendering/impact.md (depends-on: saver writer/reader drift — HTML flashes stale data before WS overwrite)
- /wiki/core/constraints.md (depends-on: C1 numeric precision & bifurcation; C2 dual pipeline mutation; C3 template + WebSocket parity; C4 perimeter flattening & array stability; shares-pattern-with: C8 dual-transport shape asymmetry — REST `map[uint8]string` vs WebSocket sorted-array form for multi-coin amounts)
