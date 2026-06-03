# Windows — Compact Knowledge

**One-line flow:**
`blocks` table → `SelectWindowsByLimit` SQL bucket → `retrieveWindowBlocks` Scan + `parseCoinTxStats` → `BlocksGroupedInfo` → `(*ChainDB).PosIntervals` → `dataSource.PosIntervals` → `StakeDiffWindows` handler → `views/windows.tmpl` → HTML. No REST, no WebSocket.

**Key architectural patterns:**

- **DB-side integer-division bucketing.** Windows are formed by SQL
  `GROUP BY (height/$1)*$1` with `$1 = chainParams.StakeDiffWindowSize`
  (default 144), filtered to `is_mainchain`. No Go-side re-aggregation.
- **Multi-coin tx-count reconciliation.** `JSONB_AGG(coin_tx_stats)` carries
  per-coin `tx_count`; `parseCoinTxStats` sums it and overrides flat
  `SUM(num_rtx)` when larger. Lenient unmarshal — falls back to flat count on
  empty/padded/error JSON (intentional for pre-multi-coin history).
- **Shared `BlocksGroupedInfo` struct.** Same struct populated from a
  different SQL by the time-based-blocks listing — a cross-domain contract,
  not a per-flow type.
- **Legacy VAR-only render path.** `TicketPrice int64` atoms →
  `toFloat64Amount` (= `dcrutil.Amount.ToCoin() float64`) at the template
  boundary. SKA-safe pipeline is **not** used here; routing SKA atoms through
  this helper silently loses precision.
- **Triple-bound pagination.** Handler computes `bestWindow` from
  `StakeDiffWindowSize`; `retrieveWindowBlocks` independently re-derives
  `startHeight/endHeight` from the same `windowSize`; `CalculateWindowIndex`
  re-derives the displayed `IndexVal`. All three must use the same
  `windowSize`.

**Critical constraints:**

- C1: `TicketPrice` is VAR int64 atoms; render via `toFloat64Amount` only.
  Never reuse this path for SKA.
- C7: `Transactions` is the post-reconciliation multi-coin total, not flat
  `num_rtx`.
- SQL `$1` denominator, `chainParams.StakeDiffWindowSize`, and the handler's
  `bestWindow` math must all agree — no DB-level check.
- 11-column positional `rows.Scan` in `retrieveWindowBlocks` mirrors
  `SelectWindowsByLimit`'s SELECT list; reorder either side and values
  silently swap into wrong columns.
- Page is server-rendered HTML only; no WebSocket subscription updates it.

**Mutation checklist:**

- [ ] SQL `$1` denominator == `chainParams.StakeDiffWindowSize` (3 callsites).
- [ ] `rows.Scan` arity/order matches `SelectWindowsByLimit` column list.
- [ ] `windows.tmpl` field references match `BlocksGroupedInfo` exactly.
- [ ] Time-based-blocks flow checked (shared struct).
- [ ] `coin_tx_stats` JSON shape (`tx_count`/`size`) preserved; lenient
      fallback in `parseCoinTxStats` preserved.
- [ ] `TicketPrice` stays VAR-scale `int64` atoms (or `toFloat64Amount` is
      changed everywhere together).
- [ ] Handler pagination ↔ `retrieveWindowBlocks` range math ↔
      `CalculateWindowIndex` all use the same `windowSize`.
- [ ] `dataSource` interface (`explorer.go:95`) + mock (`explorer_test.go:103`)
      moved with any `PosIntervals` signature change.
