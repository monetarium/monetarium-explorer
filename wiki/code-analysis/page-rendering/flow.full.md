# Page-Rendering — End-to-End Flow

> Code-grounded trace of how a server-rendered HTML page is produced in
> `cmd/dcrdata/internal/explorer`. Covers shared infrastructure (savers, locks,
> middleware, `commonData`) and the concrete page handlers added or enabled
> since the domain was first documented.

---

## Section 1 — Overview

The `explorerUI` struct is the central HTTP server object. It owns:

- **`pageData`** (`*pageData`, protected by `pageData.RWMutex`) — block/chain/home
  state written by background savers, read by page handlers.
- **`invs`** (`*types.MempoolInfo`, guarded by `invsMtx sync.RWMutex`) — mempool
  snapshot.
- **`wsHub`** — WebSocket hub for push updates.
- **`templates`** — parsed Go HTML template set, optionally reloaded per-request
  (`--reload-html`).

Every page handler follows the same shape: read from `pageData`/`invs` + query
`dataSource` for per-request data → assemble anonymous struct embedding
`*CommonPageData` → call `templates.exec(name, struct)` → write `text/html`.

---

## Section 2 — End-to-End Data Flow

```
monetarium-node (JSON-RPC)
  │ new-block notification
  ▼
blockdata.Collector.Collect()
  │ produces *BlockData, *wire.MsgBlock
  ▼
blockdata fan-out (main.go:570,1092)
  ├─► (*explorerUI).Store(blockData, msgBlock)      ← HTTP path
  │     writes pageData.{BlockInfo,BlockchainInfo,HomeInfo}
  │     resets ETag/Last-Modified
  │     signals wsHub (sigNewBlock, sigMempoolUpdate)
  │     ─► chartSource.(*cache.ChartData).SetTip()  ← side effect (type assertion)
  │           stores ChartTip{Height,Time,TicketPrice,Difficulty,PoolValue,CoinSupply}
  │           invalidates cached charts: TicketPrice, POWDifficulty (WindowBin),
  │           PercentStaked (BlockBin, DayBin)
  ├─► pgb.Store(…)
  └─► psHub.Store(…)                                ← WebSocket path
        writes identical HomeInfo fields (parallel, no shared layer)
        calls types.RemainingWindowText for WindowRemaining/RewardRemaining

mempool.MempoolMonitor
  │ sends *types.MempoolInfo
  ▼
(*explorerUI).StoreMPData(_, _, inv)
  reads pageData.RLock → computes CoinFills → writes exp.invs
  resets ETag/Last-Modified

HTTP request → chi router (main.go:659–793)
  │
  ├─ SyncStatusPageIntercept (blocks all pages during DB sync)
  │
  ├─ ETagAndLastModifiedIntercept (withCache group)
  │     reads eTag/lastModified from pageData (under RLock)
  │     serves 304 Not Modified on hit
  │
  └─ page handler (e.g. Home, HashrateShares, AgendasPage…)
        reads pageData.RLock / invsMtx.RLock
        queries dataSource for per-request data
        calls exp.commonData(r) → GetTip (Postgres) → *CommonPageData
        builds anonymous struct{*CommonPageData, …page fields…}
        templates.exec("name", payload) → HTML string
        w.WriteHeader(200) + io.WriteString(w, str)
```

---

## Section 3 — Per-Layer Breakdown

### 3.1 Background Saver — `(*explorerUI).Store`

**Location:** `cmd/dcrdata/internal/explorer/explorer.go:508`

**Data Structures written to `pageData`:**

| Field | Source | Type |
|---|---|---|
| `BlockInfo` | `GetExplorerBlock(ctx, hash)` | `*types.BlockInfo` |
| `BlockchainInfo` | `blockData.BlockchainInfo` | `*chainjson.GetBlockchainInfoResult` |
| `HomeInfo.HashRate` | `dbtypes.CalculateHashRate(difficulty, targetTime)` | `float64` |
| `HomeInfo.CoinSupply` | `blockData.ExtraInfo.CoinSupply` | `int64` |
| `HomeInfo.NBlockSubsidy` | `blockData.ExtraInfo.NextBlockSubsidy.*` | `types.BlockSubsidy` |
| `HomeInfo.CBlockSubsidy` | `blockData.ExtraInfo.CurrentBlockSubsidy.*` (fallback: NBlockSubsidy) | `types.BlockSubsidy` |
| `HomeInfo.LBlockTotal` | `dcrutil.Amount(CBlockSubsidy.PoW).ToCoin() + MiningFeeAtoms.ToCoin()` | `float64` |
| `HomeInfo.LBlockTotalAtoms` | `CBlockSubsidy.PoW + MiningFeeAtoms` | `int64` |
| `HomeInfo.ActiveMiners` | `ActiveMiners(ctx, minHeight)` where minHeight from `GetHeightByTimestamp(now-7d)` | `int64` |
| `HomeInfo.VARCoinSupply` | `VARCoinSupply(ctx)` | `*types.VARCoinSupply` |
| `HomeInfo.SKACoinSupply` | `SKACoinSupply(ctx)` (pointer slice → value slice) | `[]types.SKACoinSupplyEntry` |
| `HomeInfo.VoteVARReward` | `txhelpers.ComputeVoteVARReward(…)` | `types.VoteVARReward` |
| `HomeInfo.SKAVoteRewards` | per-coin PoS split from `SSFeeTotalsByCoin` + 30d history fallback | `[]types.SKAVoteReward` |
| `HomeInfo.PoWSKARewards` | per-coin PoW split from `SSFeeTotalsByCoin` + 30d fallback | `[]types.PoWSKAReward` |
| `HomeInfo.WindowRemaining` | `types.RemainingWindowText(IdxBlockInWindow, Params.WindowSize, Params.BlockTime)` | `string` |
| `HomeInfo.RewardRemaining` | `types.RemainingWindowText(IdxInRewardWindow, Params.RewardWindowSize, Params.BlockTime)` | `string` |

After `p.Unlock()`, `Store` also recomputes `invs.CoinFills` under `invsMtx.Lock`
(while holding `pageData.Lock`) so newly-issued SKA coins appear in fill bars
before any mempool tx arrives (`explorer.go:614–631`).

**Async side effects (goroutines):**
- Sends `sigNewBlock` and `sigMempoolUpdate` to `wsHub.HubRelay`.
- Every 5 blocks: triggers `voteTracker.Refresh()`, `proposals.ProposalsSync()`,
  `agendasSource.UpdateAgendas()`.

**Chart cache side effect (synchronous, inline):**
After computing HomeInfo, `Store` type-asserts `exp.chartSource` to
`*cache.ChartData`. If the assertion succeeds (i.e., the real chart cache is
wired — not a mock or simnet stub), it calls `cd.SetTip(cache.ChartTip{…})` with
`Height`, `Time`, `TicketPrice`, `Difficulty`, `PoolValue` (atoms, converted from
`PoolInfo.Value * 1e8`), and `CoinSupply`. `SetTip` stores the tip under
`tipMtx.Lock` and calls `invalidateTipCharts()`, which deletes cached chart bytes
for `TicketPrice` and `POWDifficulty` (WindowBin) and `PercentStaked`
(BlockBin + DayBin) — forcing those charts to re-run their maker functions on the
next `/api/chart/...` request rather than serving bytes whose cacheID hasn't yet
rolled to a new window boundary. If the assertion fails, the tip push is silently
skipped (no error, no log). (`explorer.go:652–668`, `db/cache/charts.go:908–933`)

### 3.2 Background Saver — `(*explorerUI).StoreMPData`

**Location:** `cmd/dcrdata/internal/explorer/explorer.go:476`

Reads `pageData.RLock` for `blockchainInfo.MaxBlockSize` and `HomeInfo.SKACoinSupply`
(to get `issuedSKA`). Releases lock. Calls `types.ComputeCoinFills(inv.CoinStats,
maxBlockSize, issuedSKA)`. Writes `fills` into both `inv.CoinFills` and
`inv.MempoolShort.CoinFills`. Takes `invsMtx.Lock` → swaps `exp.invs`. Calls
`resetETagAndLastModified()`.

### 3.3 Middleware Layer

**Location:** `cmd/dcrdata/internal/explorer/explorermiddleware.go`

- `SyncStatusPageIntercept` (line 154) — short-circuits all page requests with a
  sync-in-progress page while `exp.ShowingSyncStatusPage()` is true.
- `ETagAndLastModifiedIntercept` (line 193) — reads `eTag`/`lastModified` via
  `exp.eTagAndLastModified()` (under `pageData.RLock`). Checks `If-None-Match` /
  `If-Modified-Since` headers. On hit → 304. On miss → sets `ETag`, `Last-Modified`,
  `Cache-Control: private` headers, passes to handler.
- `BlockHashPathOrIndexCtx` (line 101) — resolves URL param `{blockhash}` to
  `(hash, height)` and injects both into request context.
- `MenuFormParser` (line 294) — handles dark-mode cookie toggle POST at `/set`.

### 3.4 Route Registration

**Location:** `cmd/dcrdata/main.go:659–793`

Key groupings:

| Group | Middleware applied | Routes |
|---|---|---|
| Group A (line 659) | `SyncStatusPageIntercept` | `/` (redirect), `/visualblocks`, `/ws` |
| Group B (line 725) | `SyncStatusPageIntercept` | All explorer pages including `/blocks`, `/tx/{txid}`, etc. |
| `withCache` subgroup (line 768) | `ETagAndLastModifiedIntercept` on top of B | `/`, `/disapproved`, `/mempool`, `/charts`, `/hashrate-shares`, `/parameters`, `/agendas`, `/agenda/{agendaid}`, `/attack-cost` |

Note: `/hashrate-shares/data` is **NOT** under `withCache` (line 777) — the data
endpoint varies by `?interval=` query param; caching it per-block would serve stale
interval results. Explicit comment in `main.go:774`.

### 3.5 `commonData` — Shared Template Foundation

**Location:** `cmd/dcrdata/internal/explorer/explorerroutes.go:2414`

Called by every page handler. Queries `GetTip(ctx)` (Postgres). On failure returns
`nil` — callers embed the nil pointer without checking, so any page with a nil
`.ChainParams` deref fails template execution and falls to `StatusPage`.

Fields injected: `Tip` (from DB), `Version`, `ChainParams` (startup capture),
`BlockTimeUnix`, `NetName`, `Links`, `Cookies.DarkMode` (cookie), `Host`, `BaseURL`,
`Path`, `RequestURI`.

### 3.6 Page Handlers (selected)

**`Home`** (`explorerroutes.go:216`): Reads `pageData.RLock` + `invsMtx.RLock` for
`HomeInfo` and mempool snapshot. Falls back to `CBlockSubsidy.PoW` for
`LBlockTotalAtoms` when not yet set (early-startup guard, line 240–243).

**`Blocks`** (`explorerroutes.go:656`): Parses `?height=` + `?rows=`. Applies
`normalizeExplorerRows(rows)` (default 100, cap 400). Queries `GetExplorerBlocks`.

**`StakeDiffWindows`** (`explorerroutes.go:424`): Parses `?rows=` + `?offset=`.
Applies `normalizeExplorerRows(rows)`. Queries `PosIntervals`.

**`timeBasedBlocksListing`** (`explorerroutes.go:520`): Used by
`DayBlocksListing`/`WeekBlocksListing`/`MonthBlocksListing`/`YearBlocksListing`.
Applies `normalizeExplorerRows(rows)`. Queries `TimeBasedIntervals`.

**`HashrateShares`** (`hashrate_shares.go:142`): Shell page handler, under
`withCache`. Reads `pageData.RLock` for `HomeInfo.SKACoinSupply` to extract
`activeSKATypes`. Passes them to template for JS controller bootstrap.

**`HashrateSharesData`** (`hashrate_shares.go:95`): JSON data endpoint, **not**
under `withCache`. Validates `?interval=` (default `week`). Calls
`intervalMinHeight(ctx, interval)` (reads `pageData.BlockInfo.BlockTime` under
`pageData.RLock`; calls `GetHeightByTimestamp` on DB). Calls
`MinerHashrateShares(ctx, minHeight)`. Applies `minerShares()` → JSON response
`{interval, total, miners:[{rank,address,count,percent}]}`.

**`AgendasPage`** (`explorerroutes.go:2142`): Under `withCache`. Guards on
`exp.voteTracker != nil` (nil → `ExpStatusPageDisabled`, i.e. simnet). Calls
`AllAgendas()` (agenda DB) + `voteTracker.Summary()` (in-memory VoteTracker).
Cross-filters VoteTracker summaries to only Monetarium-era agendas
(`filterAgendaSummaries`, line 2196).

**`AgendaPage`** (`explorerroutes.go:2047`): Under `withCache`. Reads `agendaId`
from request context (set by `AgendaPathCtx` middleware). Queries
`agendasSource.AgendaInfo(agendaId)` + `dataSource.AgendasVotesSummary(ctx, agendaId)`.
Handles `nil` summary (pre-voting agenda) by substituting zero-value
`*dbtypes.AgendaSummary` (line 2069).

### 3.7 `normalizeExplorerRows[T]`

**Location:** `cmd/dcrdata/internal/explorer/explorerroutes.go:645`

Generic over `int64 | uint64`. Logic:
- `rows == 0` → `defaultExplorerRows` (100)
- `rows > maxExplorerRows` → `maxExplorerRows` (400)
- otherwise pass-through

Callers: `Blocks` (int64), `StakeDiffWindows` (uint64), `timeBasedBlocksListing`
(uint64). The generic type avoids silent overflow when a huge `uint64` value was
previously converted to `int64` before the cap check.

---

## Section 4 — Cross-Layer Dependencies

| Coupling | Nature | Risk |
|---|---|---|
| `Store` writes `pageData`, `Home` reads it | Background writer / HTTP reader | `pageData.RWMutex` prevents race; snapshot may be 1 block stale |
| `Store` (HTTP) vs `psHub.Store` (WS) | Parallel savers, no shared transform layer | Must duplicate every `HomeInfo` field change in both; drift is silent |
| `Store` → `chartSource.(*cache.ChartData).SetTip` | Cross-module type assertion into `db/cache` | Silently skipped if `chartSource` is a mock/stub (no error); chart cache stale until next block if wiring is broken |
| `commonData` → `GetTip` (Postgres) | Synchronous DB call on every page render | DB down → `nil` return → every page fails simultaneously |
| `withCache` ETag key | Shared across all `withCache` routes | Reset by `Store`/`StoreMPData` on any new block/mempool event |
| `HashrateSharesData` → `pageData.BlockInfo.BlockTime` | `intervalMinHeight` reads `pageData.RLock` | Must hold `pageData` lock; not under `withCache` — per-request |
| `HashrateShares` shell → `pageData.HomeInfo.SKACoinSupply` | Under `withCache` | Stale between blocks (intentional); only re-renders on new block |
| `AgendasPage` → `voteTracker.Summary()` | In-memory VoteTracker | nil tracker (simnet) → `ExpStatusPageDisabled`, not a crash |
| `AgendaPage` nil summary guard | `AgendasVotesSummary` returns `(nil,nil)` pre-voting | Guarded at line 2069; missing guard → nil deref in template |

---

## Section 5 — Critical Constraints

**C1 (Precision):** SKA amounts stay `*big.Int`-derived strings end-to-end. In
`Store`, SKA vote rewards (`SKAVoteRewards`, `PoWSKARewards`) and supply
(`SKACoinSupply`) all use `txhelpers.FormatSKAAtoms` / big.Float math before
writing string fields to `HomeInfo`. No float64 is used for SKA atom counts.

**C2 (Single-coin tx):** The `SSFeeTotalsByCoin` map is keyed by `uint8` coin type;
`ct==0` means VAR. The Store loop explicitly skips VAR (`ct == 0; continue`) when
computing SKA vote rewards (line 735). Mixing is impossible — each tx is one coin.

**C3 (Fee-coin):** `MiningFeeAtoms` in `Store` is VAR (all PoW reward/fee is VAR).
`LBlockTotal = CBlockSubsidy.PoW (VAR) + MiningFeeAtoms (VAR)`. SKA PoW rewards
(`PoWSKARewards`) are separate fields, not added to `LBlockTotal`.

**C4 (CBlockSubsidy fallback):** `blockData.ExtraInfo.CurrentBlockSubsidy` may be
nil (e.g. pre-DCP0012). The fallback at `explorer.go:578–581` copies `NBlockSubsidy`
into `CBlockSubsidy`. Any consumer of `CBlockSubsidy` must expect it equals
`NBlockSubsidy` when the node does not return current subsidy.

**C5 (normalizeExplorerRows default):** Default page size is 100
(`defaultExplorerRows`), cap is 400 (`maxExplorerRows`). Callers rely on
`rows==0` meaning "no explicit request" — do not add validation that rejects 0
before calling `normalizeExplorerRows`.

**C6 (withCache vs varying params):** A handler under `withCache` must be a pure
function of `pageData`/`invs` at the last tick. `HashrateSharesData` is NOT under
`withCache` because its output varies by `?interval=`. The comment at
`main.go:774` makes this explicit.

**C7 (ActiveMiners timestamp-based):** `Store` calls `GetHeightByTimestamp(ctx, now-7d)`.
On error it warns and falls back to `minHeight=0` (whole-chain scan). This fallback
is safe but may produce a larger active-miner count than intended.

**C8 (agendas VoteVersion filter):** `AgendasPage` cross-filters VoteTracker
summaries via `filterAgendaSummaries` to exclude pre-Monetarium (VoteVersion < 11)
agendas. Adding a new agenda type requires ensuring `AllAgendas()` returns it with
the correct VoteVersion, otherwise it will be hidden from status cards.

**C9 (RemainingWindowText single source of truth):** `WindowRemaining` and
`RewardRemaining` in `HomeInfo` are computed by `types.RemainingWindowText`
(`explorer/types/remaining.go:17`). Both `(*explorerUI).Store` and
`psHub.Store` (`pubsub/pubsubhub.go:734,736`) call the same function, ensuring the
server-rendered HTML and the live WS payload always produce identical countdown
strings. Do not inline this calculation in either saver or in a template — the
function is the single authority (comment references issue #502).

**C10 (ChartTip PoolValue VAR-only float conversion):** `SetTip` converts
`blockData.PoolInfo.Value` (a `float64` in VAR coins) to atoms via `* 1e8` before
casting to `uint64`. This is safe because `PoolInfo.Value` is VAR (see C3 — all
PoW pool value is VAR); the 8-decimal precision fits float64 without loss. Do not
apply the same pattern to SKA amounts — SKA values must stay `big.Int`-derived
strings (see C1).

---

## Section 6 — Mutation Impact

### Changing `HomeInfo` fields in `Store`

**Direct deps:** `exp.pageData.HomeInfo` (shared struct). **Indirect deps:**
`pubsub/pubsubhub.go`'s `Store` (parallel saver). `Home` template
(`views/home*.tmpl`). Home page JS (`mining_controller.js`, `supply_controller.js`).

**Must also change:** `psHub.Store` in `pubsubhub.go` and any WS JSON encoder that
serializes the same field. Failure mode: **silent** (HTML shows one value, WS push
shows another).

### Adding a new page under `withCache`

The new page receives the ETag that was reset by the *last block or mempool tick*.
If the handler's output varies by anything other than block/mempool state (query
params, session data, per-user state), caching will serve wrong responses. See
`HashrateSharesData` as the canonical counter-example.

### Moving `normalizeExplorerRows` callers to a different default

`defaultExplorerRows = 100` is a constant. Changing it affects `Blocks`,
`StakeDiffWindows`, and `timeBasedBlocksListing` simultaneously. The `?rows=`
dropdown in templates still offers the same options — confirm template options
include the new default before changing the constant.

### Modifying `commonData`

Touches every page simultaneously. Adding a DB query (like `GetTip` already does)
adds latency to every page render. The nil-return failure path covers all pages — no
per-page isolation. See `impact.md` → *commonData Nil Render Crash*.

### Adding a new `explorerDataSource` interface method

Interface changes must be reflected in the mock at
`cmd/dcrdata/internal/explorer/explorer_test.go` (line 207 has `MinerHashrateShares`
as a recent example). Missing mock update causes test compilation failure.

### Changing `intervalMinHeight` / `HashrateSharesData`

`intervalMinHeight` reads `pageData.BlockInfo.BlockTime` under `pageData.RLock`. If
called from a goroutine that also holds `invsMtx`, check for lock-order inversion
against `Store` (see `impact.md` → *Lock-Order Inversion*).

### Modifying `HomeInfo.WindowRemaining` / `HomeInfo.RewardRemaining`

Both fields are computed by `types.RemainingWindowText` from `explorer/types/remaining.go`.
The call sites are `explorer.go:568,570` and `pubsub/pubsubhub.go:734,736`. Changing
the signature or semantics of `RemainingWindowText` affects both the HTTP render and
the WS push simultaneously. If either call site is removed or changed independently,
the HTML countdown and the WS live-update diverge (see `impact.md` →
*Saver Writer/Reader Drift*). Both fields carry `json:` tags and are transmitted
over WS even if no template currently renders them directly.

### Modifying `Store`'s `chartSource.SetTip` call

If `chartSource` is replaced with a different implementation that does not satisfy
`*cache.ChartData`, the type assertion silently fails and charts for `TicketPrice`,
`POWDifficulty`, and `PercentStaked` will lag by one window/day bin boundary after a
block (they will only refresh when their `cacheID` rolls over naturally). The failure
is silent — no error, no log. To verify `SetTip` is firing in production, check that
`invalidateTipCharts` deletes the appropriate keys on block arrival.

---

## Section 7 — Common Pitfalls

1. **Adding a per-request data endpoint under `withCache`:** The canonical mistake.
   The ETag does not encode the query params, so all intervals would share one cached
   response. Always check whether the handler varies by request params before placing
   it in the `withCache` group.

2. **Updating `Store` without updating `psHub.Store`:** The two savers transform the
   fan-out independently. Every new `HomeInfo` field, or change to an existing one,
   must be mirrored in `pubsub/pubsubhub.go`. No compile-time check catches the
   drift.

3. **Using `NBlockSubsidy` where `CBlockSubsidy` is correct:** `NBlockSubsidy` is
   the next-block projected maximum; `CBlockSubsidy` is the actual vote-scaled
   current-block subsidy. For displaying what a miner earned in the latest block
   (e.g. `LBlockTotal`), use `CBlockSubsidy.PoW`.

4. **Hardcoding `rows==10` defaults instead of calling `normalizeExplorerRows`:**
   Pre-refactor each list page had an identical `if rows < minExplorerRows { rows = minExplorerRows }`
   block. The generic helper consolidates this — don't re-introduce per-handler
   defaults.

5. **Reading `pageData` fields without the lock:** `pageData.RWMutex` is embedded in
   the struct. Page handlers must hold `exp.pageData.RLock()` for any read; `Store`
   holds `exp.pageData.Lock()` for all writes. Unlocked reads race.

6. **SKA atoms through float64:** Any field that carries SKA atom counts must arrive
   at the template boundary as a pre-formatted string (from `FormatSKAAtoms` or
   equivalent). Do not convert to `float64` at any intermediate step.

7. **`ChartDataSource` interface type assertion in `Store`:** The `chartSource` field
   is typed as the `ChartDataSource` interface, not `*cache.ChartData`. The type
   assertion in `Store` silently no-ops when a mock or non-concrete type is assigned
   (simnet, tests). This is intentional, but it means chart staleness bugs caused by
   a broken `SetTip` call will not surface in unit tests — only in a live explorer run
   where `*cache.ChartData` is the actual implementation.

8. **Inlining `RemainingWindowText` logic in one saver only:** The two-saver symmetry
   requires both `explorer.go` and `pubsub/pubsubhub.go` to call the shared function.
   If the countdown formatting is ever "temporarily" inlined in one saver (e.g. a
   quick fix), the HTML and WS payloads will diverge and the bug manifests as the
   live countdown ticking differently than the initial page render.

---

## Section 8 — Evidence

| Claim | Location |
|---|---|
| `defaultExplorerRows = 100` | `explorer.go:51` |
| `normalizeExplorerRows[T]` implementation | `explorerroutes.go:645–652` |
| `Store` writes `CBlockSubsidy` with nil-check + fallback | `explorer.go:573–581` |
| `Store` computes `LBlockTotal` from `CBlockSubsidy.PoW` | `explorer.go:589–590` |
| `Store` queries `GetHeightByTimestamp` then `ActiveMiners` | `explorer.go:539–583` |
| `Store` recomputes `CoinFills` under `invsMtx.Lock` (nested inside `pageData.Lock`) | `explorer.go:614–631` |
| `StoreMPData` takes `pageData.RLock`, releases, then `invsMtx.Lock` | `explorer.go:477–501` |
| `ETagAndLastModifiedIntercept` reads `eTag` under `pageData.RLock` | `explorerroutes.go:2414–2452` (via `eTagAndLastModified` at `explorer.go:949`) |
| `withCache` group registration; `/hashrate-shares/data` excluded with comment | `main.go:768–777` |
| `/agendas` + `/agenda/{agendaid}` under `withCache` | `main.go:785–786` |
| `HashrateShares` reads `SKACoinSupply` under `pageData.RLock` | `hashrate_shares.go:143–145` |
| `HashrateSharesData` calls `intervalMinHeight` → `pageData.RLock` + `GetHeightByTimestamp` | `hashrate_shares.go:62–91, 95–136` |
| `AgendasPage` nil voteTracker guard | `explorerroutes.go:2143–2146` |
| `AgendaPage` nil summary guard (zero-value substitution) | `explorerroutes.go:2068–2072` |
| `filterAgendaSummaries` VoteVersion cross-filter | `explorerroutes.go:2196–2208` |
| `mockDataSource.MinerHashrateShares` added to test mock | `explorer_test.go:207` |
| `commonData` nil return on `GetTip` failure | `explorerroutes.go:2417–2421` |
| `HomeInfo.WindowRemaining` populated via `types.RemainingWindowText` | `explorer.go:568` |
| `HomeInfo.RewardRemaining` populated via `types.RemainingWindowText` | `explorer.go:570` |
| `RemainingWindowText` single-source-of-truth with issue #502 comment | `explorer/types/remaining.go:8–17` |
| `WindowRemaining`/`RewardRemaining` json tags on `HomeInfo` | `explorer/types/explorertypes.go:911,913` |
| `psHub.Store` also calls `RemainingWindowText` for both fields | `pubsub/pubsubhub.go:734,736` |
| `ChartTip` struct definition | `db/cache/charts.go:490–497` |
| `SetTip` stores tip, calls `invalidateTipCharts` | `db/cache/charts.go:908–913` |
| `invalidateTipCharts` deletes `TicketPrice`+`POWDifficulty` (WindowBin) and `PercentStaked` (Block+DayBin) | `db/cache/charts.go:919–933` |
| Type assertion `exp.chartSource.(*cache.ChartData)` + `PoolInfo.Value * 1e8` conversion | `explorer.go:652–668` |
| `chartSource` field typed as `ChartDataSource` interface on `explorerUI` | `explorer.go:223` |

See also:
- /wiki/code-analysis/page-rendering/patterns.md (shares-pattern-with: all cross-domain rendering patterns)
- /wiki/code-analysis/page-rendering/impact.md (depends-on: mutation risks)
- /wiki/core/constraints.md (depends-on: C1 precision, C2 single-coin, C3 fee-coin)
- /wiki/code-analysis/mempool/flow.full.md (shares-pattern-with: invsMtx lock discipline, CoinFills)
- /wiki/code-analysis/block/flow.full.md (shares-pattern-with: Store fan-out / WS drift)
- /wiki/code-analysis/charts/flow.full.md (shares-pattern-with: withCache ETag, HashrateShares cross-navigation)
