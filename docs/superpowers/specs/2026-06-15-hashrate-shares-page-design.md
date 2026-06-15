# Hashrate Shares page — design spec

**Issue:** #468 — `[CHARTS] New "Hashrate Shares" page: per-miner hashrate-share pie chart + table`
**Date:** 2026-06-15
**Status:** Approved design, ready for implementation plan.

> **Independent implementation.** This spec is developed independently and does **not**
> derive from PR #460 / `feat/hashrate-shares-chart`. The backend query reuses the
> coinbase-reward-address predicate from the existing `BackfillMiners` statement already
> on `develop` (`db/dcrpg/internal/minerstmts.go`), which is the codebase's canonical
> definition of a miner-reward output.

---

## 1. Goal

Add a standalone explorer page, **"Hashrate Shares"**, that visualizes each miner's share of
total network hashrate, approximated from PoW Reward (coinbase) transactions over a
selectable period. The page is a full pie chart (no donut hole) plus a ranked table, with an
INTERVAL switcher (All / Month / Week / Day).

Hashrate share is approximated as **share of coinbase (block-reward) transactions**: a miner
that found a larger fraction of blocks in the period is assumed to hold a larger fraction of
hashrate. This is exact only over long windows; for short windows (e.g. "Day") with few blocks
it is a noisy estimate. This approximation is an explicit product decision from the issue.

## 2. Definition of a "PoW Reward transaction" and its recipient

Reuse the exact predicate the codebase already uses in `BackfillMiners`:

- **Coinbase tx:** `transactions.tree = 0 AND transactions.block_index = 0 AND transactions.is_mainchain = true`.
- **Recipient (miner reward address):** `vouts.script_addresses`, restricted to
  `script_type IN ('pubkeyhash','scripthash','pubkey','pubkeyalt','pubkeyhashalt')`,
  `value > 0`, `script_addresses` non-null, not `''`/`'unknown'`, and not a multisig set
  (`NOT LIKE '{%}'`).

Notes:
- Coinbases are VAR-only (SKA coins are not mineable), so no coin-type filter is needed —
  consistent with `BackfillMiners`.
- `value > 0` excludes zero-value outputs (e.g. block-commitment / OP_RETURN style outputs).
- Counting is **strictly** from coinbase txs; other tx types paid to the same address are
  excluded by construction (the predicate only matches coinbase outputs).

## 3. Share computation

For a period with lower height bound `minHeight`:

```sql
SELECT sub.addr, COUNT(*)::INT AS reward_tx_count
FROM (
  SELECT DISTINCT v.script_addresses AS addr, t.block_height AS height
  FROM vouts v
  JOIN transactions t ON v.tx_hash = t.tx_hash
  WHERE t.tree = 0
    AND t.block_index = 0
    AND t.is_mainchain = true
    AND t.block_height >= $1
    AND v.script_type IN ('pubkeyhash','scripthash','pubkey','pubkeyalt','pubkeyhashalt')
    AND v.value > 0
    AND v.script_addresses IS NOT NULL
    AND v.script_addresses NOT IN ('', 'unknown')
    AND v.script_addresses NOT LIKE '{%}'
) sub
GROUP BY sub.addr
ORDER BY reward_tx_count DESC;
```

- `DISTINCT (addr, height)` collapses multi-output coinbases to a single count per (address,
  block), so a miner counts once per block it found.
- **Total** = Σ of all per-address `reward_tx_count` (sum across *all* addresses, not just the
  top 25). This makes per-address shares sum to ~100%. In practice each coinbase pays one
  address so this equals the number of coinbase blocks in the period.
- **Share** = `reward_tx_count / total`, formatted to **one decimal place** (e.g. `32.2%`).
  Shares below `0.05%` display as `0.0%`.

### Top-25 + "Others"
- Sort descending by count, keep the **top 25** addresses.
- Aggregate the remaining addresses into a single **"Others"** entry:
  `count = total − Σ(top-25 counts)`, share computed the same way.
- "Others" is appended after the top 25 (its own pie slice in neutral gray and its own table
  row, with no rank number and no address link). It is encoded with the sentinel `rank = 0`
  and `isOthers = true`. It is omitted entirely when there are ≤ 25 miners.

## 4. Interval → height window

The INTERVAL switcher selects the period relative to the latest block:

| Option | Window |
| ------ | ------ |
| Day    | last 24h |
| Week   | last 7 days |
| Month  | last 30 days |
| All    | from genesis (`minHeight = 0`) |

Mechanics (mirrors the existing home-page active-miner-count path):
1. Read the latest block time from the explorer's cached tip (`pageData.BlockInfo.BlockTime`).
2. Subtract the interval to get the window-start time. (For "All", skip to `minHeight = 0`.)
3. Map the window-start time to a start height via the existing
   `explorerDataSource.GetHeightByTimestamp(ctx, t)` (returns `0` when before genesis).
4. Pass `minHeight` to the new query.

Default interval on first load: **All** (matches the existing ZOOM/INTERVAL default convention
of "all").

## 5. Backend wiring

- **New SQL statement** in `db/dcrpg/internal/minerstmts.go` (e.g. `SelectMinerRewardCountsSince`),
  built from the query in §3.
- **New `ChainDB` method** in `db/dcrpg` (e.g. `MinerHashrateShares(ctx, minHeight int64) ([]dbtypes.MinerRewardCount, error)`),
  next to `ActiveMiners`. Returns raw `(address, count)` rows ordered desc.
- **New shared type** in `db/dbtypes`: `MinerRewardCount{ Address string; Count int64 }`.
- **Interface method** added to `explorerDataSource` (`cmd/dcrdata/internal/explorer/explorer.go`),
  next to `ActiveMiners`, plus the matching method on the `mockDataSource` test fake in
  `explorer_test.go`.
- **Pure share-math function** (in the explorer package), independently unit-testable:
  `func minerShares(rows []dbtypes.MinerRewardCount) []MinerShareView`
  → ranks, computes 1-dp percentages, caps at 25, appends "Others". `MinerShareView` carries
  `Rank int, Address string, Count int64, Percent string` (and an `IsOthers bool`). Percent is
  pre-formatted to a 1-dp string so the formatting is asserted exactly in tests.

## 6. Routes & data delivery

- **Page route:** `GET /hashrate-shares` → new explorer handler `HashrateShares` rendering
  `hashrate_shares.tmpl`. Registered in `main.go` in the `SyncStatusPageIntercept` page group,
  alongside `/charts`.
- **Data endpoint:** `GET /hashrate-shares/data?interval={all|month|week|day}` → new explorer
  JSON handler returning:
  ```json
  {
    "interval": "all",
    "total": 12345,
    "miners": [
      { "rank": 1, "address": "Vs...", "count": 4000, "percent": "32.4", "isOthers": false },
      ...
      { "rank": 0, "address": "", "count": 120, "percent": "1.0", "isOthers": true }
    ]
  }
  ```
  The controller fetches this on connect (default interval) and on each INTERVAL change, then
  re-renders the pie + table client-side. No full page reload on interval switch.

## 7. Frontend

New standalone page (no coupling to `charts_controller.js`):

- **`views/hashrate_shares.tmpl`** — page shell with:
  - Built on `commonData` like every other explorer page, so the canonical URL and title
    (`"Monetarium Hashrate Shares"`) are handled by the shared `html-head` / `CommonPageData`
    machinery. No new breadcrumb/sitemap/active-nav infrastructure is introduced — the project
    has none, and this page follows the existing pages' conventions exactly.
  - The same CHART `<select>` as `/charts`, with `Hashrate Shares` pre-selected; choosing any
    other option navigates to `/charts?chart={value}`. (So the new page is reachable from the
    `/charts` CHART dropdown *and* lets the user jump back.)
  - An INTERVAL pill group (All / Month / Week / Day).
  - A short caption clarifying that shares are computed **per reward address** — a single mining
    operator that rotates payout addresses appears as several entries. (Consistent with the
    explorer's existing miner notion: the `miners` table is keyed by reward address.)
  - An empty pie container (`<svg>` target) on one side and an empty table on the other.
- **`charts.tmpl`** — add `<option value="hashrate-shares">Hashrate Shares</option>` to the CHART
  `<select>`, positioned **between `hashrate` and `missed-votes`**. The charts controller's
  `selectChart` handler detects this value and navigates to `/hashrate-shares` instead of
  loading a Dygraph.
- **`public/js/controllers/hashrate_shares_controller.js`** — Stimulus controller:
  - Fetches `/hashrate-shares/data?interval=…` via the existing `requestJSON` http helper.
  - **Pie:** hand-rolled **SVG** arc paths (no new dependency — consistent with this repo's
    minimalist frontend). Full pie, no center hole. Each slice filled by index from a **fixed
    25-entry color array defined in the controller** (following the existing per-controller
    `colors: [...]` convention used by `address_controller.js`, `charts_controller.js`, etc.) +
    neutral gray for "Others". The palette is chosen to be visually distinct in both light and
    dark themes. (No formal WCAG-contrast conformance is mandated — the project's existing charts
    do not impose one, and adding it would be a new project-wide standard out of scope here.)
  - **Rank labels:** placed at each slice's centroid **only when the label geometrically fits**
    (slice sweep angle ≥ a threshold derived from label size). This naturally numbers the
    largest slices (≥ 5 in typical distributions) and skips slivers. Because slivers are never
    numbered, the "a `#24` label floating on an invisible slice" failure mode cannot occur — a
    rank number only appears where its slice is large enough to hold it. "Others" is never numbered.
  - **Table:** ≤ 25 rows (+ Others). Columns: rank · color swatch (same hex as the slice) ·
    percent (1 dp) · reward address. The address column header reads **"Reward Address"** (the
    issue's own term, and accurate — these are payout addresses, not necessarily distinct
    operators). The address is middle-truncated (`Vs1abc…wxyz`) and links to `/address/{addr}`.
    The "Others" row has no rank number and no link.
  - Pure helpers split out for unit testing: arc-path geometry, rank-fit decision, address
    middle-truncation, deterministic color-by-index assignment.
- **`public/scss/`** — styles for the pie/table layout (two-column on wide screens, stacked on
  narrow), color-swatch cell, truncated-address cell. Must work in light and dark themes.
- **Entry registration** — register the new controller in the JS entry/manifest the same way
  existing controllers are registered.

## 8. Edge cases

- **No miners in period** (empty result, e.g. very short window with no blocks): render an
  empty-state message in place of the pie/table; `total = 0`, no divide-by-zero (guard the
  share math when `total == 0`).
- **Single miner:** one full-circle slice; SVG full-circle path needs the two-arc / `A`-flag
  handling for a 360° sweep (a single `path` arc cannot represent a full circle — use a circle
  element or split into two semicircle arcs).
- **> 25 miners:** top 25 + Others (§3).
- **Rounding:** displayed 1-dp shares may sum to 99.9–100.1; not force-normalized.
- **Genesis coinbase:** behavior is **identical to the existing miner-tracking path** because
  the windowed query reuses the same predicate as `BackfillMiners` / the live `upsertMiner`
  sync path. Whatever the genesis block's coinbase resolves to under that predicate, this page
  counts it exactly as the rest of the explorer already does (e.g. the home-page active-miner
  count) — so there is no off-by-one *relative to the explorer's own numbers*. The earlier draft
  claimed genesis is "excluded naturally"; that was an unverified assumption and is dropped. The
  actual genesis inclusion/exclusion is confirmed against the live DB during implementation (a
  one-row check on the genesis coinbase), and noted in the implementation, but it does not block
  the design since consistency with existing tracking is guaranteed by predicate reuse.

## 9. Performance considerations

The **"All"** interval is the heaviest path: with `minHeight = 0` the query scans every
mainchain coinbase over the full chain, joins to `vouts`, and groups by address. As the chain
grows this could become one of the explorer's heavier pages.

- **Verify the query plan during implementation.** Run `EXPLAIN ANALYZE` for the "All" query on
  a realistic DB. The coinbase predicate (`tree = 0 AND block_index = 0`) is not served by the
  existing `transactions(block_hash, block_index, tree)` index for a height-range/full scan, so
  a seq scan is plausible. If so, add a supporting index — e.g. a partial index
  `CREATE INDEX ... ON transactions (block_height) WHERE tree = 0 AND block_index = 0` — as a
  normal schema/index addition (the codebase already manages such indexes in
  `db/dcrpg/internal/indexes.go`). (Note: DB-backed tests are not reliably runnable in this
  environment per project notes, so the EXPLAIN check may have to run wherever a seeded DB is
  available.)
- **Windowed intervals (Day/Week/Month)** touch only recent heights and are bounded; they are
  not a concern beyond the same index consideration.
- **Caching:** the result changes at most once per new block. A short-TTL / per-interval cache
  (invalidated on new block, like the existing chart caches) is an available optimization if the
  scan cost is material. Not required for correctness.
- **Fast-path fallback for "All":** the existing `miners` table already maintains a live,
  backfilled all-time `blocks_mined` per reward address (incrementally via `upsertMiner`), so
  `SELECT address, blocks_mined FROM miners ORDER BY blocks_mined DESC` answers the "All" case
  without any chain scan. **Caveat:** `blocks_mined` increments once per reward *output*, whereas
  the issue's definition counts reward *transactions* — these differ only for the rare coinbase
  that pays the same address in multiple outputs. The default design keeps the single, exact
  DISTINCT-scan path for definitional fidelity; the `miners` table is documented here as a ready
  fallback if "All" scan cost proves prohibitive in production, accepting the minor counting
  nuance. The choice is finalized in the implementation plan against the measured query cost.

## 10. Accessibility note

No formal accessibility/WCAG standard is introduced — the project's existing charts do not have
one, and adding a project-wide standard is out of scope for this issue. The design does, however,
inherently avoid color being the *sole* carrier of information: the table conveys the full data
(rank number, exact percentage, and reward address) independently of the pie's colors. Basic,
zero-cost niceties already used elsewhere (a page `<title>`, sensible link text) apply as normal.

## 11. Testing

- **Go:** unit-test the pure `minerShares` function with exact-string assertions on the
  formatted percentages and ranks, including: empty input, single miner, exactly 25, > 25
  (Others aggregation), and a rounding boundary (e.g. a 0.04% miner → `0.0`). The DB query
  itself mirrors the already-shipped `BackfillMiners` predicate; DB-backed (`pgonline`) tests
  are optional and run only where the harness supports them.
- **JS (vitest):** test the controller's pure helpers — SVG arc-path math for representative
  share sets, the rank-fit threshold decision, address middle-truncation (exact strings), and
  deterministic color assignment. Test files live at `public/js/**/*.test.js`.

## 12. Out of scope

- Real-time websocket updates (the page computes on load / interval change only).
- Any change to the existing Dygraphs time-series charts.
- Per-coin (SKA) hashrate — not applicable (SKA is not mineable).
- Reusing or merging PR #460.
- New project-wide standards: formal WCAG/accessibility conformance, breadcrumbs, a sitemap, or
  a top-nav active-state mechanism. The project has none of these today; this page follows the
  existing pages' conventions and does not introduce them.

## 13. Review-feedback dispositions

Recorded so the deliberate choices are traceable.

| # | Review point | Disposition |
| - | ------------ | ----------- |
| 1 | "All"-mode query performance | **Accepted** — added §9 Performance considerations (EXPLAIN plan, optional partial index, caching, `miners`-table fallback). |
| 2 | "miner" vs "reward address" terminology | **Accepted** — column header "Reward Address" + page caption; feature title stays "Hashrate Shares" per the issue. |
| 3 | Unproven genesis claim | **Accepted** — dropped the hand-wave; tied to predicate-reuse consistency, exact behavior verified during implementation (§8). |
| 4 | Define the color palette | **Accepted** — fixed 25-entry array in the controller (existing per-controller `colors:` convention). |
| 4 | WCAG conformance in dark theme | **Rejected** — would introduce a new project-wide standard; project's charts have none. Palette only required to be visually distinct (§7, §10, §12). |
| 5 | Rounding vs rank labels on tiny slices | **Accepted (already mitigated)** — the fit-rule never numbers slivers (§7). |
| 6 | Canonical URL / page title | **Accepted** — handled via `commonData` like every page (§7). |
| 6 | Breadcrumbs / sitemap / active-nav | **Rejected** — patterns the project does not have (§12). |
| — | Dedicated Accessibility section | **Rejected as a new standard**, but the design already keeps data non-color-only via the table (§10). |
