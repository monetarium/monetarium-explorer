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
  - The same CHART `<select>` as `/charts`, with `Hashrate Shares` pre-selected; choosing any
    other option navigates to `/charts?chart={value}`. (So the new page is reachable from the
    `/charts` CHART dropdown *and* lets the user jump back.)
  - An INTERVAL pill group (All / Month / Week / Day).
  - An empty pie container (`<svg>` target) on one side and an empty table on the other.
- **`charts.tmpl`** — add `<option value="hashrate-shares">Hashrate Shares</option>` to the CHART
  `<select>`, positioned **between `hashrate` and `missed-votes`**. The charts controller's
  `selectChart` handler detects this value and navigates to `/hashrate-shares` instead of
  loading a Dygraph.
- **`public/js/controllers/hashrate_shares_controller.js`** — Stimulus controller:
  - Fetches `/hashrate-shares/data?interval=…` via the existing `requestJSON` http helper.
  - **Pie:** hand-rolled **SVG** arc paths (no new dependency — consistent with this repo's
    minimalist frontend). Full pie, no center hole. Each slice filled from a fixed categorical
    palette (25 distinct colors) + neutral gray for "Others".
  - **Rank labels:** placed at each slice's centroid **only when the label geometrically fits**
    (slice sweep angle ≥ a threshold derived from label size). This naturally numbers the
    largest slices (≥ 5 in typical distributions) and skips slivers. "Others" is never numbered.
  - **Table:** ≤ 25 rows (+ Others): rank · color swatch (same hex as the slice) · percent
    (1 dp) · middle-truncated reward address (`Vs1abc…wxyz`) linking to `/address/{addr}`.
    "Others" row has no rank/link.
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
- **Genesis coinbase** is excluded naturally (its outputs are invalid/zero-value and/or the
  block is filtered by the predicate; behavior matches `BackfillMiners`).

## 9. Testing

- **Go:** unit-test the pure `minerShares` function with exact-string assertions on the
  formatted percentages and ranks, including: empty input, single miner, exactly 25, > 25
  (Others aggregation), and a rounding boundary (e.g. a 0.04% miner → `0.0`). The DB query
  itself mirrors the already-shipped `BackfillMiners` predicate; DB-backed (`pgonline`) tests
  are optional and run only where the harness supports them.
- **JS (vitest):** test the controller's pure helpers — SVG arc-path math for representative
  share sets, the rank-fit threshold decision, address middle-truncation (exact strings), and
  deterministic color assignment. Test files live at `public/js/**/*.test.js`.

## 10. Out of scope

- Real-time websocket updates (the page computes on load / interval change only).
- Any change to the existing Dygraphs time-series charts.
- Per-coin (SKA) hashrate — not applicable (SKA is not mineable).
- Reusing or merging PR #460.
