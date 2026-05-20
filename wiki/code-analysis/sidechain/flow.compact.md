# Sidechain Page (`/side`) — Compact

```text
GET /side
→ explorer.SideChains
→ ChainDB.SideChainBlocks(ctx)               // queryTimeout-wrapped
→ retrieveSideChainBlocks                    // SELECT … FROM blocks JOIN block_chain
→ []*dbtypes.BlockStatus                     // 5 of 6 fields populated; IsMainchain unset
→ views/sidechains.tmpl                      // static HTML; no WS, no Stimulus

Writers that fill is_mainchain=false:
  (A) startup batch (cfg.ImportSideChains, off by default)
      → MissingSideChainBlocks → StoreBlock(isMainchain=false) → insertBlockPrevNext
  (B) live reorg
      → ChainMonitor.ReorgHandler → switchToSideChain → TipToSideChain
      → setMainchainByBlockHash(hash, false)
```

## Key Architectural Patterns

- **Read-only single-query page.** No real-time transport, no derived fields, no per-coin handling — the simplest page-rendering shape in the codebase.
- **Shared `BlockStatus` struct, 4 different column subsets.** `BlockStatus` is the return of `SelectSideChainBlocks`, `SelectBlockStatus`, `SelectBlockStatuses`, and `SelectDisapprovedBlocks`. Each Scan is *positional and column-narrow* — fields not selected stay at Go-zero.
- **Two independent writer paths.** Startup `ImportSideChains` (inserts new rows) vs live reorg `TipToSideChain` (mutates `is_mainchain` on existing rows). Reorg path skips `block_chain` row inserts.
- **`ImportSideChains=false` by default.** Empty page is the expected state on a fresh sync with no in-flight reorg — not a bug.

## Critical Constraints

- **C1 (precision) does NOT apply** — no amounts. Don't add amount columns without also adopting the SKA-string pipeline used in `address`/`block`/`charts`.
- **C8 (dual-transport) does NOT apply** — no WS path. Adding one re-imports C3/C8.
- **Positional Scan invariant applies.** SQL column order ↔ `rows.Scan` destination order ↔ `BlockStatus` field semantics must stay in lockstep across all 4 sibling queries.

## Mutation Checklist

- Reorder/add `BlockStatus` fields → re-check **all 4** `rows.Scan(&bs.…)` sites in `db/dcrpg/queries.go` and both templates (`sidechains.tmpl`, `disapproved.tmpl`).
- Change `SelectSideChainBlocks` column list → update `retrieveSideChainBlocks` Scan in lockstep.
- Don't read `bs.IsMainchain` from a `SideChainBlocks` result — it is never populated by this query.
- Adding a real-time element → design a WS payload + clone-template flow (C3/C6/C8) before writing JS.
- New "tx count by coin" / "value" columns → build a separate row type; do not extend `BlockStatus`.

## Silent Risks

- Column-order swap (SELECT vs Scan) within compatible types (`bool` ↔ `bool`, hash ↔ hash) — page renders wrong values without error.
- Reorg mid-request — row briefly appears with stale `is_mainchain` semantics; cosmetic.
- `ImportSideChains=false` operator default — page silently empty even when node knows of side chains.

## Loud Failures

- Adding/removing a SELECT column without matching Scan → `sql.Rows.Scan: expected N destinations`.
- Renaming a struct field referenced by the template → `template execute` error rendered as `StatusPage`.
- DB query timeout → `timeoutErrorPage` path.
