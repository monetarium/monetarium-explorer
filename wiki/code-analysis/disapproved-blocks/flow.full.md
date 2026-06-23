# Disapproved Blocks Page (`/disapproved`) — Full Flow

## Section 1 — Overview

`/disapproved` lists every block whose **regular** transaction tree was invalidated by stakeholder votes on the *next* block — i.e. every row in the Postgres `blocks` table with `is_valid = FALSE`. It is a **read-only, single-query, server-rendered HTML page** with no WebSocket, no Stimulus controller, and no real-time update.

The page is structurally a near-twin of [/side](../sidechain/flow.full.md): both endpoints return `[]*dbtypes.BlockStatus`, both run a single SQL JOIN of `blocks` and `block_chain`, both render four columns of block-status metadata. **No amounts, no per-coin maps, no fee data** — C1 (precision bifurcation), C3 (template/WS parity), and C8 (dual-transport shape) do not apply.

Three load-bearing differences from `/side` shape the mutation surface:

1. **Filter column.** `/side` filters on `is_mainchain = FALSE`; `/disapproved` filters on `is_valid = FALSE`. Each query's SELECT skips its own filter column (the WHERE makes it redundant), so the two queries leave **different** `BlockStatus` fields unwritten by Scan — `/side` leaves `IsMainchain` zero, `/disapproved` leaves `IsValid` zero.
2. **Writer semantics.** `/side` rows are populated by reorg (`TipToSideChain`) or by opt-in startup import (`ImportSideChains`). `/disapproved` rows are populated by the normal **block-connect** path — `updateLastBlock` flips `is_valid=false` on the *previous* block when the current block's vote bits disapprove it. Disapprovals are produced by every running instance, no flag, on every block where stakeholders rejected the parent's regular tx tree.
3. **HTTP cache.** `/disapproved` is mounted under `withCache` (`ETagAndLastModifiedIntercept`) at [cmd/dcrdata/main.go:770](../../../cmd/dcrdata/main.go#L770); `/side` is **not** ([cmd/dcrdata/main.go:735](../../../cmd/dcrdata/main.go#L735)). Disapprovals only change on new-block notifications, which is the same trigger that resets the cache's ETag, so caching is coherent. `/side` could in principle also be cached but currently is not.

The page returns `[]*dbtypes.BlockStatus`. That struct is reused by **4 SQL functions** with different column subsets — this is the central mutation hazard, already documented in [sidechain/flow.full.md §3](../sidechain/flow.full.md). Treat this trace as the writer-specific complement to that one.

## Section 2 — End-to-End Data Flow

```text
monetarium-node                                ┐
   │ new-block notification                    │
   ▼                                           │  writer path
internal/notification.SignalNewBlock           │  (populate
   │                                           │   is_valid=false
   ▼                                           │   on parent)
db/dcrpg.ChainDB.StoreBlock                    │
   │ → updateLastBlock(msgBlock, isMainchain)  │
   │                                           │
   │  if (msgBlock.Header.VoteBits & 1) == 0:  │
   │     updateLastBlockValid(parent, false)   │
   │     + updateLastVins / updateTransactions │
   │       Valid / updateLastAddressesValid    │
   │     + clearVoutRegularSpendTxRowIDs       │
   │     + AddressCache.Clear(addrs)           ┘

────────── read path (every /disapproved request) ──────────

HTTP GET /disapproved
   │
   ▼
chi router (cmd/dcrdata/main.go)
   │  withCache.ETagAndLastModifiedIntercept ← only on this endpoint
   ▼
explorerUI.DisapprovedBlocks
   │
   ▼
explorerUI.dataSource.DisapprovedBlocks(ctx)
   │  (interface in cmd/dcrdata/internal/explorer/explorer.go)
   ▼
db/dcrpg.ChainDB.DisapprovedBlocks   ── queryTimeout context
   │
   ▼
retrieveDisapprovedBlocks
   │
   │  SELECT is_mainchain, height, previous_hash, hash, block_chain.next_hash
   │  FROM blocks
   │  JOIN block_chain ON this_hash=hash
   │  WHERE is_valid = FALSE
   │  ORDER BY height DESC;
   ▼
[]*dbtypes.BlockStatus  (5 of 6 fields populated; IsValid left zero)
   │
   ▼
templates.exec("disapproved", { CommonPageData, Data })
   │
   ▼
views/disapproved.tmpl  →  HTML response
```

The same data is also reachable indirectly:

- `/rejects` → `http.Redirect(..., "/disapproved", 308)` ([cmd/dcrdata/main.go:736-738](../../../cmd/dcrdata/main.go#L736-L738)). Legacy alias; permanent redirect.
- `/blocks` template links to `/disapproved` for users looking for PoS-invalidated blocks ([cmd/dcrdata/views/blocks.tmpl:174](../../../cmd/dcrdata/views/blocks.tmpl#L174)).

## Section 3 — Per-Layer Breakdown

### Router

- **Location:** [cmd/dcrdata/main.go:768-770](../../../cmd/dcrdata/main.go#L768-L770)
- **Code:**
  ```go
  withCache := r.With(explore.ETagAndLastModifiedIntercept)
  withCache.Get("/", explore.Home)
  withCache.Get("/disapproved", explore.DisapprovedBlocks)
  ```
- **Middleware:** `ETagAndLastModifiedIntercept` ([explorermiddleware.go:193](../../../cmd/dcrdata/internal/explorer/explorermiddleware.go#L193)) — block-scoped ETag/Last-Modified cache shared with `/`, `/mempool`, `/charts`, and other home-page-adjacent endpoints. See [page-rendering/patterns.md](../page-rendering/patterns.md) for the cache invariant.
- **Legacy redirect:** [cmd/dcrdata/main.go:736-738](../../../cmd/dcrdata/main.go#L736-L738) — `/rejects` → `/disapproved` (308 Permanent).

### Handler

- **Location:** [cmd/dcrdata/internal/explorer/explorerroutes.go:323-353](../../../cmd/dcrdata/internal/explorer/explorerroutes.go#L323-L353)
- **Logic:** call `dataSource.DisapprovedBlocks(ctx)`; on context-deadline error, render the timeout error page via `exp.timeoutErrorPage`; on any other error, render `StatusPage(defaultErrorCode, "failed to retrieve stakeholder disapproved blocks", ...)`; otherwise execute the `"disapproved"` template with `{ *CommonPageData, Data []*dbtypes.BlockStatus }`.
- **No mutation, no derived fields, no per-coin handling.** Thin pass-through. Identical shape to `SideChains` handler ([explorerroutes.go:274-305](../../../cmd/dcrdata/internal/explorer/explorerroutes.go#L274-L305)).

### DataSource interface

- **Location:** [cmd/dcrdata/internal/explorer/explorer.go:87](../../../cmd/dcrdata/internal/explorer/explorer.go#L87) — `DisapprovedBlocks(context.Context) ([]*dbtypes.BlockStatus, error)`
- **Test mock:** [cmd/dcrdata/internal/explorer/explorer_test.go:79](../../../cmd/dcrdata/internal/explorer/explorer_test.go#L79) — fan-out point if the signature changes.

### ChainDB read method

- **Location:** [db/dcrpg/pgblockchain.go:869-875](../../../db/dcrpg/pgblockchain.go#L869-L875)
- **Behavior:** wraps `retrieveDisapprovedBlocks` in a `context.WithTimeout(ctx, pgb.queryTimeout)` and routes cancellation through `pgb.replaceCancelError`. Identical shape to `SideChainBlocks`.

### SQL query + Scan

- **SQL:** [db/dcrpg/internal/blockstmts.go:199-203](../../../db/dcrpg/internal/blockstmts.go#L199-L203)
  ```sql
  SelectDisapprovedBlocks = `SELECT is_mainchain, height, previous_hash, hash, block_chain.next_hash
      FROM blocks
      JOIN block_chain ON this_hash=hash
      WHERE is_valid = FALSE
      ORDER BY height DESC;`
  ```
- **Scan:** [db/dcrpg/queries.go:4142-4164](../../../db/dcrpg/queries.go#L4142-L4164)
  ```go
  err = rows.Scan(&bs.IsMainchain, &bs.Height, &bs.PrevHash, &bs.Hash, &bs.NextHash)
  ```
- **Critical:** five columns map to five of the six struct fields. **`bs.IsValid` is never written** — left at its Go zero value (`false`). The WHERE clause already filters `is_valid=false`, so the template treats all rows as disapproved, but anyone reading `bs.IsValid` from the returned slice elsewhere is reading a Scan-default, not a queried value. This is the **same hazard shape** as `/side` (which leaves `IsMainchain` unwritten) — but on a different field.

### `BlockStatus` shared struct (4 readers, 4 column subsets)

- **Location:** [db/dbtypes/types.go:2274-2282](../../../db/dbtypes/types.go#L2274-L2282)
  ```go
  type BlockStatus struct {
      IsValid     bool
      IsMainchain bool
      Height      uint32
      PrevHash    ChainHash
      Hash        ChainHash
      NextHash    ChainHash
  }
  ```
- The four reader functions that share this struct each have a different positional Scan:

  | Function | Cols | Order |
  |---|---|---|
  | `retrieveSideChainBlocks` | 5 | `is_valid, height, previous_hash, hash, next_hash` — skips `is_mainchain` (WHERE makes it false) |
  | `retrieveDisapprovedBlocks` | 5 | `is_mainchain, height, previous_hash, hash, next_hash` — skips `is_valid` (WHERE makes it false) |
  | `retrieveBlockStatus` | 6 | `is_valid, is_mainchain, height, previous_hash, hash, next_hash` — all fields |
  | `retrieveBlockStatuses` | 3 | `is_valid, is_mainchain, hash` — `Height` set externally from query input |

  See [db/dcrpg/internal/blockstmts.go:180-203](../../../db/dcrpg/internal/blockstmts.go#L180-L203) and [db/dcrpg/queries.go:4091-4198](../../../db/dcrpg/queries.go#L4091-L4198).
- **Implication:** the two list endpoints (`/side`, `/disapproved`) each pre-trim one different filter column. Symmetric in shape; asymmetric in *which* field is unreliable.

### Template

- **Location:** [cmd/dcrdata/views/disapproved.tmpl](../../../cmd/dcrdata/views/disapproved.tmpl)
- **Columns rendered:** `Height` (link to `/block/{hash}`), `Main Chain` (`.IsMainchain`, populated by Scan), `Parent` (`.PrevHash` → `/block/{prev}`), `Child` (`.NextHash` if set → `/block/{next}`; otherwise `none` with `title="This block is the tip of its chain."`).
- **Does NOT render `IsValid`.** This is the field that Scan leaves zero, so omitting it from the template is what keeps the page coherent. Adding `{{.IsValid}}` to the template without first reading the column would silently render `false` for every row.
- **External link:** `.Links.POSExplanation` points at `https://docs.decred.org/proof-of-stake/overview/` ([cmd/dcrdata/internal/explorer/explorer.go:171](../../../cmd/dcrdata/internal/explorer/explorer.go#L171)) — a residual Decred doc link (stale for Monetarium; the URL still resolves to upstream Decred). Cosmetic.
- **No JS controller bound** beyond `data-controller="time"` (navbar helpers). Table id `disapprovedblockstable` is decorative — nothing selects on it.
- **Template registration:** [cmd/dcrdata/internal/explorer/explorer.go:397](../../../cmd/dcrdata/internal/explorer/explorer.go#L397) — the literal string `"disapproved"` is in the `tmpls` slice; mismatched template name is a registration-time failure.

### Writer path (how rows reach `is_valid=false`)

There is **one and only one** writer path, embedded in the normal block-connect flow:

- Entry: `ChainDB.StoreBlock` ([db/dcrpg/pgblockchain.go:3822-4061](../../../db/dcrpg/pgblockchain.go#L3822-L4061)) calls `pgb.updateLastBlock(msgBlock, isMainchain)` for every block.
- `updateLastBlock` ([db/dcrpg/pgblockchain.go:4062-4180](../../../db/dcrpg/pgblockchain.go#L4062-L4180)) inspects `msgBlock.Header.VoteBits & 1`. Bit 0 == 0 means the **parent** block is disapproved by stakeholders. When this fires:
  1. `updateLastBlockValid(db, parentDbID, false)` — flips `blocks.is_valid` for the parent row. SQL: `UpdateLastBlockValid` in [db/dcrpg/internal/blockstmts.go:213](../../../db/dcrpg/internal/blockstmts.go#L213).
  2. `clearVoutRegularSpendTxRowIDs(db, parentHash)` — unsets `vouts.spend_tx_row_id` for any vouts the parent's regular txs had consumed (the spends are now invalid).
  3. `updateLastVins(db, parentHash, false, isMainchain)` — propagates `is_valid=false` to the parent's vins rows.
  4. `updateTransactionsValid(db, parentHash, false)` — propagates to the parent's regular transactions.
  5. `updateLastAddressesValid(db, parentHash, false)` — propagates to the addresses table.
  6. `pgb.AddressCache.Clear(addrs)` — evicts in-memory caches for the affected addresses.
- **Side-chain guard:** if the current block being added is itself side-chain, `updateLastBlock` returns early when the parent is on the main chain ([db/dcrpg/pgblockchain.go:4076-4091](../../../db/dcrpg/pgblockchain.go#L4076-L4091)). Side-chain blocks **cannot** invalidate main-chain ancestors via this code path — exactly the symmetric constraint that keeps `/side` and `/disapproved` from cross-polluting.
- **NOTE in code** ([pgblockchain.go:4163-4165](../../../db/dcrpg/pgblockchain.go#L4163-L4165)): tickets, votes, misses, treasury are *not* updated — the stake tree is not subject to stakeholder approval.

**Observation:** unlike `/side` (two writers: startup import + reorg), `/disapproved` has a single, always-on writer. No flag, no opt-in. Any tip extension that disapproves its parent immediately mutates the parent's `is_valid=false` and adds it to the `/disapproved` set.

### HTTP cache integration

- `withCache.Get("/disapproved", ...)` wraps the handler in `ETagAndLastModifiedIntercept` ([explorermiddleware.go:193](../../../cmd/dcrdata/internal/explorer/explorermiddleware.go#L193)).
- Disapprovals only change on block connect; the same event resets the ETag store. So clients with `If-None-Match` get a 304 between blocks. No staleness window beyond the normal new-block latency.
- **Asymmetry with `/side`:** `/side` is **not** under `withCache`, even though its writer paths (reorg, startup import) also only fire on observable events. This is a discretionary choice, not a correctness issue — but anyone refactoring the route block should not "fix" the asymmetry without checking that `/side`'s writer events (`TipToSideChain`) reset the ETag store too.

## Section 4 — Cross-Layer Dependencies

- **Handler ↔ DataSource interface:** `DisapprovedBlocks(ctx)` is one of ~30 methods on `dataSource` ([explorer.go:72-130](../../../cmd/dcrdata/internal/explorer/explorer.go#L72-L130)). Mock must track signature.
- **SQL ↔ Scan ↔ Struct:** three independent files must stay in lockstep — `blockstmts.go` (SELECT column list), `queries.go` (`rows.Scan` destinations), `db/dbtypes/types.go` (struct field order/types). Positional binding means a one-line edit in any of the three can silently rewire data into the wrong field.
- **Struct ↔ Sibling readers:** because `BlockStatus` is the return type of four different SQL functions, a struct change ripples into `DisapprovedBlocks`, `SideChainBlocks`, `BlockStatus(hash)`, and `BlockStatuses(height)`. Two are list-page handlers (`/disapproved`, `/side`), one feeds `/block/{hash}` status rendering, one feeds height-keyed approval checks (see [explorerroutes.go:793](../../../cmd/dcrdata/internal/explorer/explorerroutes.go#L793)).
- **Writer race:** between a `StoreBlock` mid-disapproval (flipping `is_valid=false`) and a concurrent `/disapproved` request, the page is best-effort consistent. The SELECT may pick up rows mid-cascade (e.g., `blocks.is_valid` flipped but `transactions.is_valid` not yet) — for this page it doesn't matter because only `blocks.is_valid` is queried. Other readers consuming the same parent block during the cascade window may see inconsistent state.
- **Cache invalidation coupling:** the ETag intercept must be invalidated whenever any field this page renders could change. Today the trigger is new-block notification, which covers it. Adding a field to `disapproved.tmpl` driven by a *different* trigger (e.g. a mempool-derived field) would silently serve stale cached pages until the next block.

## Section 5 — Critical Constraints

This is one of the few pages where **most repository invariants do NOT apply**:

- **C1 (precision bifurcation):** *Does not apply.* No amounts, no SKA, no per-coin maps. Don't add amount columns to this page without first reading C1 and adopting the SKA-string pipeline used elsewhere (`address`, `block`, `mempool`, `charts`).
- **C2 (dual pipeline mutation):** *Does not apply.* No real-time pipeline. The page reads strictly from Postgres.
- **C3 (template + WebSocket parity):** *Does not apply by absence* — no WebSocket transport for this page. Adding live updates would force C3/C8 reconciliation.
- **C6 (in-DOM template cloning):** *Does not apply* — no JS-driven row creation. All rows are server-rendered.
- **C8 (dual-transport shape asymmetry):** *Does not apply* — single HTTP transport.

What **does** apply:

- **Positional `rows.Scan` invariant** (recurs across the codebase; see [sidechain/flow.full.md §3](../sidechain/flow.full.md) and [time-based-blocks/impact.md](../time-based-blocks/impact.md)). Column order in `SelectDisapprovedBlocks` must match Scan destination order in `retrieveDisapprovedBlocks` must match the documented `BlockStatus` field ordering it relies on.
- **`IsValid` field is Scan-default, not queried.** Read it nowhere downstream from a `DisapprovedBlocks` result; the WHERE clause is the only ground truth for "this block was disapproved."
- **Single-coin / multi-coin invariants** are trivially satisfied — no transaction or amount data is rendered, so the multi-coin rules cannot be violated here. They re-emerge if a "tx count by coin" or "value invalidated" column is ever added.

## Section 6 — Mutation Impact

When modifying anything in this flow, check:

1. **`BlockStatus` struct field order or type** — breaks 4 positional `Scan`s and 2 templates (`disapproved.tmpl`, `sidechains.tmpl`). Loud at Scan time if column count changes; **silent** if field types stay compatible (bool/bool, ChainHash/ChainHash). Always confirm by reading every `rows.Scan(&bs....)` in `db/dcrpg/queries.go` after a struct edit.
2. **`SelectDisapprovedBlocks` column list** — must update `retrieveDisapprovedBlocks` `rows.Scan` in lockstep, otherwise loud Scan error or silent column shift.
3. **`retrieveDisapprovedBlocks` Scan order** — same.
4. **Template field references** — adding/removing struct fields breaks `{{.Field}}` references at template-execute time (loud at request time, not build time — Go templates have no compile-time type check).
5. **Adding `{{.IsValid}}` to the template** — silently renders `false` for every row. Either drop the field from the SELECT-skip optimization (add it back to SELECT + Scan), or don't reference it.
6. **`updateLastBlock` invalidation cascade** — the **only** code that flips `blocks.is_valid=false`. If the cascade ever stops calling `updateLastBlockValid`, this page silently empties on new blocks (no SQL error — just no rows added). If `clearVoutRegularSpendTxRowIDs` / `updateLastVins` / `updateTransactionsValid` ever stop firing in lockstep, downstream tx/address pages render stale "spent" markers that the block-level disapproval indicator on this page already shows.
7. **`UpdateLastBlockValid` SQL** ([blockstmts.go:213](../../../db/dcrpg/internal/blockstmts.go#L213)) — the only writer to `blocks.is_valid`. Renaming the column requires synchronized edits in both list SELECTs and the cascade SQLs.
8. **`ETagAndLastModifiedIntercept` invalidation trigger** — currently keyed on block notifications, which matches the writer trigger. If a future field on this page is driven by anything else (mempool, exchange feed, governance), the cache will serve stale pages.
9. **Removing the `/rejects` redirect** — would break any external link or bookmark using the legacy alias. 308 Permanent says "always was, always will be"; flipping to 404 is a noticeable regression for long-tail traffic.
10. **Adding a real-time element** (WebSocket push, Stimulus controller) — instantly imports C3/C8/C6 into this domain. Don't bolt on WS updates without a dedicated message shape and a `data-controller` clone-template flow.

**Silent failures:**

- Column-order swap (e.g., swapping `is_mainchain` and `next_hash` in either the SELECT or the Scan): the page renders nonsense in the "Main Chain" / "Child" columns without throwing. Caught only by visual inspection.
- Adding `is_valid` back into the SELECT column list **without** also adding `&bs.IsValid` to Scan (or vice versa): loud Scan error.
- `updateLastBlock` silently no-ops if the parent block lookup fails (logged at debug level, returns `nil`) — silent under-counting of disapprovals.
- `ETagAndLastModifiedIntercept` over-coupling: an unrelated change that resets the ETag store on every request would make `/disapproved` re-render on every hit (no correctness issue, just throughput).

**Hard failures:**

- Removing `is_valid` from the `blocks` table, or the `block_chain.next_hash` column, or the JOIN: SQL error on every request to `/disapproved`, `/side`, and any `BlockStatus` lookup.
- Renaming `BlockStatus` fields without updating `disapproved.tmpl` / `sidechains.tmpl`: template-execute error rendered as `StatusPage(defaultErrorCode, ...)`.
- Misspelling `"disapproved"` in the template registration slice ([explorer.go:397](../../../cmd/dcrdata/internal/explorer/explorer.go#L397)): template lookup failure at request time.
- `queryTimeout` set too low for an indexed scan over a large `blocks` table: `timeoutErrorPage` triggers.

## Section 7 — Common Pitfalls

- **Assuming `bs.IsValid` is populated by `DisapprovedBlocks`.** It isn't — the SQL omits the column because the WHERE filters `is_valid=false`. Reading the field downstream is reading the Scan default, not a queried value. Symmetric to the `/side` pitfall on `IsMainchain`.
- **Treating `/disapproved` as a clone of `/side`.** Structurally they are; semantically they're not. `/side`'s rows are populated by chain reorganization; `/disapproved`'s rows are populated by stakeholder votes inside the normal block-connect path. A change to reorg handling does not affect `/disapproved`; a change to `updateLastBlock`'s vote-bit interpretation does.
- **Bolt-on amount columns.** Tempting to add "value invalidated" / "tx count" columns. That immediately re-invites C1, C7, and the SKA-string pipeline. Don't add amounts to `BlockStatus`; build a separate row type if needed.
- **Removing the SELECT-skip optimization.** Adding `is_valid` back into the SELECT just to "be explicit" is harmless if Scan is updated in lockstep, but if Scan isn't updated, you get a runtime Scan error. The optimization is load-bearing only by convention.
- **Refactoring `updateLastBlock` "to clean it up".** It is the *only* writer that flips `blocks.is_valid` and it sequences five dependent table updates. Any reordering or short-circuit changes the per-table consistency window observable by the rest of the codebase.

## Section 8 — Evidence

- Route registration — [cmd/dcrdata/main.go:768-770](../../../cmd/dcrdata/main.go#L768-L770); `/rejects` redirect — [cmd/dcrdata/main.go:736-738](../../../cmd/dcrdata/main.go#L736-L738)
- Handler — [cmd/dcrdata/internal/explorer/explorerroutes.go:323-353](../../../cmd/dcrdata/internal/explorer/explorerroutes.go#L323-L353)
- Interface — [cmd/dcrdata/internal/explorer/explorer.go:86](../../../cmd/dcrdata/internal/explorer/explorer.go#L86)
- Test mock — [cmd/dcrdata/internal/explorer/explorer_test.go:79](../../../cmd/dcrdata/internal/explorer/explorer_test.go#L79)
- Template name registration — [cmd/dcrdata/internal/explorer/explorer.go:397](../../../cmd/dcrdata/internal/explorer/explorer.go#L397)
- POSExplanation link — [cmd/dcrdata/internal/explorer/explorer.go:171](../../../cmd/dcrdata/internal/explorer/explorer.go#L171)
- ChainDB read method — [db/dcrpg/pgblockchain.go:869-875](../../../db/dcrpg/pgblockchain.go#L869-L875)
- SQL — [db/dcrpg/internal/blockstmts.go:199-203](../../../db/dcrpg/internal/blockstmts.go#L199-L203)
- Scan — [db/dcrpg/queries.go:4142-4164](../../../db/dcrpg/queries.go#L4142-L4164)
- Shared struct — [db/dbtypes/types.go:2274-2282](../../../db/dbtypes/types.go#L2274-L2282)
- Template — [cmd/dcrdata/views/disapproved.tmpl](../../../cmd/dcrdata/views/disapproved.tmpl)
- Entry link from `/blocks` — [cmd/dcrdata/views/blocks.tmpl:174](../../../cmd/dcrdata/views/blocks.tmpl#L174)
- Writer cascade `updateLastBlock` — [db/dcrpg/pgblockchain.go:4062-4180](../../../db/dcrpg/pgblockchain.go#L4062-L4180)
- Writer SQL `UpdateLastBlockValid` — [db/dcrpg/internal/blockstmts.go:213](../../../db/dcrpg/internal/blockstmts.go#L213)
- ETag middleware — [cmd/dcrdata/internal/explorer/explorermiddleware.go:193](../../../cmd/dcrdata/internal/explorer/explorermiddleware.go#L193)
- Sibling `BlockStatus` SELECTs — [db/dcrpg/internal/blockstmts.go:180-203](../../../db/dcrpg/internal/blockstmts.go#L180-L203); sibling Scans — [db/dcrpg/queries.go:4091-4198](../../../db/dcrpg/queries.go#L4091-L4198)

See also:

- [/wiki/code-analysis/sidechain/flow.full.md](../sidechain/flow.full.md) (shares-pattern-with: same 4-reader `BlockStatus` Scan invariant, mirrored SELECT-skip-the-filter-column trick; differ on writer semantics and ETag wrap)
- [/wiki/code-analysis/sidechain/impact.md](../sidechain/impact.md) (shares-pattern-with: positional Scan blast across 4 endpoints)
- [/wiki/code-analysis/block/flow.full.md](../block/flow.full.md) (depends-on: `StoreBlock` is the writer entry point that calls `updateLastBlock`)
- [/wiki/code-analysis/block/impact.md](../block/impact.md) (depends-on: block-ingestion mutations are the writers for `is_valid=false` rows)
- [/wiki/code-analysis/time-based-blocks/impact.md](../time-based-blocks/impact.md) (shares-pattern-with: positional `rows.Scan` desync risk)
- [/wiki/code-analysis/page-rendering/patterns.md](../page-rendering/patterns.md) (depends-on: `*CommonPageData` embedding + block-scoped ETag cache used here)
- [/wiki/core/constraints.md](../../core/constraints.md) (depends-on: C1/C2/C3/C6/C8 explicitly out of scope — empty-amount page; re-imported if real-time or amount columns are ever added)
