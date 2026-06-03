# Agendas — Patterns

## Dormant-Feature Route Stub (handler + pipeline retained)
A page is "disabled" by replacing **only its HTTP route** with a closure returning
`http.StatusGone`, while the handler, data sources, JSON API, templates, and JS controllers stay
compiled and functional.

- **Where:** [main.go:780-785](../../../cmd/dcrdata/main.go#L780-L785) (agendas); the same edit
  (commit `52ea3cf1`) stubbed `/treasury`, `/treasurytable`, `/proposals`; `/market` later.
- **Re-enable cost:** revert the route line(s) back to the real handler (e.g.
  `explore.AgendasPage`, `explorer.AgendaPathCtx` + `explore.AgendaPage`) and re-add the navbar
  link. No backend work.
- **Caveat — distinguish dormant from removed.** Treasury/market are *genuine* Monetarium
  removals (no node support / feature dropped). **Agendas is dormant-but-wired**: the node
  fully supports it and the DB pipeline keeps populating `agenda_votes`. Don't lump them
  together when reasoning about deletion.
- **Constraint:** when stubbing/unstubbing, keep the route table and the navbar
  ([extras.tmpl:79-87](../../../cmd/dcrdata/views/extras.tmpl#L79-L87)) in sync — a re-enabled
  route with no nav link is an orphaned page; a removed route with a live nav link is a dead link.

## Dual-Source Governance Data (RPC-live + Postgres-historical)
Agenda pages compose two independent origins for the same logical entity:

- **Live metadata + progress** — node RPC cached in `gov/agendas.AgendaDB` (BoltDB/storm,
  `AgendaTagged`) and computed in-memory by `VoteTracker` (`VoteSummary`/`AgendaSummary`),
  refreshed at startup and **every 5 blocks**
  ([explorer.go:892-894](../../../cmd/dcrdata/internal/explorer/explorer.go#L892-L894)).
- **Historical tallies** — Postgres `agenda_votes`, written during `StoreBlock` by `insertVotes`
  ([queries.go:382](../../../db/dcrpg/queries.go#L382)) using `txhelpers.SSGenVoteChoices` on each
  vote tx; milestones rebuilt from `GetBlockChainInfo.Deployments`
  ([pgblockchain.go:3118-3157](../../../db/dcrpg/pgblockchain.go#L3118-L3157)).
- **Join key:** string agenda `ID` + lower-cased choice ID (`"yes"`/`"no"`/`"abstain"`) at
  [explorerroutes.go:2003-2011](../../../cmd/dcrdata/internal/explorer/explorerroutes.go#L2003-L2011).
- **Constraint:** the live source determines *which agendas exist*; the Postgres source supplies
  *how votes were cast over time*. The two can disagree (a deployment dropped from
  `GetBlockChainInfo` orphans its still-present `agenda_votes` rows). Historical data is only as
  complete as the forward sync that produced it — no automatic backfill of pre-sync votes.

## Coin-Agnostic Feature (precision rules do not apply)
Some explorer features carry **no monetary values** and are therefore exempt from the multi-coin
precision pipeline. Agendas is the canonical example: every value is a vote `uint32`, a `float32`
percentage, a block height, a status, or a timestamp.

- **Where:** [agendas.tmpl](../../../cmd/dcrdata/views/agendas.tmpl),
  [agenda.tmpl](../../../cmd/dcrdata/views/agenda.tmpl) — no `.ToCoin()`, no atom strings, no
  coin-type label helper.
- **Constraint:** do **not** introduce VAR/SKA maps, `float64` coin conversion, or `big.Int`
  string handling into this flow. C1/C3/C7 of [/wiki/core/constraints.md](../../core/constraints.md)
  are intentionally not in scope here. The relevant invariant instead is **node capability**:
  the data only exists if the node exposes consensus deployments + stake-version voting.

See also:
- /wiki/code-analysis/agendas/flow.full.md (derived-from)
- /wiki/code-analysis/agendas/impact.md (shares-pattern-with: dormant-feature stub)
- /wiki/code-analysis/parameters/patterns.md (shares-pattern-with: near-static chaincfg.Params + node-RPC page)
- /wiki/core/constraints.md (depends-on: C1/C3/C7 marked N/A for agendas)
