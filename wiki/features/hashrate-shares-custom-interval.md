# Custom Block Range Interval on /hashrate-shares

## Status

| Layer | Status |
|-------|--------|
| Design (template) | ✅ Done — `feat/hashrate-shares-custom-interval` |
| Backend (SQL, DB, interface) | ✅ Done |
| Handler (params, validation) | ✅ Done |
| Frontend (JS controller) | ✅ Done |
| Tests (Go + JS) | ✅ Done |

## Design

### Template (`cmd/dcrdata/views/hashrate_shares.tmpl`)

The custom interval lives INLINE in the interval pill row:
`All | Year | Month | Week | Day │ From:[input] To:[input] | Custom`

- `Custom` is a `nav-item nav-link` pill with `data-option="custom"` firing
  `setInterval` — identical styling to the standard pills.
- `border-start` separates the standard pills from the custom block.
- Inputs `firstBlockInput` / `lastBlockInput` are number inputs
  (`form-control-sm`, width 6em).
- No separate hidden row; the inputs are always visible next to the pills.

## Implementation notes

### Backend

- `db/dcrpg/internal/minerstmts.go` — `SelectMinerRewardCountsRange`:
  copy of `SelectMinerRewardCounts` plus `AND t.block_height <= $2`.
- `db/dcrpg/queries.go` — `retrieveMinerRewardCountsRange(ctx, db, firstBlock,
  lastBlock int64)`, same scan loop as the single-param variant.
- `db/dcrpg/pgblockchain.go` — `MinerHashrateSharesRange(ctx, firstBlock,
  lastBlock int64)` with timeout context, matching `MinerHashrateShares`.
- `cmd/dcrdata/internal/explorer/explorer.go` — new
  `explorerDataSource` method `MinerHashrateSharesRange`.
- `cmd/dcrdata/internal/explorer/explorer_test.go` — mock returns
  `m.hashrateRangeRows` and records `gotHashrateFirst/Last`.

### Handler (`hashrate_shares.go`)

`HashrateSharesData` reads `first_block`/`last_block`. When both present:

1. Parse both as int64; reject non-numeric, `first < 0`, `last < 0`,
   `first > last` → 400 with `{"error": ...}`.
2. Reject `last > chainTip` (from `exp.pageData.BlockInfo.Height`, guarded by
   `BlockBasic != nil`; if no tip yet, skip the cap) → 400.
3. Call `exp.dataSource.MinerHashrateSharesRange(ctx, first, last)`.
4. Set response `Interval` to `"custom:<first>-<last>"`.

Otherwise falls through to the standard interval path (`interval` param,
default `"week"`).

### Frontend controller (`hashrate_shares_controller.js`)

- New targets: `firstBlockInput`, `lastBlockInput`.
- New property `this.customBlockRange` — `null` or `{ first, last }`.
- `setInterval(e)` with `data-option="custom"` parses/validates the inputs
  (int ≥ 1, first ≤ last), sets `customBlockRange`, and fetches. Standard
  pill clicks clear `customBlockRange`.
- `fetchAndRender(seq)` branches the URL:
  - custom: `/hashrate-shares/data?first_block=X&last_block=Y`
  - standard: `/hashrate-shares/data?interval=<interval>`
- CSV download filename for custom ranges:
  `hashrate-shares-<first>-<last>.csv`.

## Acceptance criteria

1. Page shows the custom From/To inputs inline with the interval pills.
2. Valid first/last block heights + clicking Custom fetches miner shares for
   that range.
3. Invalid inputs (non-numeric, negative, first > last, last > tip) are
   rejected with 400 and no data fetch.
4. Clicking a standard interval pill clears custom mode and fetches with that
   interval.
5. CSV export works for both standard and custom ranges.
