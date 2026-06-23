# Page-Rendering — Compact Knowledge

**Flow:**
`blockdata fan-out → (*explorerUI).Store → pageData{BlockInfo, HomeInfo, SKACoinSupply, CBlockSubsidy, ActiveMiners, VoteRewards, WindowRemaining, RewardRemaining} + chartSource.SetTip(ChartTip) → (any page handler reads pageData.RLock) → commonData(r) [GetTip] → struct{*CommonPageData, …page} → templates.exec → text/html`

**Parallel WS path:** `psHub.Store` transforms the same fan-out independently; no shared layer. Both savers call `types.RemainingWindowText` for `WindowRemaining`/`RewardRemaining`.

**Key Architectural Patterns:**

1. **Out-of-band shared page state.** Page handlers are pure readers of a background-written snapshot. `Store` writes, handlers read — under `pageData.RWMutex`. New per-page data goes in the handler's own struct, not in `pageData`.

2. **withCache / ETag caching.** Routes under `withCache` (`/`, `/mempool`, `/hashrate-shares` shell, `/agendas`, `/parameters`, etc.) get `ETag`/`Last-Modified` headers reset on every new block/mempool tick. **Do not put a handler under `withCache` if its output varies by query params** — `/hashrate-shares/data` is excluded from `withCache` for this reason (`main.go:774`).

3. **`*CommonPageData` struct-embedding.** Every page payload is an anonymous struct embedding `*CommonPageData` (from `commonData(r)`). `commonData` calls `GetTip` (Postgres); returns `nil` on failure → every page fails simultaneously (no per-page isolation).

4. **`normalizeExplorerRows[T]`** (`explorerroutes.go:645`). Generic over `int64|uint64`. Default 100, cap 400. Used by `Blocks`, `StakeDiffWindows`, `timeBasedBlocksListing`. Pass `0` to get the default; the function handles the `rows==0` case.

5. **Three-lock discipline.** `pageData.RWMutex` (struct contents) / `invsMtx` (invs pointer) / `MempoolInfo.RWMutex` (inv contents). `Store` nests `pageData.Lock` → `invsMtx.Lock`. All other code must not hold `invsMtx` while waiting on `pageData.Lock` (deadlock). `StoreMPData` releases `pageData.RLock` before taking `invsMtx.Lock`.

6. **Chart cache tip push.** After writing `HomeInfo`, `Store` type-asserts `exp.chartSource` to `*cache.ChartData` and calls `SetTip(ChartTip{…})`. `SetTip` stores the tip and invalidates cached bytes for `TicketPrice`/`POWDifficulty` (WindowBin) and `PercentStaked` (Block+DayBin), forcing re-render on the next chart API request. The assertion silently no-ops on mocks/simnet — no error, no log.

**Critical Constraints:**

- **SKA precision:** SKA amounts must stay `*big.Int`-derived strings into `HomeInfo` (via `FormatSKAAtoms`). No float64 for SKA atoms at any point before the template.
- **CBlockSubsidy vs NBlockSubsidy:** `CBlockSubsidy` is the actual vote-scaled current-block subsidy; use it for `LBlockTotal` and the home page PoW display. `NBlockSubsidy` is the next-block projected max.
- **Saver symmetry:** Every `HomeInfo` field change in `Store` (`explorer.go`) must also be applied in `psHub.Store` (`pubsub/pubsubhub.go`). Drift is silent (HTML/WS disagree).
- **RemainingWindowText single source:** `WindowRemaining`/`RewardRemaining` are always computed via `types.RemainingWindowText` (`explorer/types/remaining.go:17`), never inlined. Both savers call it (issue #502).
- **agendas VoteVersion filter:** `AgendasPage` cross-filters VoteTracker via `filterAgendaSummaries`; nil voteTracker → `ExpStatusPageDisabled` (not a crash).

**Mutation Checklist:**

- Adding a page handler → check: (a) `withCache` eligibility (no varying query params), (b) nil `*CommonPageData` guard not needed (all pages already fail loudly), (c) mock update in `explorer_test.go` if new `explorerDataSource` method added.
- Changing a `HomeInfo` field in `Store` → also update `psHub.Store`, WS JSON encoder, home templates, and JS controllers.
- Changing `defaultExplorerRows` → all three list pages change simultaneously; verify template dropdowns include the new value.
- Moving `HashrateSharesData` → must stay outside `withCache`; adding query-param-varying endpoints next to it follows the same rule.
- Removing or replacing `chartSource` implementation → verify `SetTip` still fires; chart staleness (TicketPrice, POWDifficulty, PercentStaked) is silent if type assertion stops matching.
- Changing `RemainingWindowText` signature → update both `explorer.go:568,570` and `pubsub/pubsubhub.go:734,736` together.
