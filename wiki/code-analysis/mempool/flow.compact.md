### One-line Flow

`node RPC / OnTxAccepted → mempool/collector.ParseTxns (batch) | mempool/monitor.TxHandler.addTxToCoinStats (incremental) → []MempoolDataSaver fan-out → explorerUI computeCoinFills → exp.invs / psh.invs → WS (root + pubsub) + HTTP (home_mempool.tmpl / mempool.tmpl) → homepage_controller.js rAF indicator flush`.

### Key Architectural Patterns

- **Dual collection paths (batch vs. incremental).** `ParseTxns` at block boundaries fully rebuilds `MempoolInfo.CoinStats`; `addTxToCoinStats` updates it incrementally per new tx. Both must stay equivalent. Tests: [mempool/monitor_test.go](../../../mempool/monitor_test.go).
- **Multi-saver fan-out.** `MempoolMonitor` dispatches to `[]MempoolDataSaver`: `explorerUI` (computes `CoinFills`), `PubSubHub` (pointer-assign), `DataCache` (early-returns on incremental path via `stakeData==nil` guard).
- **Dual-transport WS.** Root explorer WS ([websockethandlers.go](../../../cmd/dcrdata/internal/explorer/websockethandlers.go)) and `PubSubHub` ([pubsubhub.go](../../../pubsub/pubsubhub.go)) both emit identical `sigMempoolUpdate(MempoolShort)` and `sigNewTxs(Txs+CoinFills+TotalFillRatio+ActiveSKACount)` payloads. See [/wiki/code-analysis/visualblocks/patterns.md](../visualblocks/patterns.md).
- **`CoinFills` derived in two sites.** Computed via `computeCoinFills(CoinStats, maxBlockSize, issuedSKA)` inside both `(*explorerUI).StoreMPData` (mempool change) and `(*explorerUI).Store` (new block, after `SKACoinSupply` refresh).
- **`issuedSKA` seeding.** Drawn from `HomeInfo.SKACoinSupply` so ever-issued coin types render zero-fill bars even with no current mempool activity.
- **rAF-batched indicator updates.** Frontend collapses overlapping `coin_fills` payloads into a single animation frame; bars are zeroed, never removed (`homepage_controller.js:216-269`).

### Critical Constraints

- **SKA precision:** SKA `Amount`/`*Amount` fields are 18-decimal `big.Int` strings; **never** `float64`. VAR uses `int64` decimal strings. `addAtomStrings(..., isBig)` enforces the split.
- **Single-coin tx invariant:** One mempool tx ⇒ one coin type. `primaryCoinType` ([explorertypes.go:1056-1065](../../../explorer/types/explorertypes.go)) encodes this.
- **SKA → Regular only:** SKA `TicketAmount/VoteAmount/RevokeAmount` are always `"0"` (not `""`); `normalizeCoinStatsAmounts` + `skaPerTypeStr` enforce.
- **`PctOfTC` is unclamped** — overflow must surface as text; SCSS clips visually.
- **Inventory locking order:** `MempoolMonitor.mtx` (pointer) outermost, `MempoolInfo.RWMutex` (contents) inner. Reverse = deadlock risk against `Refresh`.

### Mutation Checklist

- New `MempoolCoinStats` field → update `ParseTxns` (batch) **AND** `addTxToCoinStats` (incremental) **AND** `normalizeCoinStatsAmounts` (if string) **AND** `MempoolShort.DeepCopy` **AND** monitor_test.go.
- New `MempoolShort` field → `DeepCopy` + `Trim` + both WS encoders (root + pubsub).
- New `CoinFillData` field or status → Go `computeCoinFills` **AND** JS `indicator_fill.js` mirror **AND** `home_mempool.tmpl` + `<template id="fill-bar-template">` **AND** `dev_indicators.go` fixtures.
- New saver → must handle `stakeData == nil` (cf. `DataCache.StoreMPData`).
- Change `CoinFills` inputs → update both call sites (`StoreMPData` AND new-block `Store`).

See also:
- [/wiki/code-analysis/mempool/flow.full.md](flow.full.md) — full trace.
- [/wiki/code-analysis/mempool/patterns.md](patterns.md) — reusable patterns from this flow.
- [/wiki/code-analysis/mempool/impact.md](impact.md) — mutation-impact entries.
- [/wiki/code-analysis/address/flow.compact.md](../address/flow.compact.md) (shares-pattern-with: mempool overlay into `NumUnconfirmed`).
- [/wiki/core/constraints.md](../../core/constraints.md) (depends-on: C1 numeric precision; C2 dual pipeline mempool aggregation vs. persisted recalc).
