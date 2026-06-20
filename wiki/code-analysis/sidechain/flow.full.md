# Sidechain Page (`/side`) — Full Flow

## Section 1 — Overview

`/side` lists every block currently flagged `is_mainchain=false` in the Postgres `blocks` table. It is a **read-only, single-query, server-rendered HTML page**: no WebSocket, no Stimulus controller, no real-time update — the rendered table is a snapshot at request time.

The page renders only **block-status metadata** (height, `is_valid`, hash, prev hash, next hash). It contains **no amounts, no per-coin maps, no fee data** — C1 (precision bifurcation) and the multi-coin / single-coin-tx invariants do **not** apply to this flow.

The page shares its return type (`[]*dbtypes.BlockStatus`) and reading shape with **three sibling endpoints** that read from the same `block_chain JOIN blocks` join with different `WHERE` clauses (`/disapproved`, `/block/{hash}` status lookup, height-keyed status lookups). That shared struct is the main mutation hazard.

## Section 2 — End-to-End Data Flow

```text
monetarium-node                                     ┐
   │ getchaintips RPC (status: valid-headers /      │  writer paths
   │  valid-fork)                                   │  (populate
   ▼                                                │   is_mainchain=false)
rpcutils.SideChains / SideChainFull                 │
   │                                                │
   ├── (A) startup, gated by cfg.ImportSideChains:  │
   │     ChainDB.MissingSideChainBlocks             │
   │     → CollectHash + StoreBlock(isMainchain=    │
   │       false) → insertBlock + insertBlockPrev   │
   │       Next                                     │
   │                                                │
   └── (B) live reorg:                              │
         Notifier.ReorgHandler                      │
         → db/dcrpg.ChainMonitor.ReorgHandler       │
         → switchToSideChain                        │
         → ChainDB.TipToSideChain                   │
         → setMainchainByBlockHash(hash, false)     │
           (+ updateTransactionsMainchain, votes,   │
            tickets, addresses)                     ┘

────────── read path (every /side request) ──────────

HTTP GET /side
   │
   ▼
chi router (cmd/dcrdata/main.go) → explorer.SideChains
   │
   ▼
explorerUI.dataSource.SideChainBlocks(ctx)
   │  (interface in cmd/dcrdata/internal/explorer/explorer.go)
   ▼
db/dcrpg.ChainDB.SideChainBlocks   ── queryTimeout context
   │
   ▼
retrieveSideChainBlocks
   │
   │  SELECT is_valid, height, previous_hash, hash, block_chain.next_hash
   │  FROM blocks
   │  JOIN block_chain ON this_hash=hash
   │  WHERE is_mainchain = FALSE
   │  ORDER BY height DESC;
   ▼
[]*dbtypes.BlockStatus  (5 of 6 fields populated; IsMainchain left zero)
   │
   ▼
templates.exec("sidechains", { CommonPageData, Data })
   │
   ▼
views/sidechains.tmpl  →  HTML response
```

## Section 3 — Per-Layer Breakdown

### Router

- **Location:** [cmd/dcrdata/main.go:735](../../../cmd/dcrdata/main.go#L735)
- **Code:** `r.Get("/side", explore.SideChains)` — no middleware, no `BlockHashPathOrIndexCtx`, no `CoinCtx`. The route is plain GET → handler.

### Handler

- **Location:** [cmd/dcrdata/internal/explorer/explorerroutes.go:273-296](../../../cmd/dcrdata/internal/explorer/explorerroutes.go#L273-L296)
- **Logic:** call `dataSource.SideChainBlocks(ctx)`; on context-deadline error, render the timeout error page via `exp.timeoutErrorPage`; on any other error, render `StatusPage(defaultErrorCode, "failed to retrieve side chain blocks", ...)`; otherwise execute the `"sidechains"` template with `{ *CommonPageData, Data []*dbtypes.BlockStatus }`.
- **No mutation, no derived fields, no per-coin handling.** The handler is a thin pass-through.

### DataSource interface

- **Location:** [cmd/dcrdata/internal/explorer/explorer.go:85](../../../cmd/dcrdata/internal/explorer/explorer.go#L85) — `SideChainBlocks(context.Context) ([]*dbtypes.BlockStatus, error)`
- **Test mock:** [cmd/dcrdata/internal/explorer/explorer_test.go:76](../../../cmd/dcrdata/internal/explorer/explorer_test.go#L76) — fan-out point if the signature ever changes (see [address/impact.md](../address/impact.md) for the analogous coin-filter signature fan-out lesson).

### ChainDB read method

- **Location:** [db/dcrpg/pgblockchain.go:852-857](../../../db/dcrpg/pgblockchain.go#L852-L857)
- **Behavior:** wraps `retrieveSideChainBlocks` in a `context.WithTimeout(ctx, pgb.queryTimeout)` and routes the cancellation error through `pgb.replaceCancelError` so the handler sees a recognizable timeout sentinel.

### SQL query + Scan

- **SQL:** [db/dcrpg/internal/blockstmts.go:180-184](../../../db/dcrpg/internal/blockstmts.go#L180-L184)
  ```sql
  SelectSideChainBlocks = `SELECT is_valid, height, previous_hash, hash, block_chain.next_hash
      FROM blocks
      JOIN block_chain ON this_hash=hash
      WHERE is_mainchain = FALSE
      ORDER BY height DESC;`
  ```
- **Scan:** [db/dcrpg/queries.go:4085-4097](../../../db/dcrpg/queries.go#L4085-L4097)
  ```go
  err = rows.Scan(&bs.IsValid, &bs.Height, &bs.PrevHash, &bs.Hash, &bs.NextHash)
  ```
- **Critical:** Scan is **positional and column-narrow**. Five columns map to five of the six struct fields. `bs.IsMainchain` is **never written** — left at its Go zero value (`false`). The WHERE clause already filters `is_mainchain=false`, so the template can treat all rows as side-chain, but anyone reading the returned slice elsewhere must remember `IsMainchain` is unreliable for this code path.

### `BlockStatus` shared struct

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
- **Reused by 4 SQL queries with different column subsets:**
  - `SelectSideChainBlocks` (this flow) — 5 cols, skips `is_mainchain`. See [db/dcrpg/internal/blockstmts.go:180-184](../../../db/dcrpg/internal/blockstmts.go#L180-L184).
  - `SelectBlockStatus` — 6 cols, all fields. See [db/dcrpg/internal/blockstmts.go:186-190](../../../db/dcrpg/internal/blockstmts.go#L186-L190) and [db/dcrpg/queries.go:4152-4157](../../../db/dcrpg/queries.go#L4152-L4157).
  - `SelectBlockStatuses` — 3 cols (height-keyed status lookup). See [db/dcrpg/internal/blockstmts.go:191-198](../../../db/dcrpg/internal/blockstmts.go#L191-L198) and the Scan around [db/dcrpg/queries.go:4160-4170](../../../db/dcrpg/queries.go#L4160-L4170).
  - `SelectDisapprovedBlocks` (`/disapproved` page) — 5 cols, skips `is_valid` (the WHERE already filters `is_valid=false`). See [db/dcrpg/internal/blockstmts.go:199-204](../../../db/dcrpg/internal/blockstmts.go#L199-L204).
- **Implication:** any reordering or addition of fields on `BlockStatus`, or any column reordering in any of these four queries, breaks at least one positional `Scan` silently (wrong field gets the value) or loudly (`sql.Scan: expected N destinations, got M`).

### Template

- **Location:** [cmd/dcrdata/views/sidechains.tmpl](../../../cmd/dcrdata/views/sidechains.tmpl)
- **Columns rendered:** `Height` (link to `/block/{hash}`), `PoS Approved` (`.IsValid`), `Parent` (`.PrevHash` → `/block/{prev}`), `Child` (`.NextHash` if set → `/block/{next}`; otherwise "none" with a `title="This block is the tip of its chain."`).
- **No JS controller is bound** beyond `data-controller="time"` (used by the navbar / time helpers, not by the side-chain table itself). The template has no `data-*` attributes for amounts and renders nothing that needs reconciling at the WebSocket layer.

### Writer paths (how rows reach `is_mainchain=false`)

There are **two and only two** writer paths that populate the rows /side reads:

1. **Startup batch import** (gated by the `ImportSideChains` config flag).
   - Flag definition: [cmd/dcrdata/config.go:147](../../../cmd/dcrdata/config.go#L147) — marked *experimental*, defaults to `false`. Env: `DCRDATA_IMPORT_SIDE_CHAINS`.
   - Caller: [cmd/dcrdata/main.go:855-927](../../../cmd/dcrdata/main.go#L855-L927). Calls `chainDB.MissingSideChainBlocks(ctx)` then loops over each `SideChain.Hashes`, calls `collector.CollectHash(&blockHash)` + `chainDB.StoreBlock(msgBlock, /*isValid*/ true, /*isMainchain*/ false, ...)`.
   - `MissingSideChainBlocks`: [db/dcrpg/pgblockchain.go:341-401](../../../db/dcrpg/pgblockchain.go#L341-L401) — drives off `rpcutils.SideChains(pgb.Client)` (filters `getchaintips` results by status `valid-headers` / `valid-fork`, see [rpcutils/rpcclient.go:315-322](../../../rpcutils/rpcclient.go#L315-L322)) and walks each tip backwards via `rpcutils.SideChainFull` ([rpcutils/rpcclient.go:334-371](../../../rpcutils/rpcclient.go#L334-L371)).
   - `StoreBlock` writes a `block_chain` row for each side-chain block with `isMainchain=false`. The `block_chain` row is inserted via `insertBlockPrevNext` ([db/dcrpg/queries.go:3969](../../../db/dcrpg/queries.go#L3969)). Side-chain blocks **skip** the `updateLastBlock` chain-linking when the previous block is mainchain ([db/dcrpg/pgblockchain.go:4056-4085](../../../db/dcrpg/pgblockchain.go#L4056-L4085)) — so /side rows whose `PrevHash` points at a mainchain block correctly leave the mainchain block's `next_hash` alone.

2. **Live reorg** (every running instance, no flag).
   - Notifier registers reorg handlers at [cmd/dcrdata/main.go:1036-1038](../../../cmd/dcrdata/main.go#L1036-L1038).
   - `db/dcrpg.ChainMonitor.ReorgHandler` ([db/dcrpg/chainmonitor.go:139-175](../../../db/dcrpg/chainmonitor.go#L139-L175)) sets `InReorg=true`, calls `switchToSideChain(reorg)` ([db/dcrpg/chainmonitor.go:34-…](../../../db/dcrpg/chainmonitor.go#L34)).
   - `switchToSideChain` → `ChainDB.TipToSideChain(mainRoot)` ([db/dcrpg/pgblockchain.go:3689](../../../db/dcrpg/pgblockchain.go#L3689)) walks from the current tip down to the common ancestor, calling `setMainchainByBlockHash(tipHash, false)` ([db/dcrpg/queries.go:4301-4304](../../../db/dcrpg/queries.go#L4301-L4304), backed by `UpdateBlockMainchain` in [db/dcrpg/internal/blockstmts.go:214](../../../db/dcrpg/internal/blockstmts.go#L214)) for each block. The same loop also flips `is_mainchain` on transactions, votes, tickets, addresses, and clears spent-vout markers via `clearVoutAllSpendTxRowIDs`.
   - The new mainchain branch then comes in through the normal block-connect path.

**Observation:** the reorg writer path mutates only the `blocks.is_mainchain` column on existing rows; it does **not** insert new `block_chain` rows for the demoted blocks (they already exist from when they were mainchain). The startup import path is the only one that *inserts* fresh `block_chain` rows for side blocks the explorer has never seen as mainchain.

## Section 4 — Cross-Layer Dependencies

- **Handler ↔ DataSource interface:** the `SideChainBlocks(ctx)` method is one of ~30 methods on the `dataSource` interface ([cmd/dcrdata/internal/explorer/explorer.go:80-110](../../../cmd/dcrdata/internal/explorer/explorer.go#L80-L110)). The test mock at [cmd/dcrdata/internal/explorer/explorer_test.go:76](../../../cmd/dcrdata/internal/explorer/explorer_test.go#L76) must track the signature.
- **SQL ↔ Scan ↔ Struct:** **three independent files** must stay in lockstep — `blockstmts.go` (SELECT column list), `queries.go` (`rows.Scan` destinations), `db/dbtypes/types.go` (struct field order/types). Positional binding means a one-line edit in any of the three can silently rewire data into the wrong field.
- **Struct ↔ Sibling readers:** because `BlockStatus` is the return type of four different SQL functions with four different column subsets, a struct change ripples into `SideChainBlocks`, `DisapprovedBlocks`, `BlockStatus(hash)`, and `BlockStatuses(height)`. Two of those are page handlers (`/side`, `/disapproved`), two feed the `/block/{hash}` rendering and stakeholder approval checks (see [cmd/dcrdata/internal/explorer/explorerroutes.go:730](../../../cmd/dcrdata/internal/explorer/explorerroutes.go#L730)).
- **Writer races:** a reorg can flip `is_mainchain` on rows mid-request. The page is best-effort consistent (each row reflects its current `is_mainchain`/`next_hash` state). No locking ties the read against `TipToSideChain`. Because the query is short, the practical window is small, but `next_hash` may briefly point at a hash whose own `is_mainchain` has just been flipped.

## Section 5 — Critical Constraints

This is one of the few pages where **most repository invariants do NOT apply**:

- **C1 (precision bifurcation):** *Does not apply.* No amounts, no SKA, no per-coin maps. Don't add amount columns to this page without first reading C1 and adopting the SKA-string pipeline used elsewhere (`address`, `block`, `mempool`, `charts`).
- **C3 (template + WebSocket parity):** *Does not apply by absence* — there is no WebSocket transport for this page. Adding live updates would force C3/C8 reconciliation against a new push path.
- **C8 (dual-transport shape asymmetry):** *Does not apply* — single HTTP transport.

What **does** apply:

- **Positional `rows.Scan` invariant** (recurs across the codebase; see [time-based-blocks/impact.md](../time-based-blocks/impact.md) for the analogous risk in time-grouped block flows). Column order in `SelectSideChainBlocks` must match Scan destination order in `retrieveSideChainBlocks` must match the documented struct field ordering it depends on.
- **Single-coin invariant** is *trivially satisfied* — side-chain blocks contain whatever transactions they contain, but this page renders no transaction or amount data, so the invariant cannot be violated *here*. It re-emerges if you ever add a "Tx count by coin type" column.
- **`ImportSideChains` is off by default.** The /side page is an empty table unless either (a) a reorg occurred since this instance started, or (b) the operator explicitly opted into startup import. This is a product-visible constraint, not a code one.

## Section 6 — Mutation Impact

When modifying anything in this flow, check:

1. **`BlockStatus` struct field order or type** — breaks 4 positional `Scan`s and 2 templates (`sidechains.tmpl`, `disapproved.tmpl`). Loud at Scan time if column count changes; **silent** if field types stay compatible (bool/bool, ChainHash/ChainHash). Always confirm by reading every `rows.Scan(&bs....)` in `db/dcrpg/queries.go` after a struct edit.
2. **`SelectSideChainBlocks` column list** — must update `retrieveSideChainBlocks` `rows.Scan` in lockstep, otherwise loud Scan error or silent column shift.
3. **`retrieveSideChainBlocks` Scan order** — same.
4. **Template field references** — adding/removing struct fields breaks `{{.Field}}` references at template-parse time (loud, but only at request time, not build time — there is no Go-level type check on Go templates).
5. **`StoreBlock(isMainchain=false)` path** — the *only* code that inserts new side-chain rows via the startup import. If you refactor `insertBlockPrevNext`, the `block_chain.next_hash`-NULL invariant for side-chain tips (used by the template's `{{if .NextHash}}…{{else}}none{{end}}` branch) can drift.
6. **`TipToSideChain` / `setMainchainByBlockHash`** — these are the *only* writers that move existing rows from main to side under live conditions. If their atomicity changes (e.g. a per-row transaction is removed), the /side page may render partially-demoted rows.
7. **Adding a real-time element (WebSocket push, Stimulus controller)** — instantly imports C3/C8/C4 into this domain. Don't bolt on WS updates without designing a dedicated message shape and a `data-controller` clone-template flow ([core/constraints.md](../../core/constraints.md) C6).

**Silent failures:**

- Column-order swap (e.g. swapping `is_valid` and `height` in either the SELECT or the Scan): the page renders nonsense in the "PoS Approved" column without throwing. Caught only by visual inspection.
- Adding `is_mainchain` back into the SELECT column list **without** also adding `&bs.IsMainchain` to Scan: loud Scan error. Adding to Scan **without** updating SELECT: same error in the other direction.
- Reorg occurring mid-request: a row whose `is_mainchain` was just flipped to `true` may still appear in the result set if the WHERE was evaluated pre-flip. Cosmetic; resolves on next refresh.
- `ImportSideChains=false` operator default: page silently empty even when the node knows of side chains. **Not a bug — by design.**

**Hard failures:**

- Removing `is_mainchain` from the `blocks` table or the JOIN column from `block_chain`: SQL error on every request to `/side`, `/disapproved`, and any `BlockStatus` lookup.
- Renaming `BlockStatus` fields without updating `sidechains.tmpl` / `disapproved.tmpl`: template-execute error rendered as `StatusPage(defaultErrorCode, ...)`.
- `queryTimeout` set too low for an indexed scan over a large `blocks` table: `timeoutErrorPage` triggers and the user sees a timeout page.

## Section 7 — Common Pitfalls

- **Assuming `bs.IsMainchain` is populated by `SideChainBlocks`.** It isn't — the SQL omits the column. Anyone consuming the returned slice downstream and reading `IsMainchain` will see `false` for every row, which is *coincidentally correct* for this query but is **not** a contract — a future query change that introduces non-side rows would silently mislabel them. If you need to be sure, re-derive from the WHERE clause, not from the field.
- **Bolt-on amount columns.** Tempting to add "tx count" / "value transferred" columns to make the page richer. That immediately re-invites C1, C7, and the SKA-string pipeline. Don't add amounts to `BlockStatus`; build a separate row type if needed.
- **Refactor `BlockStatus` "to clean it up".** It looks like a small inert DTO but is load-bearing across 4 SQL functions, 2 pages, and the `/block/{hash}` status display. Treat it as an *external* contract.
- **Confusing the two writer paths.** Startup `ImportSideChains` and live reorg `TipToSideChain` are independent. Side-chain blocks discovered by the node *before* this instance started will not appear unless `ImportSideChains=true`. A reorg during runtime *will* populate side rows regardless of the flag.
- **Trusting `block_chain.next_hash` for side blocks at all times.** It is populated only when a *later* block on the same side chain is inserted via `StoreBlock` → `updateLastBlock`. Side-chain tips have NULL `next_hash` by design, which the template handles with the `none` branch.

## Section 8 — Evidence

- Route registration — [cmd/dcrdata/main.go:735](../../../cmd/dcrdata/main.go#L735)
- Handler — [cmd/dcrdata/internal/explorer/explorerroutes.go:273-296](../../../cmd/dcrdata/internal/explorer/explorerroutes.go#L273-L296)
- Interface — [cmd/dcrdata/internal/explorer/explorer.go:85](../../../cmd/dcrdata/internal/explorer/explorer.go#L85)
- Test mock — [cmd/dcrdata/internal/explorer/explorer_test.go:76](../../../cmd/dcrdata/internal/explorer/explorer_test.go#L76)
- ChainDB read method — [db/dcrpg/pgblockchain.go:852-857](../../../db/dcrpg/pgblockchain.go#L852-L857)
- SQL — [db/dcrpg/internal/blockstmts.go:180-204](../../../db/dcrpg/internal/blockstmts.go#L180-L204)
- Scan — [db/dcrpg/queries.go:4075-4097](../../../db/dcrpg/queries.go#L4075-L4097)
- Struct — [db/dbtypes/types.go:2274-2282](../../../db/dbtypes/types.go#L2274-L2282)
- Template — [cmd/dcrdata/views/sidechains.tmpl](../../../cmd/dcrdata/views/sidechains.tmpl)
- Startup import — [cmd/dcrdata/main.go:855-927](../../../cmd/dcrdata/main.go#L855-L927); [cmd/dcrdata/config.go:147](../../../cmd/dcrdata/config.go#L147)
- `MissingSideChainBlocks` — [db/dcrpg/pgblockchain.go:341-401](../../../db/dcrpg/pgblockchain.go#L341-L401)
- `rpcutils.SideChains` / `SideChainFull` — [rpcutils/rpcclient.go:315-371](../../../rpcutils/rpcclient.go#L315-L371)
- `StoreBlock` writer — [db/dcrpg/pgblockchain.go:3822-4055](../../../db/dcrpg/pgblockchain.go#L3822-L4055)
- `updateLastBlock` side-chain guard — [db/dcrpg/pgblockchain.go:4056-4085](../../../db/dcrpg/pgblockchain.go#L4056-L4085)
- Reorg handler chain — [cmd/dcrdata/main.go:1036-1038](../../../cmd/dcrdata/main.go#L1036-L1038); [db/dcrpg/chainmonitor.go:139-175](../../../db/dcrpg/chainmonitor.go#L139-L175)
- `TipToSideChain` — [db/dcrpg/pgblockchain.go:3689](../../../db/dcrpg/pgblockchain.go#L3689)
- `setMainchainByBlockHash` — [db/dcrpg/queries.go:4301-4304](../../../db/dcrpg/queries.go#L4301-L4304); UpdateBlockMainchain SQL — [db/dcrpg/internal/blockstmts.go:214](../../../db/dcrpg/internal/blockstmts.go#L214)

See also:

- [/wiki/code-analysis/disapproved-blocks/flow.full.md](../disapproved-blocks/flow.full.md) (shares-pattern-with: structural twin — same `BlockStatus` shared struct, same 4-reader Scan invariant, mirrored filter-skip-in-SELECT trick; differs on writer semantics (`updateLastBlock` vote-bit cascade vs reorg + startup import) and on `withCache` ETag wrap (which `/disapproved` has and `/side` does not))
- [/wiki/code-analysis/disapproved-blocks/impact.md](../disapproved-blocks/impact.md) (shares-pattern-with: `BlockStatus` 4-reader Scan blast; mirrored `IsValid` Scan-default trap vs this trace's `IsMainchain` Scan-default trap)
- [/wiki/code-analysis/block/flow.full.md](../block/flow.full.md) (shares-pattern-with: `BlockStatus` is also consumed by block-detail status lookups)
- [/wiki/code-analysis/block/impact.md](../block/impact.md) (depends-on: block-ingestion mutations are the writers for side-chain rows too)
- [/wiki/code-analysis/time-based-blocks/impact.md](../time-based-blocks/impact.md) (shares-pattern-with: positional `rows.Scan` desync risk)
- [/wiki/code-analysis/page-rendering/patterns.md](../page-rendering/patterns.md) (depends-on: `*CommonPageData` embedding used by the handler)
- [/wiki/core/constraints.md](../../core/constraints.md) (depends-on: C1 does NOT apply here — explicitly out of scope; C6 applies *if* a real-time element is ever added)
