HTTP: `RPC → ChainDB.GetExplorerFullBlocks(30) → GetExplorerBlock (memo) → handler trims to TrimmedBlockInfo → visualblocks.tmpl`
WS new-block: `Store → wsHub ← sigNewBlock → WebsocketBlock{BlockInfo,HomeInfo} → index.js → BLOCK_RECEIVED → controller._handleVisualBlocksUpdate (filters Coinbase JS-side)`
WS mempool: `StoreMPData → exp.invs ; client "getmempooltrimmed" → MempoolInfo.Trim() + Subsidy=HomeInfo.NBlockSubsidy → controller.handleMempoolUpdate`

Key Patterns:

- **Dual transport, two shapes** — HTTP sends `TrimmedBlockInfo` (server-filtered); WS sends full `BlockInfo` (`Tx` not `Transactions`, includes coinbase). JS re-implements `FilterRegularTx`.
- **Subsidy struct asymmetry** — `BlockSubsidy.Dev` (JSON `dev`, mempool tile) vs `chainjson.GetBlockSubsidyResult.Developer` (block tile). Template uses both names; JS uses `developer || dev`.
- **Memoized DB block pointer** — `pgb.lastExplorerBlock` shared by all consumers; never mutate.
- **Outer 30-tile cap** — `homePageBlocksMaxCount = 30` (Go const) + JS `box.removeChild(box.lastChild)`. Template does *not* enforce the outer cap; the handler already passes only 30 blocks.
- **Per-tile internals cap** — template `clipSlice 30` when `> 50` (tickets, txs) + JS `splice(30)` mirrors it. Distinct from the outer cap.
- **Lock map** — three locks (`pageData`, `invsMtx`, `MempoolInfo.RWMutex`); only `Store` nests two of them (`pageData.Lock` then `invsMtx.Lock`). `StoreMPData` and readers acquire sequentially without nesting. New code must not hold `invsMtx` while waiting on `pageData.Lock`.

Critical Constraints:

- All amount bars are **float64 VAR** (`flex-grow: {{.Total}}`); SKA atoms lossy through `dcrutil.Amount.ToCoin()`.
- `MiningFee`/`TotalSent` sum across all coins via `ToCoin()` — VAR-precision only.
- SKA SSFee distribution lives in `FeesByCoin`/`SSFeeTotalsByCoin` on `BlockInfo` — not surfaced on this page.
- Treasury and StakeFees slices are dropped by the handler.
- Empty-slot counts (5 votes, 20 tickets+revs) and `DCR` label are hardcoded.

Mutation Checklist:

- update `explorerroutes.go:VisualBlocks` AND `views/visualblocks.tmpl` AND `visualBlocks_controller.js` together
- if changing `BlockInfo` JSON: also touch `home_latest_blocks_controller.js`, `status_controller.js`, `blocks_controller.js`, `time_controller.js`, `address_controller.js`
- if changing `HomeInfo.NBlockSubsidy`: mirror in `pubsub/pubsubhub.go`
- if changing the outer 30-tile cap: update Go const (`homePageBlocksMaxCount`) AND JS `removeChild` trim (template doesn't enforce the outer cap)
- if changing the per-tile `> 50` truncation threshold: update template `clipSlice 30` AND JS `splice(30)` together
- never mutate the pointer returned by `GetExplorerBlock`

Silent Risks:

- SKA tx amount through float64 → wrong `flex-grow`, dominant tile
- Subsidy field rename one-sided → "fund" bar collapses to 0
- New trimmed field added to template only → newer WS-pushed tiles miss it
- Non-JSON `title` attribute → tooltip silently disabled

Loud Failures:

- Remove `block.Tx` from `BlockInfo` → Go nil deref + JS runtime error
- Remove `HomeInfo.NBlockSubsidy` or `MempoolInfo.Trim()` → compile failure
