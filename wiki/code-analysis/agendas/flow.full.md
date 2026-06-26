# Agendas — Full Flow (`/agendas`, `/agenda/{id}`)

> Scope: the consensus-deployment **Agendas** pages and whether they need adaptation to the
> Monetarium multi-coin model. Status: the HTML pages are **live** — enabled in **PR #395**
> (commit `6622b4ae`) by restoring the two routes and re-adding the navbar link. The handlers,
> the JSON API, and the full backend data pipeline were intact throughout (the pages were only
> ever route-stubbed to HTTP 410, never removed).

## Section 1 — Overview

The Agendas feature surfaces Decred-style **stake-version consensus voting**: each
`ConsensusDeployment` ("agenda") is voted on by ticket holders via vote (`ssgen`) transactions.
Two pages exist:

- `/agendas` — list of all agendas + live Rule-Change-Interval (RCI) / Stake-Version-Interval
  (SVI) / miner / voter / quorum / approval progress.
- `/agenda/{id}` — one agenda's metadata, choice tally table, and two uPlot charts via
  ChartPanel (cumulative vote choices over time, vote choices by block).

**The whole feature carries no monetary amounts.** Every displayed value is a vote *count*
(`uint32`), a *percentage* (`float32`), a block *height*, a *status* string, or a *timestamp*.
There is no VAR/SKA value anywhere in the agendas flow, so the precision bifurcation (C1) and
coin-label rules (C7) **do not apply** — this is the central finding for the "adapt to the
Monetarium model" question (see Section 5).

**Current state — live (PR #395).** [cmd/dcrdata/main.go:785-786](../../../cmd/dcrdata/main.go#L785-L786)
now wires the two HTML routes to the real handlers:

```go
withCache.Get("/agendas", explore.AgendasPage)
withCache.With(explorer.AgendaPathCtx).Get("/agenda/{agendaid}", explore.AgendaPage)
```

**History.** The pages had been route-stubbed to `http.StatusGone` ("agendas not available") in
commit `52ea3cf1` *("feat: multi-coin data in explorer routes and template structs")*, in the same
bulk edit that stubbed `/treasury`, `/proposals`, and (later) `/market`. Unlike treasury (genuinely
absent from Monetarium) and proposals (Politeia), agendas was a **defensive stub during
migration**, not a removal — the node, the handlers, and the DB pipeline always supported it.
**PR #395** (`6622b4ae`) re-enabled it by reverting those two route lines and re-adding the navbar
link ([extras.tmpl:85](../../../cmd/dcrdata/views/extras.tmpl#L85)); a follow-up commit
(`43a27ce2`) added a nil-summary guard for not-yet-started agendas (see Sections 5–6).

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
  agendas_controller.js (meters)      agenda_controller.js (ChartPanel/uPlot ← /api/agenda/{id})
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
  - `AllAgendas` ([deployments.go:294](../../../gov/agendas/deployments.go#L294)) reads the whole
    `AgendaTagged` bucket and **filters out pre-Monetarium agendas** — it selects
    `q.Gte("VoteVersion", MinVoteVersion)` (constant `MinVoteVersion = 11`,
    [deployments.go:57](../../../gov/agendas/deployments.go#L57)) ordered by vote version
    descending. `UpdateAgendas` still **stores** every stake version (1…N) the node reports;
    `AllAgendas` is the read-side gate that hides versions 1–10. When nothing qualifies, storm's
    `Find` returns `ErrNotFound`, which `AllAgendas` maps to `([]*AgendaTagged{}, nil)` so callers
    render an empty list, not an error. This is the single shared source for **both** list
    surfaces (`/agendas` table and `/api/agendas` JSON); `AgendaInfo` (single-ID lookup) is **not**
    filtered (see Sections 5–6).
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
    [pgblockchain.go:4426](../../../db/dcrpg/pgblockchain.go#L4426). For each vote tx it calls
    `txhelpers.SSGenVoteChoices` ([queries.go:558](../../../db/dcrpg/queries.go#L558)) and
    inserts choice rows via `MakeAgendaInsertStatement` / `MakeAgendaVotesInsertStatement`
    (→ `InsertAgendaRow` / `InsertAgendaVotesRow` / upsert variants in
    `internal/stakestmts.go`). Status changes are diffed against the `storedAgendas` cache
    ([pgblockchain.go:77](../../../db/dcrpg/pgblockchain.go#L77)) and the
    `votesMilestones.AgendaMileStones` map.
  - **`AgendaMileStones`** is rebuilt on each chain-info update
    ([pgblockchain.go:3149-3188](../../../db/dcrpg/pgblockchain.go#L3149-L3188)) from
    `GetBlockChainInfo.Deployments`, deriving `VotingStarted/VotingDone/Activated` from
    `RuleChangeActivationInterval` and the agenda `Status`.
  - **Reads:** `AgendaVotes(ctx, id, chartType)`
    ([pgblockchain.go:1619](../../../db/dcrpg/pgblockchain.go#L1619)) → `retrieveAgendaVoteChoices`;
    `AgendasVotesSummary` ([1638](../../../db/dcrpg/pgblockchain.go#L1638)),
    `AgendaVoteCounts` ([1661](../../../db/dcrpg/pgblockchain.go#L1661)) →
    `retrieveTotalAgendaVotesCount`; `AllAgendas()`
    ([1647](../../../db/dcrpg/pgblockchain.go#L1647)) → `retrieveAllAgendas` (milestone map).
    All three first short-circuit if `agendaInfo.StartTime` is in the future.

### Layer D — Handlers (HTML + JSON API)
- **HTML — `AgendasPage`** ([explorerroutes.go:2142-2194](../../../cmd/dcrdata/internal/explorer/explorerroutes.go#L2142-L2194)):
  `nil` voteTracker → status page *"agendas disabled on simnet"*; else `agendasSource.AllAgendas()`
  (the version-filtered **table** list) plus `voteTracker.Summary()` (the live progress **cards**).
  **The page renders agendas twice from two sources, so the handler cross-filters the cards to the
  table:** it builds an allowed-ID set from `AllAgendas()` and passes the tracker summaries through
  the pure helper `filterAgendaSummaries`
  ([call at explorerroutes.go:2174](../../../cmd/dcrdata/internal/explorer/explorerroutes.go#L2174),
  [func at 2200-2208](../../../cmd/dcrdata/internal/explorer/explorerroutes.go#L2200-L2208), PR #401),
  dropping any `VoteSummary.Agendas` entry whose `ID` is not in the set — on a **defensive copy** of
  the shared `tracker.summary` (it must not mutate tracker state), matching by **ID** because
  `AgendaSummary` has no `VoteVersion`. → template `agendas`.
- **HTML — `AgendaPage`** ([explorerroutes.go:2047-2140](../../../cmd/dcrdata/internal/explorer/explorerroutes.go#L2047-L2140)):
  `agendasSource.AgendaInfo(id)` (BoltDB) + `dataSource.AgendasVotesSummary(ctx, id)` (Postgres).
  **`AgendasVotesSummary` returns `(nil, nil)` for an agenda whose voting has not started yet
  (future `StartTime`); the handler substitutes a zero-tally `&dbtypes.AgendaSummary{}`**
  ([explorerroutes.go:2068-2072](../../../cmd/dcrdata/internal/explorer/explorerroutes.go#L2068-L2072))
  before it dereferences `summary.Abstain/Yes/No` (choice override) and `summary.LockedIn`
  (time-left). It then overrides each `Choices[i].Count` with the DB tally (`abstain/yes/no`),
  computes `qVotes = RuleChangeActivationQuorum * QuorumProgress`, time-left, → template `agenda`.
- **JSON — `getAgendasData`** ([apiroutes.go:2069-2100](../../../cmd/dcrdata/internal/api/apiroutes.go#L2069-L2100)):
  `AgendaDB.AllAgendas()` + `DataSource.AllAgendas()` (milestones) → `[]apitypes.AgendasInfo`.
  The output loop is driven by the version-filtered `AgendaDB.AllAgendas()` slice, so
  `/api/agendas` inherits the `VoteVersion >= MinVoteVersion` gate for free; the
  `DataSource.AllAgendas()` milestone map is unfiltered but only read per emitted agenda ID.
  **This route is still live** ([apirouter.go:211-213](../../../cmd/dcrdata/internal/api/apirouter.go#L211-L213)).
- **JSON — `getAgendaData`** ([apiroutes.go:2028-2064](../../../cmd/dcrdata/internal/api/apiroutes.go#L2028-L2064)):
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
  `data-controller="agenda" data-agenda-id="{{.ID}}"` with two CSS-classed chart `<div>`s
  (`agenda-chart--cumulative`, `agenda-chart--block`) and two ranger strip `<div>`s
  (`data-agenda-target="cumulativeRanger"` / `"blockRanger"`). Chart titles are plain HTML
  above each pair (not template-rendered text). Previous inline `style="width:100%; height:Npx"`
  attributes are replaced by CSS classes.
- **`agendas_controller.js`** — builds `ProgressMeter`/`VoteMeter` from the meter `data-*`
  attrs; re-themes on `NIGHT_MODE`.
- **`agenda_controller.js`** — on connect, `requestJSON('/api/agenda/${id}')`, creates two
  `ChartPanel` instances (one per chart target `<div>`), each with a ranger element wired from
  the template's `cumulativeRanger`/`blockRanger` targets. Calls `panel.render(def, data)` in
  `Promise.all` for parallel init. Chart definitions are imported from
  `charts/definitions/agenda.js`. Disconnect: `panel.destroy()` on each instance.
- **`charts/definitions/agenda.js`** *(widened; new file)* — defines
  `cumulativeVoteChoicesDef()` (stacked area, time axis) and `voteChoicesByBlockDef()` (stacked
  bars, block-height axis). The `voteColumns(raw, xs)` helper reshapes the API payload
  (`by_time` → `[xs, yes[], abstain[], no[]]`; `by_height` → `[height[], yes[], abstain[], no[]]`)
  — this is the new home of the data transformation that was previously inline in
  `agenda_controller.js`. `formatVote(seriesIdx, datum)` reads raw per-series count from
  `datum.payload[field][i]` and computes share-of-total percentage (parity with the legacy
  Dygraphs `agendasLegendFormatter`). Imports `secondsFromTimes` from `definitions/address.js`
  for time-axis conversion (seconds epoch from ISO-like time strings).

## Section 4 — Cross-Layer Dependencies

- **Dual data origin coupling.** `AgendaPage` joins BoltDB metadata (`AgendaInfo`) with Postgres
  tallies (`AgendasVotesSummary`) by **string agenda ID** and by **choice ID string** (`"yes"`,
  `"no"`, `"abstain"`, matched lower-cased at
  [explorerroutes.go:2079-2087](../../../cmd/dcrdata/internal/explorer/explorerroutes.go#L2079-L2087)).
  A renamed choice ID would silently drop the override.
- **Go→JS meter contract (untyped).** `agendas.tmpl` emits `data-progress`, `data-threshold`,
  `data-approval` (raw `float32` 0–1); `agendas_controller.js` reads them positionally. No
  compile-time check.
- **Go→JS chart contract (untyped JSON).** `dbtypes.AgendaVoteChoices` field tags
  (`yes/no/abstain/height/time`) must match the keys consumed in
  `charts/definitions/agenda.js:voteColumns()` (`r.yes`, `r.abstain`, `r.no`, `raw.time`,
  `raw.height`) and `formatVote()` (`p[VOTE_SERIES[seriesIdx].field]`). The controller now
  merely passes `res.by_time`/`res.by_height` to each panel; the actual key access lives in
  the definitions file. Adding/renaming a field changes the wire shape silently.
- **New tmpl→JS ranger contract.** `agenda.tmpl` emits
  `data-agenda-target="cumulativeRanger"` and `data-agenda-target="blockRanger"` elements;
  `agenda_controller.js` reads them via `this.hasCumulativeRangerTarget` /
  `this.hasBlockRangerTarget` (Stimulus target checks, guarded). Renaming these targets in the
  template without updating the controller silently disables the ranger strip (chart still works,
  no overview strip).
- **Milestone dependency.** Every Postgres read keys `ChainInfo().AgendaMileStones[agendaID]`;
  if `GetBlockChainInfo` stops returning a deployment, that agenda's tallies become unreachable
  even though `agenda_votes` rows still exist.
- **Consensus gating reuse.** The same `AgendaMileStones` map drives `IsDCP0010Active` /
  `IsDCP0011Active` / `IsDCP0012Active`
  ([pgblockchain.go:5170-5235](../../../db/dcrpg/pgblockchain.go#L5170-L5235)) — subsidy-split and
  blake3pow activation. Re-enabling the pages does **not** touch this, but it shows agenda data
  is load-bearing beyond the UI.
- **Nav coupling.** The navbar ([extras.tmpl:85](../../../cmd/dcrdata/views/extras.tmpl#L85)) has
  an **"Agendas" → `/agendas`** menu item (re-added in PR #395). The route table and the navbar
  must stay in sync: drop the link and the page is reachable only by direct URL; drop the route and
  the link is dead.

## Section 5 — Critical Constraints

- **C1 (numeric precision) — N/A here, and that is the answer to "adapt to Monetarium?".**
  Agendas carry no VAR/SKA values: tallies are `uint32`, rates `float32`, heights/quorum
  integers. There is no `.ToCoin()`, no `big.Int`, no atom string. **No multi-coin or precision
  adaptation is required.** See [/wiki/core/constraints.md](../../core/constraints.md) C1 for the
  rule this flow is exempt from.
- **C3 (template + WebSocket parity) — N/A.** No WebSocket push path for agendas; both pages are
  request-scoped HTTP. (Contrast block/tx, which must mirror fields across template + WS.)
- **C7 (coin-type labels) — N/A.** No coin labels are rendered.
- **Pre-Monetarium vote versions are hidden from the list (`MinVoteVersion = 11`).** Monetarium's
  own votes start at vote version 11; versions 1–10 are Decred-network artifacts the node still
  reports. `AllAgendas` drops them via `q.Gte("VoteVersion", MinVoteVersion)`
  ([deployments.go:57,294-308](../../../gov/agendas/deployments.go#L294-L308)). The threshold is a
  single named constant — do **not** reintroduce a bare `q.True()` select or scatter the literal
  `11`. The gate is coin-agnostic (`VoteVersion` is a `uint32`); it adds no precision/multi-coin
  surface (C1/C7 stay N/A). It governs the **list** surfaces only — `AgendaInfo(id)` is unfiltered,
  so a filtered version's `/agenda/{id}` detail page stays reachable by direct URL (issue #400).
  **The source filter does not reach the `/agendas` page's live progress cards.** Those render from
  `voteTracker.Summary().Agendas` (a separate, tracker-sourced surface), so `AgendasPage`
  cross-filters them against the `AllAgendas` ID set (PR #401) to keep the cards and the table in
  agreement (see Section 6).
- **PRE-VOTING meters gate on non-empty `VoteSummary.Agendas` (commit `07f2d444`).** Inside the
  `{{with .VotingSummary}}` block in `agendas.tmpl`, `.Agendas` refers to `VoteSummary.Agendas`
  (the tracker's `[]AgendaSummary`, already cross-filtered by `filterAgendaSummaries`). The
  PRE-VOTING section at [agendas.tmpl:105](../../../cmd/dcrdata/views/agendas.tmpl#L105) is:
  ```
  {{if and (or (not .NetworkUpgraded) .VotingTriggered) .Agendas}}
  ```
  On mainnet with no VoteVersion ≥ 11 agendas, `filterAgendaSummaries` empties `.Agendas` — the
  pre-voting v{{.Version}} miner/voter progress meters are hidden. **This `.Agendas` is
  `VoteSummary.Agendas`, not the top-level `[]*agendas.AgendaTagged`.** Both template fields are
  named `Agendas` but are different types from different sources; the `{{with}}` scope determines
  which is in play at line 105.
- **Not-yet-started agendas yield a nil DB summary (guarded).** `ChainDB.AgendasVotesSummary` short-circuits
  to `(nil, nil)` when `agendaInfo.StartTime` is in the future (voting not begun). `AgendaPage`
  must replace that with a zero-tally `&dbtypes.AgendaSummary{}`
  ([explorerroutes.go:2068-2072](../../../cmd/dcrdata/internal/explorer/explorerroutes.go#L2068-L2072))
  — otherwise the subsequent `summary.Abstain/Yes/No` and `summary.LockedIn` derefs panic (HTTP 500
  via `middleware.Recoverer`). Added in PR #395 (`43a27ce2`); pinned by
  [agendapage_test.go](../../../cmd/dcrdata/internal/explorer/agendapage_test.go) (`f6ea9703`).
  This is the one place a freshly-defined-but-not-yet-voting deployment differs from an
  actively-voting one.
- **VoteTracker is mandatory on non-simnet.** `NewVoteTracker` returns an error if
  `len(stakeVersions) == 0` ([tracker.go:136-138](../../../gov/agendas/tracker.go#L136-L138)), and
  `_main` treats that as fatal ([main.go:434-439](../../../cmd/dcrdata/main.go#L434-L439)). Since
  the explorer already starts on non-simnet, the tracker already initializes — re-enabling the
  page does not add a new startup risk.
- **Real Monetarium-specific dependency: node must expose consensus deployments + stake-version
  voting.** Verified present in `monetarium-node` chaincfg **v1.3.10**: mainnet defines **48**
  agenda IDs, testnet **52**, across vote versions; vote IDs include `VoteIDMaxBlockSize`,
  `VoteIDChangeSubsidySplit`, `VoteIDBlake3Pow`, `VoteIDChangeSubsidySplitR2`. RPC result types
  `GetVoteInfoResult`, `Agenda`, `Choice`, `GetStakeVersionsResult`,
  `GetStakeVersionInfoResult` all exist. So the data pipeline produces real data; agendas were
  **not** removed for lack of node support.

## Section 6 — Mutation Impact

**What re-enabling did (PR #395 — done):**

1. **Restored the two routes** at [main.go:785-786](../../../cmd/dcrdata/main.go#L785-L786):
   `withCache.Get("/agendas", explore.AgendasPage)` and
   `withCache.With(explorer.AgendaPathCtx).Get("/agenda/{agendaid}", explore.AgendaPage)`. Both
   handlers and `AgendaPathCtx`/`getAgendaIDCtx`
   ([explorermiddleware.go:228,276](../../../cmd/dcrdata/internal/explorer/explorermiddleware.go#L228))
   already existed and compiled.
2. **Re-added the navbar link** at
   [extras.tmpl:85](../../../cmd/dcrdata/views/extras.tmpl#L85) ("Agendas" `menu-item` →
   `/agendas`), so the page is reachable from the menu, not just by direct URL.
3. **Added a nil-summary guard**
   ([explorerroutes.go:2068-2072](../../../cmd/dcrdata/internal/explorer/explorerroutes.go#L2068-L2072),
   `43a27ce2`) for not-yet-started agendas (`AgendasVotesSummary` → `(nil, nil)`), with a
   regression test
   ([agendapage_test.go](../../../cmd/dcrdata/internal/explorer/agendapage_test.go), `f6ea9703`).
4. **No backend, API, template, or JS changes were needed** — they were intact.
5. **Docs reconciled** (this wiki update): the market-removal spec
   ([wiki/specs/market-removal/spec.md](../../specs/market-removal/spec.md)), the parameters spec
   ([wiki/specs/parameters/spec.md](../../specs/parameters/spec.md)), and the page registry
   ([wiki/core/pages.md](../../core/pages.md)) no longer list `/agendas` as disabled/removed;
   `/agendas` + `/agenda/{id}` are in the **Active pages** table.

**Direct deps to check when changing agenda data structures:** `AgendaTagged`,
`VoteSummary`/`AgendaSummary`, `dbtypes.MileStone`, `dbtypes.AgendaVoteChoices`,
`apitypes.AgendasInfo`/`AgendaAPIResponse`, the two templates, the two JS controllers, and the
`/api/agendas` + `/api/agenda/{id}` consumers.

**Silent failures:**
- **PRE-VOTING meters rendered for v10 on mainnet with no Monetarium agendas.** Removing the
  `.Agendas` condition from the `{{if}}` at
  [agendas.tmpl:105](../../../cmd/dcrdata/views/agendas.tmpl#L105) — reverting to
  `{{if or (not .NetworkUpgraded) .VotingTriggered}}` — re-enables v10 miner/voter progress
  meters on a mainnet page whose `AllAgendas()` table shows "No agendas found." No build error;
  inconsistent UI only. Added in commit `07f2d444`.
- **Decred artifacts resurface.** Reverting `AllAgendas` to a `q.True()` select, lowering
  `MinVoteVersion`, or scattering the literal `11` instead of the constant silently lets vote
  versions 1–10 reappear in the `/agendas` table and `/api/agendas` JSON. No error — just wrong
  rows. The regression tests in
  [deployments_test.go](../../../gov/agendas/deployments_test.go) pin the `>= 11` gate
  (`TestAllAgendasVoteVersionFilter` and the adapted `Test_AllAgendas`).
- **Decred agendas linger in the summary cards.** The version filter at `AllAgendas()` aligns the
  table + API but **not** the `/agendas` voting cards (`VoteSummary.Agendas`, tracker-sourced).
  `AgendasPage`'s cross-filter
  ([call explorerroutes.go:2174](../../../cmd/dcrdata/internal/explorer/explorerroutes.go#L2174),
  PR #401) closes this; remove it and the cards again show vote versions ≤ 10 while the table hides
  them — most visible when the node's highest vote version is still ≤ 10 (table empty, cards
  populated). The filter logic is the pure helper `filterAgendaSummaries`
  ([explorerroutes.go:2200-2208](../../../cmd/dcrdata/internal/explorer/explorerroutes.go#L2200-L2208)),
  unit-tested by `TestFilterAgendaSummaries`
  ([agendapage_test.go:78](../../../cmd/dcrdata/internal/explorer/agendapage_test.go#L78), 4 cases:
  keep/drop, empty input, empty allow-set, full pass-through). The handler *wiring* stays uncovered
  — `voteTracker` is a concrete `*agendas.VoteTracker`, not a stubbable interface — but the filter
  itself is now pinned (PR #401).
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
- `AllAgendas()` DB error → `ExpStatusError` page. **Note:** the *all-filtered* case (no agenda
  reaches `MinVoteVersion`) is **not** an error — `AllAgendas` maps storm's `ErrNotFound` to an
  empty slice + nil error so `/agendas` renders the *"No agendas found for {NetName}"* empty state
  ([agendas.tmpl:230](../../../cmd/dcrdata/views/agendas.tmpl#L230)) at HTTP 200. Letting
  `ErrNotFound` propagate instead would wrongly turn an empty list into an `ExpStatusError` page
  (and a 503 from `/api/agendas`).
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
- **Removing the not-yet-started nil-summary guard** — `AgendaPage` panics (HTTP 500) on any
  agenda whose `StartTime` is in the future; `AgendasVotesSummary` returns `(nil, nil)` there and
  the handler dereferences `summary`. The regression test in `agendapage_test.go` exists precisely
  to stop this from reappearing.
- **Loosening the `MinVoteVersion` gate** — replacing `q.Gte("VoteVersion", MinVoteVersion)` with
  `q.True()`, lowering the constant, or hard-coding `11` somewhere else silently brings back the
  Decred-era agendas (vote versions 1–10) that issue #400 hid. Keep the threshold in the one named
  constant in `gov/agendas`.
- **Mapping the all-filtered case to an error** — with a real matcher, `Find` returns
  `storm.ErrNotFound` when no agenda qualifies. That must become an empty slice + nil error, not a
  propagated error; otherwise the empty list turns into an error page instead of the empty state.
- **Filtering `AgendaInfo` too** — the version gate belongs to the *list* (`AllAgendas`) only.
  `AgendaInfo(id)` must stay unfiltered so a filtered agenda's `/agenda/{id}` page remains
  reachable by direct URL.
- **Filtering the list but not the cards** — the `/agendas` page renders agendas twice: the table
  (`AllAgendas`) and the live progress cards (`voteTracker.Summary().Agendas`, a different source).
  A list-level filter must be mirrored onto the cards in `AgendasPage` (cross-filter by ID on a
  *defensive copy* of the shared `tracker.summary`), or the two surfaces disagree.
- **Confusing the two `.Agendas` fields in `agendas.tmpl`.** Inside the `{{with .VotingSummary}}`
  block (lines 26–219), `.Agendas` is `VoteSummary.Agendas` — the tracker's `[]AgendaSummary`
  already cross-filtered by `filterAgendaSummaries`. **Outside** that block, `.Agendas` is the
  top-level `[]*agendas.AgendaTagged` from `AllAgendas()`. Both fields are named `Agendas` but
  carry different types from different sources; the PRE-VOTING guard at line 105 uses the
  tracker source, not `AllAgendas`.

## Section 8 — Evidence

- Live routes / re-enable: [main.go:785-786](../../../cmd/dcrdata/main.go#L785-L786)
  (`explore.AgendasPage`; `explorer.AgendaPathCtx`+`explore.AgendaPage`), enabled in PR #395
  `6622b4ae`; previously 410-stubbed in `52ea3cf1`.
- Handlers: `AgendasPage`
  [explorerroutes.go:2142-2194](../../../cmd/dcrdata/internal/explorer/explorerroutes.go#L2142-L2194),
  `AgendaPage` [explorerroutes.go:2047-2140](../../../cmd/dcrdata/internal/explorer/explorerroutes.go#L2047-L2140);
  nil-summary guard
  [explorerroutes.go:2068-2072](../../../cmd/dcrdata/internal/explorer/explorerroutes.go#L2068-L2072)
  (`43a27ce2`); regression test
  [agendapage_test.go](../../../cmd/dcrdata/internal/explorer/agendapage_test.go) (`f6ea9703`).
- Backend interface: `agendaBackend`
  [explorer.go:134-137](../../../cmd/dcrdata/internal/explorer/explorer.go#L134-L137); wiring
  [main.go:415-452](../../../cmd/dcrdata/main.go#L415-L452).
- Vote-version filter (issue #400): constant `MinVoteVersion`
  [deployments.go:53-57](../../../gov/agendas/deployments.go#L53-L57); `AllAgendas` select +
  `ErrNotFound`→empty handling
  [deployments.go:294-308](../../../gov/agendas/deployments.go#L294-L308); tests
  [deployments_test.go](../../../gov/agendas/deployments_test.go)
  (`TestAllAgendasVoteVersionFilter`, `Test_AllAgendas`); empty state
  [agendas.tmpl:230](../../../cmd/dcrdata/views/agendas.tmpl#L230).
- Summary-card cross-filter (PR #401): allowed-ID set
  [explorerroutes.go:2156-2158](../../../cmd/dcrdata/internal/explorer/explorerroutes.go#L2156-L2158),
  then pure helper `filterAgendaSummaries` applied to a defensive copy
  [explorerroutes.go:2174](../../../cmd/dcrdata/internal/explorer/explorerroutes.go#L2174),
  [func 2200-2208](../../../cmd/dcrdata/internal/explorer/explorerroutes.go#L2200-L2208); test
  `TestFilterAgendaSummaries` [agendapage_test.go:78](../../../cmd/dcrdata/internal/explorer/agendapage_test.go#L78);
  cards rendered at [agendas.tmpl:26-219](../../../cmd/dcrdata/views/agendas.tmpl#L26-L219);
  `AgendaSummary` (note: no `VoteVersion` field)
  [tracker.go:37-61](../../../gov/agendas/tracker.go#L37-L61); shared cached summary pointer
  [tracker.go:479-483](../../../gov/agendas/tracker.go#L479-L483).
- PRE-VOTING meters guard (commit `07f2d444`): condition at
  [agendas.tmpl:105](../../../cmd/dcrdata/views/agendas.tmpl#L105) —
  `{{if and (or (not .NetworkUpgraded) .VotingTriggered) .Agendas}}`; `.Agendas` here is
  `VoteSummary.Agendas` (inside `{{with .VotingSummary}}`), not the top-level `AgendaTagged` list.
- DB pipeline: `insertVotes` [queries.go:382](../../../db/dcrpg/queries.go#L382) +
  [queries.go:537-604](../../../db/dcrpg/queries.go#L537-L604); caller
  [pgblockchain.go:4426](../../../db/dcrpg/pgblockchain.go#L4426); milestones
  [pgblockchain.go:3149-3188](../../../db/dcrpg/pgblockchain.go#L3149-L3188);
  `SSGenVoteChoices` [txhelpers.go:1020](../../../txhelpers/txhelpers.go#L1020).
- API: [apirouter.go:211-218](../../../cmd/dcrdata/internal/api/apirouter.go#L211-L218),
  [apiroutes.go:2028-2100](../../../cmd/dcrdata/internal/api/apiroutes.go#L2028-L2100);
  types [apitypes.go:135-147](../../../api/types/apitypes.go#L135-L147).
- Templates: [agendas.tmpl](../../../cmd/dcrdata/views/agendas.tmpl),
  [agenda.tmpl](../../../cmd/dcrdata/views/agenda.tmpl); JS
  [agendas_controller.js](../../../cmd/dcrdata/public/js/controllers/agendas_controller.js),
  [agenda_controller.js](../../../cmd/dcrdata/public/js/controllers/agenda_controller.js),
  [charts/definitions/agenda.js](../../../cmd/dcrdata/public/js/charts/definitions/agenda.js)
  (`cumulativeVoteChoicesDef`, `voteChoicesByBlockDef`, `voteColumns`, `formatVote`).
- Node support: `monetarium-node/chaincfg@v1.3.10` `mainnetparams.go:148`/`testnetparams.go:147`
  `Deployments` maps; vote IDs at `mainnetparams.go:405-461`; RPC types
  `rpc/jsonrpc/types@v1.3.10/chainsvrresults.go:497-527` (`Choice`, `Agenda`,
  `GetVoteInfoResult`).
- Navbar ("Agendas" link, re-added in PR #395): [extras.tmpl:85](../../../cmd/dcrdata/views/extras.tmpl#L85).

See also:
- /wiki/code-analysis/agendas/flow.compact.md (derived-from: this file)
- /wiki/code-analysis/agendas/patterns.md (shares-pattern-with: dormant-feature stub, dual-source governance data, single-source list filter)
- /wiki/code-analysis/agendas/impact.md (depends-on: re-enable blast radius)
- /wiki/core/constraints.md (depends-on: C1 numeric precision — explicitly N/A for agendas; C3 parity — N/A, no WS path; C7 coin labels — N/A)
- /wiki/code-analysis/parameters/flow.full.md (shares-pattern-with: near-static chaincfg.Params + node-RPC page)
- /wiki/specs/market-removal/spec.md (reconciled: no longer lists /agendas as a disabled page)
