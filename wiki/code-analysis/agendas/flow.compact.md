# Agendas — Compact (LLM-Optimized)

**Flow:** node RPC (`GetVoteInfo` / `GetStakeVersion*` / `GetBlockChainInfo.Deployments`) →
`gov/agendas.AgendaDB` (BoltDB metadata cache) + `VoteTracker` (live RCI/SVI/quorum) **and**
`db/dcrpg` `agendas`/`agenda_votes` tables (historical tallies, written by `insertVotes` during
`StoreBlock` via `SSGenVoteChoices`) → `explorer.AgendasPage`/`AgendaPage` →
`agendas.tmpl`/`agenda.tmpl` → `agendas_controller.js` (meters) + `agenda_controller.js`
(Dygraphs ← `/api/agenda/{id}`).

**Current status:** HTML pages **dormant** — [main.go:780-785](../../../cmd/dcrdata/main.go#L780-L785)
returns HTTP 410. Handlers, JSON API (`/api/agendas`, `/api/agenda/{id}` — still live at
[apirouter.go:211-218](../../../cmd/dcrdata/internal/api/apirouter.go#L211-L218)), and full DB
pipeline are intact. Stubbed defensively in commit `52ea3cf1` alongside treasury/proposals — not
a real removal. Original wiring: `explore.AgendasPage` / `explore.AgendaPage` (+ `AgendaPathCtx`).

**Key architectural patterns:**
1. **Dormant-feature route stub** — handler + data pipeline live; only the HTTP route is a 410
   closure. Re-enable = revert 2 route lines + re-add navbar link.
2. **Dual-source governance data** — live metadata/progress from node RPC (BoltDB + in-mem
   tracker); historical per-block tallies from Postgres `agenda_votes`. `AgendaPage` joins them
   by string agenda ID + choice ID ("yes"/"no"/"abstain").
3. **Untyped Go→JS contracts** — meter `data-progress/threshold/approval` floats; chart JSON
   `by_time/by_height` with `yes/no/abstain/height/time` arrays.

**Critical constraints:**
- **No multi-coin / precision work needed.** Agendas carry **zero** VAR/SKA amounts — counts are
  `uint32`, rates `float32`, heights/quorum integers. C1 (precision), C3 (WS parity — no WS path),
  C7 (coin labels) all **N/A**. This is the answer to "adapt to the Monetarium model": don't.
- **Node must expose consensus deployments** — confirmed in `monetarium-node@v1.3.10` (mainnet 48
  / testnet 52 agenda IDs; `VoteIDMaxBlockSize`, `ChangeSubsidySplit`, `Blake3Pow`,
  `ChangeSubsidySplitR2`). Data is real.
- `VoteTracker` fatal on non-simnet if 0 stake versions (main.go:434); `nil` tracker (simnet) →
  "agendas disabled on simnet" status page.

**Mutation checklist (re-enable):**
- [ ] main.go:780-785 → `explore.AgendasPage` + `explorer.AgendaPathCtx`/`explore.AgendaPage`.
- [ ] extras.tmpl navbar → re-add "Agendas" → `/agendas` (else page is orphaned).
- [ ] No backend/API/template/JS edits required.
- [ ] Expect historical vote charts populated **forward** from sync; pre-sync completed votes
      need a genesis resync to backfill.
- [ ] Update market-removal spec (lists /agendas as removed).
- [ ] Verify on non-simnet (tracker non-nil); simnet shows the disabled status page by design.

See also:
- /wiki/code-analysis/agendas/flow.full.md (derived-from)
- /wiki/code-analysis/agendas/patterns.md
- /wiki/code-analysis/agendas/impact.md
- /wiki/core/constraints.md (C1/C3/C7 — N/A for agendas)
