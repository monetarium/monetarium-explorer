# Agendas — Mutation Impact / Blast Radius

The pages are **live** (enabled in PR #395). Primary scenario now: **maintaining** `/agendas` /
`/agenda/{id}` and changing agenda data structures without regressing them. The historical
"re-enable" risks are kept below because they are the failure modes you can still hit when editing
these pages.

## Risk: Orphaned page / dead link (route ↔ nav drift)
- **Status:** currently in sync — routes at
  [main.go:785-786](../../../cmd/dcrdata/main.go#L785-L786) and the "Agendas" navbar item at
  [extras.tmpl:85](../../../cmd/dcrdata/views/extras.tmpl#L85) (both added in PR #395).
- **Trigger:** remove one without the other — drop the navbar item and the page is reachable only
  by direct URL or the vote-tx link in [tx.tmpl:593](../../../cmd/dcrdata/views/tx.tmpl#L593); drop
  the route and the navbar item becomes a dead 404/410 link.
- **Failure mode:** silent (orphaned) or loud-on-click (dead link).
- **Fix:** keep the route table and the navbar in sync.

## Risk: Not-yet-started agenda nil summary (panic)
- **Trigger:** visit `/agenda/{id}` for a deployment whose `StartTime` is still in the future, or
  remove the nil-summary guard at
  [explorerroutes.go:2068-2072](../../../cmd/dcrdata/internal/explorer/explorerroutes.go#L2068-L2072).
- **Affected:** `ChainDB.AgendasVotesSummary` returns `(nil, nil)` for a future-`StartTime` agenda;
  `AgendaPage` then dereferences `summary.Abstain/Yes/No` (choice override) and `summary.LockedIn`
  (time-left).
- **Failure mode:** hard — nil-pointer panic, surfaced as HTTP 500 via `middleware.Recoverer`.
- **Fix / status:** PR #395 (`43a27ce2`) substitutes a zero-tally `&dbtypes.AgendaSummary{}` when
  `summary == nil`; pinned by
  [agendapage_test.go](../../../cmd/dcrdata/internal/explorer/agendapage_test.go) (`f6ea9703`).
  **Do not remove the guard** — it is the only thing between a freshly-defined agenda and a 500.

## Risk: PRE-VOTING meters rendered for Decred-era vote version
- **Trigger:** remove or weaken the `.Agendas` guard from the PRE-VOTING `{{if}}` at
  [agendas.tmpl:105](../../../cmd/dcrdata/views/agendas.tmpl#L105) — reverts from
  `{{if and (or (not .NetworkUpgraded) .VotingTriggered) .Agendas}}` back to
  `{{if or (not .NetworkUpgraded) .VotingTriggered}}`.
- **Context:** inside the `{{with .VotingSummary}}` block, `.Agendas` is `VoteSummary.Agendas`
  (the tracker's `[]AgendaSummary`), already cross-filtered by `filterAgendaSummaries`. On mainnet
  with no VoteVersion ≥ 11 agendas, that slice is empty after filtering — the meters should be
  hidden. Without the guard, `.NetworkUpgraded`/`.VotingTriggered` from the v10 tracker state
  could still be true, so v10 Miners/Voters progress meters appear while the table shows the
  "No agendas found" empty state.
- **Affected:** the v{{.Version}} Miners + Voters progress meter `<div>`s in the PRE-VOTING
  section of the `/agendas` page.
- **Failure mode:** silent — inconsistent UI (meters show while table shows empty state), no
  build/test error.
- **Added:** commit `07f2d444`.

## Risk: Empty historical vote charts
- **Trigger:** open `/agenda/{id}` on a DB that synced *after* an agenda's votes were cast,
  or for a vote version with no deployments (`SSGenVoteChoices` returns `[]`).
- **Affected:** `agenda_votes` table; `AgendaVotes`
  ([pgblockchain.go:1619](../../../db/dcrpg/pgblockchain.go#L1619)); `/api/agenda/{id}`;
  `agenda_controller.js` (falls back to `[[0,0,0,0]]`).
- **Failure mode:** silent — charts render blank, page is otherwise correct.
- **Fix / note:** `agenda_votes` is populated **forward** during sync via `insertVotes`
  ([queries.go:382](../../../db/dcrpg/queries.go#L382), called at
  [pgblockchain.go:4426](../../../db/dcrpg/pgblockchain.go#L4426)). Backfilling completed
  pre-sync votes requires a resync from genesis. The choice *table* on the page (counts via
  `AgendasVotesSummary`) shares the same data source, so it is subject to the same gap.

## Risk: VoteTracker startup dependency (non-simnet)
- **Trigger:** running on a network whose node reports **zero** stake versions.
- **Affected:** `NewVoteTracker` ([tracker.go:131-138](../../../gov/agendas/tracker.go#L131-L138));
  fatal at [main.go:434-439](../../../cmd/dcrdata/main.go#L434-L439).
- **Failure mode:** hard — explorer fails to start. **Pre-existing**, unchanged by re-enabling
  the page; if the explorer already runs on the target net, the tracker already initializes.
- **Simnet:** `voteTracker == nil` → `AgendasPage` returns the "agendas disabled on simnet"
  status page by design ([explorerroutes.go:2143-2147](../../../cmd/dcrdata/internal/explorer/explorerroutes.go#L2143-L2147)).

## Risk: Choice-ID / JSON-tag drift
- **Trigger:** rename a vote choice ID or a `dbtypes.AgendaVoteChoices` JSON tag.
- **Affected:** (1) the lower-cased switch at
  [explorerroutes.go:2079-2087](../../../cmd/dcrdata/internal/explorer/explorerroutes.go#L2079-L2087)
  (`"abstain"/"yes"/"no"`) — Go handler side; (2) `VOTE_SERIES[].field` and `voteColumns()`
  in
  [charts/definitions/agenda.js](../../../cmd/dcrdata/public/js/charts/definitions/agenda.js)
  (`r.yes`, `r.abstain`, `r.no`, `raw.time`, `raw.height`) — JS consumer side; (3) meter
  `data-*` attrs in `agendas.tmpl` (for the progress meters, separate path).
  Note: the key consumption moved from inline controller code to the definitions file in the
  Dygraphs → ChartPanel migration; `agenda_controller.js` itself no longer touches the raw
  payload keys.
- **Failure mode:** silent — counts mis-mapped or charts blank; no build/test error
  (Go↔JS boundary is untyped).
- **Fix:** change both ends together — Go JSON tags in `dbtypes.AgendaVoteChoices` and
  `VOTE_SERIES[].field` + `voteColumns()` in `charts/definitions/agenda.js`; treat the JSON
  shape as a contract.

## Risk: Milestone unavailability
- **Trigger:** `GetBlockChainInfo` stops returning a deployment whose `agenda_votes` rows exist.
- **Affected:** `ChainInfo().AgendaMileStones[id]` lookups in `AgendaVotes`/`AgendasVotesSummary`/
  `AgendaVoteCounts` ([pgblockchain.go:1624,1643,1666](../../../db/dcrpg/pgblockchain.go#L1624));
  also the consensus-gating helpers `IsDCP0010/0011/0012Active`
  ([pgblockchain.go:5170-5235](../../../db/dcrpg/pgblockchain.go#L5170-L5235)).
- **Failure mode:** silent for the UI (empty/zero); potentially behavioral for subsidy/blake3pow
  gating (separate concern, not touched by re-enabling).

## Risk: Pre-Monetarium agendas resurface / empty-state regression (vote-version filter)
- **Status:** `AllAgendas` filters to vote version `>= MinVoteVersion` (constant `= 11`)
  ([deployments.go:57,294-308](../../../gov/agendas/deployments.go#L294-L308)), hiding Decred-era
  agendas (versions 1–10) from the `/agendas` table and `/api/agendas` JSON. Added for issue #400;
  pinned by [deployments_test.go](../../../gov/agendas/deployments_test.go)
  (`TestAllAgendasVoteVersionFilter`, `Test_AllAgendas`).
- **Trigger (silent):** revert the select to `q.True()`, lower `MinVoteVersion`, or hard-code the
  literal `11` elsewhere → versions 1–10 reappear in both list surfaces. No error, just wrong rows.
- **Trigger (loud):** let `AllAgendas` propagate storm's `ErrNotFound` (returned when *no* agenda
  reaches the threshold) instead of mapping it to an empty slice + nil error. Both `AgendasPage`
  ([explorerroutes.go:2149-2153](../../../cmd/dcrdata/internal/explorer/explorerroutes.go#L2149-L2153))
  and `getAgendasData`
  ([apiroutes.go:2070-2074](../../../cmd/dcrdata/internal/api/apiroutes.go#L2070-L2074)) treat any
  returned error as a hard failure → `ExpStatusError` page / HTTP 503 instead of the
  *"No agendas found"* empty state ([agendas.tmpl:230](../../../cmd/dcrdata/views/agendas.tmpl#L230), HTTP 200).
- **Out of scope:** the gate is list-only. `AgendaInfo(id)` stays unfiltered, so `/agenda/{id}` for
  a hidden version is still reachable by direct URL — do not "fix" that by filtering the single-ID
  lookup.
- **Failure mode:** silent (wrong rows) for the first trigger; hard (error page) for the second.
- **Fix:** keep the single named constant, the `q.Gte` matcher, and the `ErrNotFound`→empty mapping
  together; assert all three in `deployments_test.go`.

## Risk: Summary cards drift from the filtered list (`/agendas` two-render gap)
- **Status:** `AgendasPage` cross-filters `VoteSummary.Agendas` against the `AllAgendas` ID set
  via the pure helper `filterAgendaSummaries`
  ([call explorerroutes.go:2174](../../../cmd/dcrdata/internal/explorer/explorerroutes.go#L2174),
  [func 2200-2208](../../../cmd/dcrdata/internal/explorer/explorerroutes.go#L2200-L2208), PR #401) so
  the live progress cards match the version-filtered table.
- **Why it exists:** the `/agendas` page renders agendas from **two** sources — the table from
  `AllAgendas()` (version-filtered) and the live cards from `voteTracker.Summary().Agendas` (the
  highest vote version's agendas, **not** filtered at the source). Filtering only `AllAgendas()`
  (issue #400) left the cards still showing Decred-era agendas; this is the gap PR #400 shipped with
  and PR #401 closed.
- **Trigger:** drop the cross-filter, or change `AllAgendas()` filtering without mirroring it onto
  the cards → cards and table disagree. Most visible when the node's highest vote version is still
  ≤ 10: the table renders *"No agendas found"* while the cards still show v≤10 agendas.
- **Two correctness points in the cross-filter:** (1) match by **ID** — `AgendaSummary` has no
  `VoteVersion` field ([tracker.go:37-61](../../../gov/agendas/tracker.go#L37-L61)); (2) filter a
  **defensive copy** — `Summary()` returns the shared, mutex-guarded `tracker.summary`
  ([tracker.go:479-483](../../../gov/agendas/tracker.go#L479-L483)), so reassigning `.Agendas` in
  place would corrupt tracker state across requests / race the template read.
- **Coverage:** the filter is extracted into the pure helper `filterAgendaSummaries`
  ([explorerroutes.go:2200-2208](../../../cmd/dcrdata/internal/explorer/explorerroutes.go#L2200-L2208))
  and unit-tested by `TestFilterAgendaSummaries`
  ([agendapage_test.go:78](../../../cmd/dcrdata/internal/explorer/agendapage_test.go#L78), 4 cases).
  The handler wiring stays uncovered (`voteTracker` is a concrete `*agendas.VoteTracker`, not
  stubbable), but the filter behavior is pinned.
- **Failure mode:** silent — inconsistent UI, no error.

## Doc reconciliation (done in this update)
- [wiki/specs/market-removal/spec.md](../../specs/market-removal/spec.md),
  [wiki/specs/parameters/spec.md](../../specs/parameters/spec.md), and
  [core/pages.md](../../core/pages.md) previously classified `/agendas` as disabled / "made
  unavailable". They were updated alongside PR #395 so the corpus no longer claims agendas is
  removed; `/agendas` + `/agenda/{id}` now live in the **Active pages** table of `core/pages.md`.

## What is NOT at risk
- **No multi-coin / precision blast radius.** Agendas carry no VAR/SKA amounts; re-enabling
  introduces zero exposure to the SKA-through-float64 class of bugs. Do not add coin-type
  handling here.
- **No WebSocket parity surface.** Agendas has no push path, so the live-overwrites-static class
  (C3) does not apply.

See also:
- /wiki/code-analysis/agendas/flow.full.md (depends-on: full trace)
- /wiki/code-analysis/agendas/patterns.md (shares-pattern-with: dormant-feature stub)
- /wiki/core/constraints.md (depends-on: C1/C3/C7 — explicitly N/A for agendas)
- /wiki/specs/market-removal/spec.md (reconciled: agendas no longer listed as disabled)
