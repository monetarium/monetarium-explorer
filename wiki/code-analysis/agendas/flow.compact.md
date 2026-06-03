# Agendas — Compact (LLM-Optimized)

**Flow:** node RPC (`GetVoteInfo` / `GetStakeVersion*` / `GetBlockChainInfo.Deployments`) →
`gov/agendas.AgendaDB` (BoltDB metadata cache) + `VoteTracker` (live RCI/SVI/quorum) **and**
`db/dcrpg` `agendas`/`agenda_votes` tables (historical tallies, written by `insertVotes` during
`StoreBlock` via `SSGenVoteChoices`) → `explorer.AgendasPage`/`AgendaPage` →
`agendas.tmpl`/`agenda.tmpl` → `agendas_controller.js` (meters) + `agenda_controller.js`
(Dygraphs ← `/api/agenda/{id}`).

**Current status: LIVE** — enabled in **PR #395** (commit `6622b4ae`). Both HTML routes call the
real handlers at [main.go:780-781](../../../cmd/dcrdata/main.go#L780-L781) (`explore.AgendasPage`;
`explorer.AgendaPathCtx`+`explore.AgendaPage`); the "Agendas" navbar link is present at
[extras.tmpl:84](../../../cmd/dcrdata/views/extras.tmpl#L84). The JSON API (`/api/agendas`,
`/api/agenda/{id}`) and DB pipeline were always intact. (History: route-stubbed to HTTP 410 in
`52ea3cf1` alongside treasury/proposals — a defensive migration stub, never a removal — re-enabled
by reverting those two route lines + re-adding the link.)

**Key architectural patterns:**
1. **Dual-source governance data** — live metadata/progress from node RPC (BoltDB + in-mem
   tracker); historical per-block tallies from Postgres `agenda_votes`. `AgendaPage` joins them
   by string agenda ID + choice ID ("yes"/"no"/"abstain").
2. **Untyped Go→JS contracts** — meter `data-progress/threshold/approval` floats; chart JSON
   `by_time/by_height` with `yes/no/abstain/height/time` arrays.
3. **Dormant-feature route stub** — agendas was the worked re-enable case for this pattern; the
   pattern still describes the remaining 410-stubbed pages (treasury/proposals/market).

**Critical constraints:**
- **No multi-coin / precision work needed.** Agendas carry **zero** VAR/SKA amounts — counts are
  `uint32`, rates `float32`, heights/quorum integers. C1 (precision), C3 (WS parity — no WS path),
  C7 (coin labels) all **N/A**. This is the answer to "adapt to the Monetarium model": don't.
- **List hides pre-Monetarium vote versions (`MinVoteVersion = 11`).** `AllAgendas`
  ([deployments.go:294](../../../gov/agendas/deployments.go#L294)) selects
  `q.Gte("VoteVersion", MinVoteVersion)`; versions 1–10 are Decred-network artifacts and never
  appear in the `/agendas` table or `/api/agendas` JSON (one shared source feeds both). The
  all-filtered case maps storm's `ErrNotFound` → empty slice + nil error (renders the empty state,
  not an error). `AgendaInfo(id)` is **unfiltered** — `/agenda/{id}` stays reachable by URL.
  Threshold is one named constant; no coin-type handling. (issue #400)
- **Not-yet-started agenda → nil DB summary (guarded).** `ChainDB.AgendasVotesSummary` returns
  `(nil, nil)` for an agenda whose deployment `StartTime` is in the future. `AgendaPage`
  substitutes a zero-tally `&dbtypes.AgendaSummary{}`
  ([explorerroutes.go:1998-2003](../../../cmd/dcrdata/internal/explorer/explorerroutes.go#L1998-L2003),
  PR #395 `43a27ce2`) before dereferencing `summary.Abstain/Yes/No` and `summary.LockedIn`.
  Removing that guard re-introduces a nil-pointer panic (HTTP 500). Regression test:
  [agendapage_test.go](../../../cmd/dcrdata/internal/explorer/agendapage_test.go).
- **Node must expose consensus deployments** — confirmed in `monetarium-node@v1.3.10` (mainnet 48
  / testnet 52 agenda IDs; `VoteIDMaxBlockSize`, `ChangeSubsidySplit`, `Blake3Pow`,
  `ChangeSubsidySplitR2`). Data is real.
- `VoteTracker` fatal on non-simnet if 0 stake versions (main.go:434); `nil` tracker (simnet) →
  "agendas disabled on simnet" status page
  ([explorerroutes.go:2073-2077](../../../cmd/dcrdata/internal/explorer/explorerroutes.go#L2073-L2077)).

**Mutation checklist (maintaining the live pages):**
- [ ] Don't remove the `summary == nil` guard
      ([explorerroutes.go:1998](../../../cmd/dcrdata/internal/explorer/explorerroutes.go#L1998)) —
      `/agenda/{id}` panics on a not-yet-started agenda without it.
- [ ] Keep the route table ([main.go:780-781](../../../cmd/dcrdata/main.go#L780-L781)) and the
      navbar link ([extras.tmpl:84](../../../cmd/dcrdata/views/extras.tmpl#L84)) in sync — drop one
      and the page is orphaned / the link is dead.
- [ ] Choice IDs ("yes"/"no"/"abstain") and `AgendaVoteChoices` JSON tags are an untyped Go↔JS
      contract — change both ends together or counts mis-map / charts blank.
- [ ] Historical vote charts populate **forward** from sync; pre-sync completed votes need a
      genesis resync to backfill.
- [ ] No multi-coin / precision handling — do not introduce VAR/SKA maps or float coin conversion.
- [ ] Verify on non-simnet (tracker non-nil); simnet shows the disabled status page by design.

See also:
- /wiki/code-analysis/agendas/flow.full.md (derived-from)
- /wiki/code-analysis/agendas/patterns.md
- /wiki/code-analysis/agendas/impact.md
- /wiki/core/constraints.md (C1/C3/C7 — N/A for agendas)
