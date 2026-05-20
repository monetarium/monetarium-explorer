# Disapproved Blocks (`/disapproved`) — Mutation Impact

Blast radius for changes touching the `/disapproved` page, its SQL, its shared struct, or its writer cascade. Read alongside [flow.full.md](flow.full.md) — this file is the change-checklist; the flow is the trace.

## Quick-glance table

| Change site | Direct break | Silent / Loud | Notes |
|---|---|---|---|
| `BlockStatus` struct field order/type | 4 `rows.Scan`s + 2 templates | Silent if types stay compatible, Loud if count changes | Shared with `/side`, `/block/{hash}`, height-keyed status |
| `SelectDisapprovedBlocks` columns | `retrieveDisapprovedBlocks` Scan | Loud (count mismatch) or Silent (order swap) | One-line edit risk |
| `retrieveDisapprovedBlocks` Scan order | Template column meanings | Silent | Render swaps without error |
| Add `{{.IsValid}}` to template | Renders `false` everywhere | Silent | `IsValid` is Scan-default in this path |
| `updateLastBlock` vote-bit logic | The whole page | Silent (no rows) | Sole writer of `blocks.is_valid=false` |
| `UpdateLastBlockValid` SQL | Same | Loud (SQL error) | Renaming column breaks both SELECTs too |
| `disapproved.tmpl` field references | Page render | Loud at request time | Templates have no compile-time type check |
| `dataSource.DisapprovedBlocks` signature | `explorerUI` + mock | Loud at build | Update `explorer_test.go:73` mock |
| `"disapproved"` in template-name slice | Template lookup | Loud at request time | [explorer.go:401](../../../cmd/dcrdata/internal/explorer/explorer.go#L401) |
| Move `/disapproved` off `withCache` | ETag/Last-Modified disappear | Silent (correctness fine; throughput regresses) | OK to do; document why |
| Remove `/rejects` redirect | External bookmarks | Loud for users (404) | Permanent redirect = stable contract |
| Add WS push or Stimulus controller | Imports C3/C6/C8 | Silent without reconciliation | See [/wiki/core/constraints.md](../../core/constraints.md) |
| Add amount columns | Imports C1/C7 | Silent (precision loss) without SKA pipeline | Don't extend `BlockStatus` |

## Risk 1 — Positional `rows.Scan` desync across 4 readers (shared with `/side`)

**Trigger:** any edit to `BlockStatus` field order/types, or to the column list in `SelectDisapprovedBlocks` / `SelectSideChainBlocks` / `SelectBlockStatus` / `SelectBlockStatuses`, or to the corresponding `rows.Scan` argument order.

**Failure mode:**
- **Loud:** column count mismatch → `sql: expected N destinations, got M` at request time.
- **Silent:** column reorder with type-compatible columns (bool/bool, ChainHash/ChainHash) → wrong values land in wrong fields, no error.

**Affected files (must be edited in lockstep):**
- [db/dbtypes/types.go:2267-2275](../../../db/dbtypes/types.go#L2267-L2275) (struct)
- [db/dcrpg/internal/blockstmts.go:170-193](../../../db/dcrpg/internal/blockstmts.go#L170-L193) (4 SELECTs)
- [db/dcrpg/queries.go:3969-4074](../../../db/dcrpg/queries.go#L3969-L4074) (4 Scans)
- [cmd/dcrdata/views/disapproved.tmpl](../../../cmd/dcrdata/views/disapproved.tmpl) + [cmd/dcrdata/views/sidechains.tmpl](../../../cmd/dcrdata/views/sidechains.tmpl) (field references)

**See also:** [/wiki/code-analysis/sidechain/impact.md](../sidechain/impact.md) — same risk, mirrored on `IsMainchain`; [/wiki/code-analysis/time-based-blocks/impact.md](../time-based-blocks/impact.md) — same pattern in a different domain.

## Risk 2 — `IsValid` field is Scan-default, not queried

**Trigger:** any downstream consumer reading `bs.IsValid` from a slice returned by `ChainDB.DisapprovedBlocks`.

**Failure mode:** Silent. The field is left at Go's zero value (`false`). Coincidentally correct *because* the WHERE clause filters `is_valid=false`, but it's not a contract — a future relaxation of the WHERE (e.g. adding `OR something_else`) would produce rows where `IsValid` is unreliably `false` regardless of the actual database value.

**Why it exists:** the SELECT skips `is_valid` because the WHERE already pins it. Mirror of the `/side` shape, which skips `is_mainchain` for the same reason.

**Mitigations:**
- Don't read `bs.IsValid` from a `DisapprovedBlocks` result. If you need the flag, re-derive from "I got here because the row matched the WHERE."
- If you ever loosen the WHERE clause, **add `is_valid` back to the SELECT and Scan** in the same change.

## Risk 3 — `updateLastBlock` is the sole writer of `is_valid=false`

**Trigger:** any refactor of [db/dcrpg/pgblockchain.go:4042-4155](../../../db/dcrpg/pgblockchain.go#L4042-L4155) — including reordering the cascade, short-circuiting on partial failure, or moving the vote-bit check.

**Failure mode:**
- **Silent (page side):** the page renders an empty table on new disapprovals while the chain continues. No SQL error, no log line beyond the existing `Infof("Previous block %s was DISAPPROVED ...")` failing to fire.
- **Silent (downstream side):** `blocks.is_valid` and `transactions.is_valid` / `vins.is_valid` / `addresses.is_valid` / `vouts.spend_tx_row_id` drift out of agreement. The block-level marker on `/disapproved` may say "this block is disapproved" while the affected transactions on `/tx/{hash}` and addresses on `/address/{addr}` still appear as valid spends.

**Atomicity note:** the cascade is **not** wrapped in a single Postgres transaction. Mid-cascade reads (e.g. a `/disapproved` request landing between `updateLastBlockValid` and `updateTransactionsValid`) may see partial state. For this page that's fine because only `blocks.is_valid` is queried; for `/tx/{hash}` and `/address/{addr}` it is observable inconsistency. See [block/impact.md](../block/impact.md) for the cross-table coherence concerns.

## Risk 4 — ETag cache + non-block-driven field

**Trigger:** adding a field to `disapproved.tmpl` whose underlying data changes outside the new-block notification (e.g. mempool stats, exchange rates, governance state).

**Failure mode:** Silent. The cache invalidation key is set by block notifications inside `ETagAndLastModifiedIntercept`. A field driven by a different signal will appear correct on initial render and serve stale to clients with `If-None-Match` until the next block.

**Mitigations:**
- Move `/disapproved` off `withCache` if you need any non-block-driven content here.
- Or arrange for the new signal to also invalidate the ETag store (read [page-rendering/patterns.md](../page-rendering/patterns.md) before doing this — the ETag store is shared across `/`, `/disapproved`, `/mempool`, `/charts`).

## Risk 5 — Adding a real-time element

**Trigger:** any addition of WebSocket push, a Stimulus controller, or live-DOM updates to `disapproved.tmpl`.

**Failure mode:** Silent. The page currently satisfies C1/C2/C3/C6/C8 *by absence*. Adding a real-time element instantly imports those constraints, and the first new disapproval pushed via WS will reveal whichever one was overlooked:
- C3: server-rendered row markup vs JS-cloned row markup must match.
- C6: `document.importNode(tmpl.content, true)` against `<template id="...">`, never `innerHTML`.
- C8: HTTP and WS shapes for the new field are two contracts, not one.

**Mitigations:**
- Use the [page-rendering/patterns.md](../page-rendering/patterns.md) `*CommonPageData` embedding + `<template id="...">` clone-flow.
- Mirror the WS encoder in [block/flow.full.md](../block/flow.full.md) §4 if pushing per-block events.

## Risk 6 — Adding amount columns

**Trigger:** any column like "value invalidated", "tx count by coin", "fees invalidated".

**Failure mode:** Silent. `BlockStatus` is amount-free by construction. Any new amount field grafted onto it will be at risk of:
- C1 (precision bifurcation): SKA atoms exceed `float64` significand; `dcrutil.Amount.ToCoin()` corrupts SKA.
- C7 (centralized coin-type label rendering): inline `"VAR"` / `` `SKA${n}` `` violates the canonical helper rule.

**Mitigations:**
- Don't extend `BlockStatus`. Build a sibling row type with `map[uint8]string` for per-coin amounts (atoms as base-10 strings).
- Render labels via `coinSymbol` (Go) / `renderCoinType` (JS) only.
- Read [address/patterns.md](../address/patterns.md) for the SKA-string pipeline shape before designing the column.

## Risk 7 — `/rejects` redirect removal

**Trigger:** deleting the `r.Get("/rejects", ...)` block at [cmd/dcrdata/main.go:769-771](../../../cmd/dcrdata/main.go#L769-L771).

**Failure mode:** Loud for users — 404 on the legacy alias. The redirect is `308 StatusPermanentRedirect`, which says "always was, always will be"; downstream caches and external bookmarks may treat it as immutable. Removal is observably a regression.

**Mitigation:** keep the redirect unless there is a deliberate decision to deprecate the alias (and document the version cutover).

## Cross-domain notes

- **`/side` vs `/disapproved` asymmetry on ETag caching** is discretionary, not a bug. Don't "normalize" the two routes without first verifying that `/side`'s writer events (`TipToSideChain`) also reset the shared ETag store.
- **`BlockStatus`-as-external-contract.** Treat the struct as an external contract across 4 query functions, 2 list pages, and the `/block/{hash}` status display. Do not "clean up" field naming/ordering without coordinated edits.
- **No upstream sync.** This codebase was squashed from `decred/dcrdata` with no git upstream. The `POSExplanation` link in [explorer.go:169](../../../cmd/dcrdata/internal/explorer/explorer.go#L169) still points at Decred docs — cosmetic, but worth flagging when refactoring the `Links` struct.

See also:

- [/wiki/code-analysis/sidechain/flow.full.md](../sidechain/flow.full.md) (shares-pattern-with: same shared struct + filter-skip-in-SELECT trick; differ on writer + ETag)
- [/wiki/code-analysis/sidechain/impact.md](../sidechain/impact.md) (shares-pattern-with: `BlockStatus` 4-reader Scan blast)
- [/wiki/code-analysis/block/impact.md](../block/impact.md) (depends-on: `StoreBlock`/`updateLastBlock` is the writer entry point; cross-table is_valid coherence)
- [/wiki/code-analysis/time-based-blocks/impact.md](../time-based-blocks/impact.md) (shares-pattern-with: positional `rows.Scan` desync risk)
- [/wiki/code-analysis/page-rendering/patterns.md](../page-rendering/patterns.md) (depends-on: block-scoped ETag cache shared across `/`, `/disapproved`, `/mempool`, `/charts`)
- [/wiki/core/constraints.md](../../core/constraints.md) (depends-on: C1/C2/C3/C6/C8 out of scope today — re-imported by real-time or amount columns)
