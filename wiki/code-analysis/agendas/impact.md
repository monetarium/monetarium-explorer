# Agendas — Mutation Impact / Blast Radius

Primary scenario: **re-enabling** `/agendas` and `/agenda/{id}`. Secondary: changing agenda data
structures.

## Risk: Orphaned page (route re-enabled, nav not)
- **Trigger:** restore the handlers at [main.go:780-785](../../../cmd/dcrdata/main.go#L780-L785)
  but leave the navbar unchanged.
- **Affected:** [extras.tmpl:79-87](../../../cmd/dcrdata/views/extras.tmpl#L79-L87) (no Agendas
  `menu-item`).
- **Failure mode:** silent. Page returns 200 but is reachable only by direct URL or via the
  vote-tx link in [tx.tmpl:593](../../../cmd/dcrdata/views/tx.tmpl#L593).
- **Fix:** add an "Agendas" menu item → `/agendas`.

## Risk: Empty historical vote charts
- **Trigger:** re-enable `/agenda/{id}` on a DB that synced *after* an agenda's votes were cast,
  or for a vote version with no deployments (`SSGenVoteChoices` returns `[]`).
- **Affected:** `agenda_votes` table; `AgendaVotes`
  ([pgblockchain.go:1588](../../../db/dcrpg/pgblockchain.go#L1588)); `/api/agenda/{id}`;
  `agenda_controller.js` (falls back to `[[0,0,0,0]]`).
- **Failure mode:** silent — charts render blank, page is otherwise correct.
- **Fix / note:** `agenda_votes` is populated **forward** during sync via `insertVotes`
  ([queries.go:382](../../../db/dcrpg/queries.go#L382), called at
  [pgblockchain.go:4340](../../../db/dcrpg/pgblockchain.go#L4340)). Backfilling completed
  pre-sync votes requires a resync from genesis. The choice *table* on the page (counts via
  `AgendasVotesSummary`) shares the same data source, so it is subject to the same gap.

## Risk: VoteTracker startup dependency (non-simnet)
- **Trigger:** running on a network whose node reports **zero** stake versions.
- **Affected:** `NewVoteTracker` ([tracker.go:131-138](../../../gov/agendas/tracker.go#L131-L138));
  fatal at [main.go:434-439](../../../cmd/dcrdata/main.go#L434-L439).
- **Failure mode:** hard — explorer fails to start. **Pre-existing**, unchanged by re-enabling
  the page; if the explorer already runs on the target net, the tracker already initializes.
- **Simnet:** `voteTracker == nil` → `AgendasPage` returns the "agendas disabled on simnet"
  status page by design ([explorerroutes.go:2067-2071](../../../cmd/dcrdata/internal/explorer/explorerroutes.go#L2067-L2071)).

## Risk: Choice-ID / JSON-tag drift
- **Trigger:** rename a vote choice ID or a `dbtypes.AgendaVoteChoices` JSON tag.
- **Affected:** the lower-cased switch at
  [explorerroutes.go:2003-2011](../../../cmd/dcrdata/internal/explorer/explorerroutes.go#L2003-L2011)
  (`"abstain"/"yes"/"no"`); `agenda_controller.js` keys (`d.yes/d.abstain/d.no/d.time/d.height`);
  meter `data-*` attrs in `agendas.tmpl`.
- **Failure mode:** silent — counts mis-mapped or charts blank; no build/test error
  (Go↔JS boundary is untyped).
- **Fix:** change both ends together; treat the JSON shape as a contract.

## Risk: Milestone unavailability
- **Trigger:** `GetBlockChainInfo` stops returning a deployment whose `agenda_votes` rows exist.
- **Affected:** `ChainInfo().AgendaMileStones[id]` lookups in `AgendaVotes`/`AgendasVotesSummary`/
  `AgendaVoteCounts` ([pgblockchain.go:1593,1612,1635](../../../db/dcrpg/pgblockchain.go#L1593));
  also the consensus-gating helpers `IsDCP0010/0011/0012Active`
  ([pgblockchain.go:5064-5152](../../../db/dcrpg/pgblockchain.go#L5064-L5152)).
- **Failure mode:** silent for the UI (empty/zero); potentially behavioral for subsidy/blake3pow
  gating (separate concern, not touched by re-enabling).

## Doc reconciliation
- [wiki/specs/market-removal/spec.md](../../specs/market-removal/spec.md) and
  [wiki/index.md:32](../../index.md) currently classify `/agendas` as "made unavailable (like
  `/treasury`, `/proposals`)". Re-enabling contradicts that; update the note so the corpus does
  not claim agendas is removed.

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
- /wiki/specs/market-removal/spec.md (contradicts: agendas listed as removed)
