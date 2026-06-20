# Disapproved Blocks Page (`/disapproved`) — Compact Knowledge

**Flow:** new-block ingest → `StoreBlock.updateLastBlock` (flips `blocks.is_valid=false` on parent when vote-bit 0 is clear, cascades to vins/transactions/addresses/voutmarkers) → HTTP `GET /disapproved` (wrapped in `ETagAndLastModifiedIntercept`) → `explorerUI.DisapprovedBlocks` → `ChainDB.DisapprovedBlocks` → `retrieveDisapprovedBlocks` (`SELECT is_mainchain, height, previous_hash, hash, block_chain.next_hash FROM blocks JOIN block_chain ON this_hash=hash WHERE is_valid = FALSE ORDER BY height DESC`) → positional `rows.Scan` into `*dbtypes.BlockStatus` (skips `IsValid`) → `views/disapproved.tmpl` renders `Height / Main Chain / Parent / Child`.

**Key Architectural Patterns:**

- **`BlockStatus` shared struct, 4 readers, 4 column subsets.** `retrieveDisapprovedBlocks` (5 cols, skips `is_valid`), `retrieveSideChainBlocks` (5 cols, skips `is_mainchain`), `retrieveBlockStatus` (6 cols), `retrieveBlockStatuses` (3 cols + external `Height`). Each list endpoint pre-trims its filter column from the SELECT because the WHERE clause already pins it. Positional `rows.Scan` keeps the three files — `blockstmts.go`, `queries.go`, `db/dbtypes/types.go` — silently coupled.
- **Single, always-on writer = `updateLastBlock`.** Unlike `/side` (two writers: reorg + opt-in startup import), `/disapproved` rows appear via the normal block-connect path: when `msgBlock.Header.VoteBits & 1 == 0`, the parent's `is_valid` is flipped to `false` and the change cascades to `vins`, `transactions`, `addresses`, and `vouts.spend_tx_row_id`. No flag, no opt-in.
- **Block-scoped HTTP cache.** `/disapproved` is mounted under `withCache` (`ETagAndLastModifiedIntercept`); `/side` is **not**. Disapprovals only change on new-block notifications, which is the same trigger that invalidates the cache, so caching is coherent.
- **No amounts, no JS, no WS.** C1, C2, C3, C6, C8 all out of scope. `data-controller="time"` is the only Stimulus binding (navbar/time helpers).

**Critical Constraints:**

- `bs.IsValid` is **never written by Scan** in this path — reading it downstream is reading a Go zero value, not a queried column. The WHERE clause is the only ground truth.
- Positional `rows.Scan` invariant: column order in `SelectDisapprovedBlocks` ↔ Scan destination order ↔ `BlockStatus` field order. A one-line edit in any of the three can rewire data silently.
- ETag cache invalidation is keyed on new-block notifications. A future field driven by any other trigger (mempool, exchange, governance) would serve stale.

**Mutation Checklist:**

1. Touching `BlockStatus` struct → re-check 4 `rows.Scan`s and 2 templates (`disapproved.tmpl`, `sidechains.tmpl`).
2. Touching `SelectDisapprovedBlocks` columns → update Scan in `retrieveDisapprovedBlocks` in the same edit.
3. Adding `{{.IsValid}}` to the template → must restore `is_valid` to the SELECT and Scan, else silently renders `false` everywhere.
4. Touching `updateLastBlock` vote-bit logic → this is the only writer; a silent no-op empties the page on new blocks (no SQL error).
5. Adding a field driven by anything other than new-block → break ETag invalidation or move off `withCache`.
6. Adding real-time updates → imports C3/C6/C8; needs a dedicated WS message and a `data-controller` clone-template flow.
7. Adding amounts → imports C1/C7; do not extend `BlockStatus`; build a new row type with SKA-string pipeline.
8. Renaming the template or the dataSource method → update [explorer.go:396](../../../cmd/dcrdata/internal/explorer/explorer.go#L396) and [explorer_test.go:79](../../../cmd/dcrdata/internal/explorer/explorer_test.go#L79) mock.
