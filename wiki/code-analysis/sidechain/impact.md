# Sidechain — Mutation Impact

Blast-radius reference for changes that touch the `/side` page, its DB writers, or the shared `BlockStatus` row type. Companion to [flow.full.md](flow.full.md).

## 1. `BlockStatus` struct edits (4-endpoint blast)

**Trigger:** any change to [db/dbtypes/types.go:2267-2275](../../../db/dbtypes/types.go#L2267-L2275) — field add, remove, reorder, or type change.

**Affected positional `rows.Scan` sites in [db/dcrpg/queries.go](../../../db/dcrpg/queries.go):**

| Function | SQL (in [internal/blockstmts.go](../../../db/dcrpg/internal/blockstmts.go)) | Cols scanned | Skipped |
|---|---|---|---|
| `retrieveSideChainBlocks` ([queries.go:3969-3991](../../../db/dcrpg/queries.go#L3969-L3991)) | `SelectSideChainBlocks` | `is_valid, height, previous_hash, hash, next_hash` | `is_mainchain` (filtered by WHERE) |
| `retrieveDisapprovedBlocks` ([queries.go:4020-…](../../../db/dcrpg/queries.go#L4020)) | `SelectDisapprovedBlocks` | `is_mainchain, height, previous_hash, hash, next_hash` | `is_valid` (filtered by WHERE) |
| Block-status (single hash) | `SelectBlockStatus` | all 6 columns | — |
| Block-statuses (by height) | `SelectBlockStatuses` | `is_valid, is_mainchain, hash` | `height, previous_hash, next_hash` |

**Failure modes:**

- **Loud** — adding a field whose type breaks positional Scan binding (e.g. inserting a new `string` between two `bool`s shifts the Scan offsets) → `sql.Rows.Scan: ...` at request time.
- **Silent** — same-type swap (e.g. accidentally reorder `IsValid` and `IsMainchain`): all 4 Scan sites compile, page renders, but the "PoS Approved" column on `/side` now displays the `is_mainchain` value, and the `/disapproved` page mislabels disapproval status. No build/test signal — only visible by inspecting the rendered table.

**Mitigation:** treat `BlockStatus` as an external contract. If you must change it, edit all 4 Scan sites in the same commit and grep for `*dbtypes.BlockStatus` consumers (`BlockStatus(ctx, hash)`, `BlockStatuses(ctx, height)`, `TransactionBlocks(...)`, the two page handlers) before merging.

## 2. SQL ↔ Scan desync (positional invariant)

**Trigger:** edit either `SelectSideChainBlocks` ([blockstmts.go:170-174](../../../db/dcrpg/internal/blockstmts.go#L170-L174)) or the matching `rows.Scan` ([queries.go:3981](../../../db/dcrpg/queries.go#L3981)) without updating the other.

**Failure modes:**

- Adding a column to SELECT without adding a `&bs.Field` → `sql.Rows.Scan: expected 6 destinations, got 5 in Scan` (or vice versa). Loud.
- Reordering existing columns in SELECT → Scan binds wrong source to wrong destination. Silent if types are compatible.

**Mitigation:** the SQL string and the Scan expression must be edited as one unit. Same risk pattern documented in [time-based-blocks/impact.md](../time-based-blocks/impact.md) for `BlocksGroupedInfo` Scan.

## 3. `IsMainchain` is never populated on `/side` results

**Trigger:** downstream code reads `bs.IsMainchain` from a slice returned by `ChainDB.SideChainBlocks(ctx)`.

**Why it's a trap:** `SelectSideChainBlocks` does *not* SELECT `is_mainchain`, so the Scan leaves the field at Go-zero (`false`). For this specific query the value is coincidentally correct (the WHERE filtered `is_mainchain=false`), but the *field is uninitialized*, not assigned. A future maintainer who reuses these `[]*dbtypes.BlockStatus` rows in another context — or relaxes the WHERE clause — will see uniformly-false `IsMainchain` and mistake it for real data.

**Failure mode:** silent — passes Go type-check and integration tests that don't read the field. Only visible if someone later filters by `bs.IsMainchain` and is surprised that everything is "side".

**Mitigation:** when reading a `BlockStatus`, know which SQL function produced it. If `IsMainchain` matters, use `SelectBlockStatus` / `SelectBlockStatuses`.

## 4. `ImportSideChains` flag — empty page is *correct*

**Trigger:** operator complains that `/side` is empty despite the node reporting side chains in `getchaintips`.

**Why:** `cfg.ImportSideChains` defaults to `false` ([cmd/dcrdata/config.go:151](../../../cmd/dcrdata/config.go#L151), marked *experimental*). The startup batch import at [cmd/dcrdata/main.go:885-960](../../../cmd/dcrdata/main.go#L885-L960) only runs when the flag is on. Without the flag, side-chain rows enter the DB only via live reorgs that happen *after* this instance started.

**Failure mode:** silent product behavior — not a bug. Document this in any spec that promises "side chains since genesis".

**Mitigation:** if /side completeness becomes a product requirement, switch to enabling the flag by default *or* run a one-shot import on upgrade. Either change widens the startup window meaningfully — measure first.

## 5. Reorg-during-request consistency

**Trigger:** `TipToSideChain` runs while a `/side` request is mid-flight.

**Why:** the read query (`retrieveSideChainBlocks`) and the writer (`setMainchainByBlockHash` per row, plus per-row updates to transactions / votes / tickets / addresses in [pgblockchain.go:3704-…](../../../db/dcrpg/pgblockchain.go#L3704)) share no application-level lock. Postgres MVCC isolates the SELECT, but the writer commits row-by-row, so the next request can see a different set.

**Failure mode:** silent and benign — page shows the snapshot at that request's read timestamp. Resolves on refresh.

**Mitigation:** none needed unless you start emitting `/side` as a side-effect of a write path. If you do, snapshot the height range explicitly.

## 6. Adding a real-time element imports C3/C8/C4

**Trigger:** "let's push new side-chain blocks via WebSocket as they're discovered."

**Why:** the page currently has zero WS/Stimulus surface. Adding one immediately imports the dual-transport patterns documented for `block`, `visualblocks`, and `mempool`: server-side template render *and* WS message *and* JS reconciliation must all match field-by-field ([core/constraints.md](../../core/constraints.md) C3/C8, plus C6 for clone-template rendering).

**Failure mode:** the classic C8 bug — server-rendered initial table shows correct data, WS-pushed updates silently miss new fields, and the page degrades on refresh.

**Mitigation:** if you really want this, design the WS payload, the `<template>` clone target, and the JS controller as a single unit. Cross-reference [visualblocks/patterns.md](../visualblocks/patterns.md) for prior art on dual-pipeline tile rendering — `/side` would be the simplest possible instance of that pattern.

## 7. Adding amount columns re-imports C1

**Trigger:** product asks for "value transferred in side blocks" or "tx count by coin" on `/side`.

**Why:** the current row type is precision-free. As soon as you carry amounts, SKA's 18-decimal precision must be preserved as `big.Int`-derived strings end-to-end ([core/constraints.md](../../core/constraints.md) C1). The naive path — extend `BlockStatus` with a `float64` total — silently corrupts SKA values.

**Failure mode:** silent precision loss on SKA values; VAR rows look fine in tests that only exercise VAR.

**Mitigation:** build a separate row type (`SideChainBlockRow` or similar) that carries `CoinStats map[uint8]CoinStat` or per-coin amount strings, exactly as `BlocksGroupedInfo`/`address.AddressInfo` do. Do not extend `BlockStatus`.

## 8. Writer-path asymmetry: insert vs update

**Trigger:** refactor of the side-chain writers.

**Why:**

- Startup import (`StoreBlock(isMainchain=false)`) **inserts** new `block_chain` rows.
- Live reorg (`TipToSideChain`) **updates** existing `blocks.is_mainchain`; it does *not* touch `block_chain` (those rows already exist from when the block was mainchain).

If the two paths are unified — for example by routing both through a single "make this block side-chain" helper — make sure the new helper still distinguishes "row does not exist yet" (insert + `insertBlockPrevNext`) from "row exists with `is_mainchain=true`" (UPDATE only). Conflating them risks duplicate `block_chain` rows.

**Mitigation:** keep the `is_mainchain=false` insertion path (`StoreBlock`/`insertBlockPrevNext`) separate from the demotion path (`setMainchainByBlockHash`), or assert single-row presence before inserting.

---

## See also

- [/wiki/code-analysis/sidechain/flow.full.md](flow.full.md) (companion full flow)
- [/wiki/code-analysis/block/impact.md](../block/impact.md) (depends-on: block ingestion writes side rows too via `StoreBlock`)
- [/wiki/code-analysis/time-based-blocks/impact.md](../time-based-blocks/impact.md) (shares-pattern-with: positional `rows.Scan` desync risk)
- [/wiki/core/constraints.md](../../core/constraints.md) (C1 explicitly out of scope here; C3/C6/C8 become applicable the moment any real-time element is added)
