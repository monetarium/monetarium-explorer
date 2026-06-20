# Agendas — Patterns

## Dormant-Feature Route Stub (handler + pipeline retained)
A page is "disabled" by replacing **only its HTTP route** with a closure returning
`http.StatusGone`, while the handler, data sources, JSON API, templates, and JS controllers stay
compiled and functional.

- **Where (still stubbed):** `/treasury`, `/treasurytable`, `/proposals`, `/market` in
  [main.go](../../../cmd/dcrdata/main.go) (the `withCache` group, ~lines 770-810). All were stubbed
  in commit `52ea3cf1` (`/market` later).
- **Re-enable cost:** revert the route line(s) back to the real handler and re-add the navbar link.
  No backend work. **Agendas was the worked example** — re-enabled in **PR #395** (`6622b4ae`) by
  restoring `explore.AgendasPage` / `explorer.AgendaPathCtx`+`explore.AgendaPage` at
  [main.go:780-781](../../../cmd/dcrdata/main.go#L780-L781) and the navbar link at
  [extras.tmpl:84](../../../cmd/dcrdata/views/extras.tmpl#L84). One latent bug surfaced on
  re-enable — a nil DB summary for a not-yet-started agenda; see
  [impact.md](impact.md#risk-not-yet-started-agenda-nil-summary-panic).
- **Caveat — distinguish dormant from removed.** Treasury/market are *genuine* Monetarium
  removals (no node support / feature dropped). Agendas was **dormant-but-wired** (node support +
  live `agenda_votes` pipeline), which is exactly why re-enabling it was a two-line route change.
  Don't lump dormant-but-wired pages together with genuine removals when reasoning about deletion
  vs. re-enabling.
- **Constraint:** when stubbing/unstubbing, keep the route table and the navbar
  ([extras.tmpl](../../../cmd/dcrdata/views/extras.tmpl)) in sync — a re-enabled route with no nav
  link is an orphaned page; a removed route with a live nav link is a dead link.

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
  [explorerroutes.go:2079-2087](../../../cmd/dcrdata/internal/explorer/explorerroutes.go#L2079-L2087).
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

## Single-Source List Filter (one gate, multiple read surfaces)
When an HTML page and a JSON API render the *same list* from one backend accessor, apply
visibility/eligibility filtering **at that shared accessor** so every surface fed by it stays
consistent. **The guarantee only covers surfaces that read from that accessor** — a sibling
rendering on the same page sourced from somewhere else will silently drift and has to be aligned
separately (see the summary-cards caveat below). This page is the cautionary example: filtering
`AllAgendas()` fixed the table + API, but the `/agendas` voting cards come from a *different*
source and needed their own filter.

- **Where:** `gov/agendas.AgendaDB.AllAgendas()`
  ([deployments.go:294-308](../../../gov/agendas/deployments.go#L294-L308)) drops pre-Monetarium
  agendas with `q.Gte("VoteVersion", MinVoteVersion)` (constant `MinVoteVersion = 11`,
  [deployments.go:57](../../../gov/agendas/deployments.go#L57)). The one accessor feeds the
  `/agendas` table (`AgendasPage`,
  [explorerroutes.go:2149](../../../cmd/dcrdata/internal/explorer/explorerroutes.go#L2149)) **and**
  the `/api/agendas` JSON (`getAgendasData`,
  [apiroutes.go:2070](../../../cmd/dcrdata/internal/api/apiroutes.go#L2070)). Introduced for
  issue #400.
- **Single-row lookups stay unfiltered.** The companion accessor `AgendaInfo(id)`
  ([deployments.go:270](../../../gov/agendas/deployments.go#L270)) is *not* filtered: the list gate
  must not leak into direct-ID access, so a hidden item's detail page (`/agenda/{id}`) is still
  reachable by URL.
- **Sibling surface from a different source needs its own filter (the drift caveat).** The
  `/agendas` page also renders live progress *cards* from `voteTracker.Summary().Agendas`
  ([agendas.tmpl:26-219](../../../cmd/dcrdata/views/agendas.tmpl#L26-L219)) — these do **not** come
  from `AllAgendas()`. Filtering only the accessor left those cards still showing Decred-era
  agendas, so `AgendasPage` cross-filters them against the `AllAgendas()` ID set via the pure helper
  `filterAgendaSummaries`
  ([explorerroutes.go:2200-2208](../../../cmd/dcrdata/internal/explorer/explorerroutes.go#L2200-L2208),
  tested by `TestFilterAgendaSummaries`; PR #401). Match by **ID** — `AgendaSummary` has no
  `VoteVersion` — on a **defensive copy** of the shared, mutex-guarded `tracker.summary` (must not
  mutate tracker state). Extracting the filter as a pure function is what makes it unit-testable; the
  handler itself isn't (its `voteTracker` is a concrete type).
- **Constraints:**
  - The threshold is **one named constant** in the owning package — no bare literals, no re-deriving
    the threshold in handlers. (Re-*projecting* the already-filtered ID set onto a sibling surface
    that has a different source — as the summary cards do — is a separate, legitimate need, not a
    duplicate of the source-level filter.)
  - A real matcher makes empty results a first-class case: storm's `Find` returns
    `storm.ErrNotFound` when nothing matches; map it to an **empty slice + nil error** so callers
    render their empty state, not an error page. (Both agenda handlers treat any returned error as
    a hard failure.)

See also:
- /wiki/code-analysis/agendas/flow.full.md (derived-from)
- /wiki/code-analysis/agendas/impact.md (shares-pattern-with: dormant-feature stub)
- /wiki/code-analysis/parameters/patterns.md (shares-pattern-with: near-static chaincfg.Params + node-RPC page)
- /wiki/core/constraints.md (depends-on: C1/C3/C7 marked N/A for agendas)
