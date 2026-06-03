# Agendas — Full Flow (`/agendas`, `/agenda/{id}`)

> Scope: re-enabling the consensus-deployment **Agendas** pages and assessing whether they
> need adaptation to the Monetarium multi-coin model. Status as of this trace: the HTML pages
> are **dormant** (route-stubbed to HTTP 410), but the handlers, the JSON API, and the full
> backend data pipeline are intact and functional.

## Section 1 — Overview

The Agendas feature surfaces Decred-style **stake-version consensus voting**: each
`ConsensusDeployment` ("agenda") is voted on by ticket holders via vote (`ssgen`) transactions.
Two pages exist:

- `/agendas` — list of all agendas + live Rule-Change-Interval (RCI) / Stake-Version-Interval
  (SVI) / miner / voter / quorum / approval progress.
- `/agenda/{id}` — one agenda's metadata, choice tally table, and two Dygraphs charts
  (cumulative vote choices over time, vote choices by block).

**The whole feature carries no monetary amounts.** Every displayed value is a vote *count*
(`uint32`), a *percentage* (`float32`), a block *height*, a *status* string, or a *timestamp*.
There is no VAR/SKA value anywhere in the agendas flow, so the precision bifurcation (C1) and
coin-label rules (C7) **do not apply** — this is the central finding for the "adapt to the
Monetarium model" question (see Section 5).

**Current disabled state.** [cmd/dcrdata/main.go:780-785](../../../cmd/dcrdata/main.go#L780-L785)
replaces the two HTML routes with closures returning `http.StatusGone` ("agendas not
available"). The original wiring was:

```go
withCache.Get("/agendas", explore.AgendasPage)
withCache.With(explorer.AgendaPathCtx).Get("/agenda/{agendaid}", explore.AgendaPage)
```

It was stubbed in commit `52ea3cf1` *("feat: multi-coin data in explorer routes and template
structs")* in the same bulk edit that stubbed `/treasury`, `/proposals`, and (later) `/market`.
Unlike treasury (genuinely absent from Monetarium) and proposals (Politeia), agendas was a
**defensive stub during migration**, not a removal: the node, the handlers, and the DB pipeline
all still support it.

## Section 2 — End-to-End Data Flow

Two complementary data origins feed the pages (a **dual-source** design):

```text
                              ┌─ Node RPC: GetVoteInfo / GetStakeVersionInfo / GetStakeVersions
   monetarium-node ───────────┤   (live voting metadata + tallies, per stake version)
                              └─ Node RPC: GetBlockChainInfo .Deployments (agenda status/milestones)
        │                                   │
        ▼                                   ▼
  gov/agendas.AgendaDB (storm/Bolt)   db/dcrpg ChainDB.deployments.chainInfo.AgendaMileStones
  gov/agendas.VoteTracker (in-mem)    db/dcrpg agendas + agenda_votes tables (Postgres)
        │                                   │   ▲
        │                                   │   └── insertVotes() during StoreBlock
        ▼                                   ▼        (SSGenVoteChoices → vote bits → choice rows)
  explorer.AgendasPage / AgendaPage   api.getAgendasData / api.getAgendaData
        │                                   │
        ▼                                   ▼
  views/agendas.tmpl, agenda.tmpl     /api/agendas (JSON), /api/agenda/{id} (JSON charts)
        │                                   │
        ▼                                   ▼
  agendas_controller.js (meters)      agenda_controller.js (Dygraphs ← /api/agenda/{id})
```

HTML pages are **request-scoped HTTP only** — there is no WebSocket push path for agendas, so
the Template+WebSocket parity concern (C3) does not arise here.

## Section 3 — Per-Layer Breakdown

### Layer A — Node RPC (source of truth for live state)
- **Location:** `DeploymentSource`/`VoteDataSource` interfaces in
  [gov/agendas/deployments.go:56-58](../../../gov/agendas/deployments.go#L56-L58),
  [gov/agendas/tracker.go:26-31](../../../gov/agendas/tracker.go#L26-L31).
- **Data structures:** `chainjson.GetVoteInfoResult`, `chainjson.Agenda`, `chainjson.Choice`
  (node `rpc/jsonrpc/types`: `ID, Description, Bits, IsAbstain, IsNo, Count, Progress`),
  `GetStakeVersionInfoResult`, `GetStakeVersionsResult`, and
  `GetBlockChainInfoResult.Deployments` (`map[string]AgendaInfo` with `Status`, `Since`,
  `StartTime`, `ExpireTime`).
- **Transformations:** none — raw RPC results.

### Layer B — `gov/agendas` (metadata cache + live tracker)
- **Location:** [gov/agendas/deployments.go](../../../gov/agendas/deployments.go),
  [gov/agendas/tracker.go](../../../gov/agendas/tracker.go).
- **Data structures:**
  - `AgendaTagged` ([deployments.go:33-43](../../../gov/agendas/deployments.go#L33-L43)) —
    storm-tagged copy of `chainjson.Agenda` + `VoteVersion`, primary key `ID`. Persisted to a
    BoltDB file (`agendas.db`, default name [config.go:67](../../../cmd/dcrdata/config.go#L67)).
  - `VoteSummary` ([tracker.go:65-91](../../../gov/agendas/tracker.go#L65-L91)) and
    `AgendaSummary` ([tracker.go:38-61](../../../gov/agendas/tracker.go#L38-L61)) — live RCI/SVI
    progress, quorum/approval, per-agenda `IsVoting/IsLocked/IsFailed/IsActive` flags. All
    counts `uint32`, all rates/progress `float32`.
- **Transformations:**
  - `agendasForVoteVersion` ([deployments.go:194](../../../gov/agendas/deployments.go#L194)) maps
    `chainjson.Agenda` → `AgendaTagged`; `Status` via `dbtypes.AgendaStatusFromStr`.
  - `UpdateAgendas` ([deployments.go:254](../../../gov/agendas/deployments.go#L254)) refreshes
    all stake versions; invoked once at startup
    ([main.go:981](../../../cmd/dcrdata/main.go#L981)) and **every 5 blocks**
    ([explorer.go:892-894](../../../cmd/dcrdata/internal/explorer/explorer.go#L892-L894)).
  - `VoteTracker.Summary()` builds `VoteSummary` from RPC + chaincfg params (quorum, thresholds,
    interval sizes). Constructed only when **not simnet**
    ([main.go:433-440](../../../cmd/dcrdata/main.go#L433-L440)); `nil` tracker is a sentinel.

### Layer C — `db/dcrpg` (historical tally + milestones)
- **Location:** [db/dcrpg/pgblockchain.go](../../../db/dcrpg/pgblockchain.go),
  [db/dcrpg/queries.go](../../../db/dcrpg/queries.go), `db/dcrpg/internal/stakestmts.go`.
- **Data structures:** Postgres tables `agendas` + `agenda_votes`
  ([tables.go:26-27](../../../db/dcrpg/tables.go#L26-L27)); `dbtypes.MileStone`
  ([db/dbtypes/types.go:973](../../../db/dbtypes/types.go#L973)); `dbtypes.AgendaSummary`
  ([types.go:986](../../../db/dbtypes/types.go#L986)); `dbtypes.AgendaVoteChoices`
  ([types.go:2164](../../../db/dbtypes/types.go#L2164)) with parallel arrays
  `Yes/No/Abstain/Total []uint64`, `Height []uint64`, `Time []TimeDef`.
- **Transformations / writes:**
  - **`agenda_votes` IS populated** — `insertVotes`
    ([queries.go:382](../../../db/dcrpg/queries.go#L382)), called from the `StoreBlock` path at
    [pgblockchain.go:4340](../../../db/dcrpg/pgblockchain.go#L4340). For each vote tx it calls
    `txhelpers.SSGenVoteChoices` ([queries.go:558](../../../db/dcrpg/queries.go#L558)) and
    inserts choice rows via `MakeAgendaInsertStatement` / `MakeAgendaVotesInsertStatement`
    (→ `InsertAgendaRow` / `InsertAgendaVotesRow` / upsert variants in
    `internal/stakestmts.go`). Status changes are diffed against the `storedAgendas` cache
    ([pgblockchain.go:77](../../../db/dcrpg/pgblockchain.go#L77)) and the
    `votesMilestones.AgendaMileStones` map.
  - **`AgendaMileStones`** is rebuilt on each chain-info update
    ([pgblockchain.go:3118-3157](../../../db/dcrpg/pgblockchain.go#L3118-L3157)) from
    `GetBlockChainInfo.Deployments`, deriving `VotingStarted/VotingDone/Activated` from
    `RuleChangeActivationInterval` and the agenda `Status`.
  - **Reads:** `AgendaVotes(ctx, id, chartType)`
    ([pgblockchain.go:1588](../../../db/dcrpg/pgblockchain.go#L1588)) → `retrieveAgendaVoteChoices`;
    `AgendasVotesSummary` ([1607](../../../db/dcrpg/pgblockchain.go#L1607)),
    `AgendaVoteCounts` ([1630](../../../db/dcrpg/pgblockchain.go#L1630)) →
    `retrieveTotalAgendaVotesCount`; `AllAgendas()`
    ([1647](../../../db/dcrpg/pgblockchain.go#L1647)) → `retrieveAllAgendas` (milestone map).
    All three first short-circuit if `agendaInfo.StartTime` is in the future.

### Layer D — Handlers (HTML + JSON API)
- **HTML — `AgendasPage`** ([explorerroutes.go:2066-2098](../../../cmd/dcrdata/internal/explorer/explorerroutes.go#L2066-L2098)):
  `nil` voteTracker → status page *"agendas disabled on simnet"*; else `agendasSource.AllAgendas()`
  plus `voteTracker.Summary()` → template `agendas`.
- **HTML — `AgendaPage`** ([explorerroutes.go:1977-2063](../../../cmd/dcrdata/internal/explorer/explorerroutes.go#L1977-L2063)):
  `agendasSource.AgendaInfo(id)` (BoltDB) + `dataSource.AgendasVotesSummary(ctx, id)` (Postgres);
  overrides each `Choices[i].Count` with the DB tally (`abstain/yes/no`), computes
  `qVotes = RuleChangeActivationQuorum * QuorumProgress`, time-left, → template `agenda`.
- **JSON — `getAgendasData`** ([apiroutes.go:2046-2076](../../../cmd/dcrdata/internal/api/apiroutes.go#L2046-L2076)):
  `AgendaDB.AllAgendas()` + `DataSource.AllAgendas()` (milestones) → `[]apitypes.AgendasInfo`.
  **This route is still live** ([apirouter.go:211-213](../../../cmd/dcrdata/internal/api/apirouter.go#L211-L213)).
- **JSON — `getAgendaData`** ([apiroutes.go:2005-2041](../../../cmd/dcrdata/internal/api/apiroutes.go#L2005-L2041)):
  `AgendaVotes(id, 0)` (by time) + `AgendaVotes(id, 1)` (by height) →
  `apitypes.AgendaAPIResponse{ByHeight, ByTime}` (JSON `by_height`/`by_time`). **Still live**
  ([apirouter.go:216-218](../../../cmd/dcrdata/internal/api/apirouter.go#L216-L218)), guarded by
  `m.AgendaIdCtx`.

### Layer E — Templates + JS
- **`views/agendas.tmpl`** — `data-controller="agendas"`; renders `VoteSummary.Agendas`,
  RCI/SVI progress bars, and meter `<div>`s with `data-agendas-target` +
  `data-progress`/`data-threshold`/`data-approval`. Uses template func `f32x100`
  ([templates.go:754](../../../cmd/dcrdata/internal/explorer/templates.go#L754)),
  `secondsToShortDurationString`, `dateTimeWithoutTimeZone`. No coin amounts.
- **`views/agenda.tmpl`** — choice table (`ID/Description/Bits/Count/Progress`) +
  `data-controller="agenda" data-agenda-id="{{.ID}}"` with two chart target `<div>`s.
- **`agendas_controller.js`** — builds `ProgressMeter`/`VoteMeter` from the meter `data-*`
  attrs; re-themes on `NIGHT_MODE`.
- **`agenda_controller.js`** — on connect, `requestJSON('/api/agenda/${id}')`, maps
  `by_time → [Date, yes, abstain, no]` and `by_height → [height, yes, abstain, no]` into two
  Dygraphs. Empty/missing arrays fall back to `[[0,0,0,0]]`.

## Section 4 — Cross-Layer Dependencies

- **Dual data origin coupling.** `AgendaPage` joins BoltDB metadata (`AgendaInfo`) with Postgres
  tallies (`AgendasVotesSummary`) by **string agenda ID** and by **choice ID string** (`"yes"`,
  `"no"`, `"abstain"`, matched lower-cased at
  [explorerroutes.go:2003-2011](../../../cmd/dcrdata/internal/explorer/explorerroutes.go#L2003-L2011)).
  A renamed choice ID would silently drop the override.
- **Go→JS meter contract (untyped).** `agendas.tmpl` emits `data-progress`, `data-threshold`,
  `data-approval` (raw `float32` 0–1); `agendas_controller.js` reads them positionally. No
  compile-time check.
- **Go→JS chart contract (untyped JSON).** `dbtypes.AgendaVoteChoices` field tags
  (`yes/no/abstain/height/time`) must match the keys read in `agenda_controller.js`
  (`d.yes/d.abstain/d.no/d.time/d.height`). Adding/renaming a field changes the wire shape
  silently.
- **Milestone dependency.** Every Postgres read keys `ChainInfo().AgendaMileStones[agendaID]`;
  if `GetBlockChainInfo` stops returning a deployment, that agenda's tallies become unreachable
  even though `agenda_votes` rows still exist.
- **Consensus gating reuse.** The same `AgendaMileStones` map drives `IsDCP0010Active` /
  `IsDCP0011Active` / `IsDCP0012Active`
  ([pgblockchain.go:5064-5152](../../../db/dcrpg/pgblockchain.go#L5064-L5152)) — subsidy-split and
  blake3pow activation. Re-enabling the pages does **not** touch this, but it shows agenda data
  is load-bearing beyond the UI.
- **Nav coupling.** The navbar ([extras.tmpl:79-87](../../../cmd/dcrdata/views/extras.tmpl#L79-L87))
  has **no Agendas link** — it was removed when the page was stubbed. Re-enabling the route
  without re-adding the link leaves the page reachable only by direct URL.

## Section 5 — Critical Constraints

- **C1 (numeric precision) — N/A here, and that is the answer to "adapt to Monetarium?".**
  Agendas carry no VAR/SKA values: tallies are `uint32`, rates `float32`, heights/quorum
  integers. There is no `.ToCoin()`, no `big.Int`, no atom string. **No multi-coin or precision
  adaptation is required.** See [/wiki/core/constraints.md](../../core/constraints.md) C1 for the
  rule this flow is exempt from.
- **C3 (template + WebSocket parity) — N/A.** No WebSocket push path for agendas; both pages are
  request-scoped HTTP. (Contrast block/tx, which must mirror fields across template + WS.)
- **C7 (coin-type labels) — N/A.** No coin labels are rendered.
- **Real Monetarium-specific dependency: node must expose consensus deployments + stake-version
  voting.** Verified present in `monetarium-node` chaincfg **v1.3.10**: mainnet defines **48**
  agenda IDs, testnet **52**, across vote versions; vote IDs include `VoteIDMaxBlockSize`,
  `VoteIDChangeSubsidySplit`, `VoteIDBlake3Pow`, `VoteIDChangeSubsidySplitR2`. RPC result types
  `GetVoteInfoResult`, `Agenda`, `Choice`, `GetStakeVersionsResult`,
  `GetStakeVersionInfoResult` all exist. So the data pipeline produces real data; agendas were
  **not** removed for lack of node support.
- **VoteTracker is mandatory on non-simnet.** `NewVoteTracker` returns an error if
  `len(stakeVersions) == 0` ([tracker.go:136-138](../../../gov/agendas/tracker.go#L136-L138)), and
  `_main` treats that as fatal ([main.go:434-439](../../../cmd/dcrdata/main.go#L434-L439)). Since
  the explorer already starts on non-simnet, the tracker already initializes — re-enabling the
  page does not add a new startup risk.

## Section 6 — Mutation Impact

**To re-enable the pages (the requested change):**

1. **Restore the two routes** at [main.go:780-785](../../../cmd/dcrdata/main.go#L780-L785):
   `withCache.Get("/agendas", explore.AgendasPage)` and
   `withCache.With(explorer.AgendaPathCtx).Get("/agenda/{agendaid}", explore.AgendaPage)`. Both
   handlers and `AgendaPathCtx`/`getAgendaIDCtx`
   ([explorermiddleware.go:228,276](../../../cmd/dcrdata/internal/explorer/explorermiddleware.go#L228))
   already exist and compile.
2. **Re-add the navbar link** in
   [extras.tmpl:79-87](../../../cmd/dcrdata/views/extras.tmpl#L79-L87) (e.g. an "Agendas"
   `menu-item` → `/agendas`). Without this the page is orphaned.
3. **No backend, API, template, or JS changes are needed** — they are intact.
4. **Reconcile docs:** the market-removal spec
   ([wiki/specs/market-removal/spec.md](../../specs/market-removal/spec.md), indexed at
   [wiki/index.md:32](../../index.md)) lists `/agendas` among "made unavailable (like
   `/treasury`, `/proposals`)". Update that note — agendas is being re-enabled, not removed.

**Direct deps to check when changing agenda data structures:** `AgendaTagged`,
`VoteSummary`/`AgendaSummary`, `dbtypes.MileStone`, `dbtypes.AgendaVoteChoices`,
`apitypes.AgendasInfo`/`AgendaAPIResponse`, the two templates, the two JS controllers, and the
`/api/agendas` + `/api/agenda/{id}` consumers.

**Silent failures:**
- Re-enable route but forget the nav link → page works only via direct URL (no error).
- `agenda_votes` charts render but are **empty** (`[[0,0,0,0]]`) for any agenda whose votes
  were not seen during the explorer's DB sync, or if `SSGenVoteChoices` returns no choices
  (deployment absent for that vote version). Data is populated **forward** during sync; a full
  resync from genesis is the only way to backfill completed historical votes.
- Renaming a choice ID string ("yes"/"no"/"abstain") or a `AgendaVoteChoices` JSON tag → counts
  silently mis-mapped / charts blank.
- A Postgres timeout in `AgendaVotes` returns `nil` → blank chart, page still 200.

**Hard failures:**
- Unknown `agendaid` → `AgendaInfo` error → `ExpStatusNotFound` page.
- `AllAgendas()` DB error → `ExpStatusError` page.
- On non-simnet, a node with **zero** stake versions would fail `NewVoteTracker` → explorer
  won't start (pre-existing risk, unchanged by re-enabling).
- On simnet, `voteTracker == nil` → `/agendas` shows the *"agendas disabled on simnet"* status
  page by design.

## Section 7 — Common Pitfalls

- **Assuming agendas needs multi-coin work.** It does not — no VAR/SKA values flow through it.
  Don't add coin-type maps, `.ToCoin()` calls, or atom-string handling here.
- **Re-enabling the route but not the navbar item** — leaves the page discoverable only by URL.
- **Expecting historical vote charts to be fully populated immediately** — `agenda_votes` is
  built during forward sync; pre-sync completed votes won't appear without a genesis resync.
- **Treating agendas like treasury/proposals** — those are genuine removals; agendas is dormant
  but fully wired. Don't delete the handlers or DB tables.
- **Forgetting the BoltDB↔Postgres join** — `AgendaPage` needs *both* `agendasSource`
  (metadata) and `dataSource` (tallies); a nil `agendasSource` or missing milestone breaks it.

## Section 8 — Evidence

- Route stubs / original wiring: [main.go:780-785](../../../cmd/dcrdata/main.go#L780-L785);
  commit `52ea3cf1` diff replaced `explore.AgendasPage`/`explore.AgendaPage` with 410 closures.
- Handlers: `AgendasPage`
  [explorerroutes.go:2066](../../../cmd/dcrdata/internal/explorer/explorerroutes.go#L2066),
  `AgendaPage` [explorerroutes.go:1975-2063](../../../cmd/dcrdata/internal/explorer/explorerroutes.go#L1975-L2063).
- Backend interface: `agendaBackend`
  [explorer.go:134-137](../../../cmd/dcrdata/internal/explorer/explorer.go#L134-L137); wiring
  [main.go:415-452](../../../cmd/dcrdata/main.go#L415-L452).
- DB pipeline: `insertVotes` [queries.go:382](../../../db/dcrpg/queries.go#L382) +
  [queries.go:537-604](../../../db/dcrpg/queries.go#L537-L604); caller
  [pgblockchain.go:4340](../../../db/dcrpg/pgblockchain.go#L4340); milestones
  [pgblockchain.go:3118-3157](../../../db/dcrpg/pgblockchain.go#L3118-L3157);
  `SSGenVoteChoices` [txhelpers.go:1020](../../../txhelpers/txhelpers.go#L1020).
- API: [apirouter.go:211-218](../../../cmd/dcrdata/internal/api/apirouter.go#L211-L218),
  [apiroutes.go:2005-2076](../../../cmd/dcrdata/internal/api/apiroutes.go#L2005-L2076);
  types [apitypes.go:135-147](../../../api/types/apitypes.go#L135-L147).
- Templates: [agendas.tmpl](../../../cmd/dcrdata/views/agendas.tmpl),
  [agenda.tmpl](../../../cmd/dcrdata/views/agenda.tmpl); JS
  [agendas_controller.js](../../../cmd/dcrdata/public/js/controllers/agendas_controller.js),
  [agenda_controller.js](../../../cmd/dcrdata/public/js/controllers/agenda_controller.js).
- Node support: `monetarium-node/chaincfg@v1.3.10` `mainnetparams.go:148`/`testnetparams.go:147`
  `Deployments` maps; vote IDs at `mainnetparams.go:405-461`; RPC types
  `rpc/jsonrpc/types@v1.3.10/chainsvrresults.go:497-527` (`Choice`, `Agenda`,
  `GetVoteInfoResult`).
- Navbar (no agendas link): [extras.tmpl:79-87](../../../cmd/dcrdata/views/extras.tmpl#L79-L87).

See also:
- /wiki/code-analysis/agendas/flow.compact.md (derived-from: this file)
- /wiki/code-analysis/agendas/patterns.md (shares-pattern-with: dormant-feature stub, dual-source governance data)
- /wiki/code-analysis/agendas/impact.md (depends-on: re-enable blast radius)
- /wiki/core/constraints.md (depends-on: C1 numeric precision — explicitly N/A for agendas; C3 parity — N/A, no WS path; C7 coin labels — N/A)
- /wiki/code-analysis/parameters/flow.full.md (shares-pattern-with: near-static chaincfg.Params + node-RPC page)
- /wiki/specs/market-removal/spec.md (contradicts: lists /agendas as removed; reconcile on re-enable)
