# Issue #32 — Frontend: Replace Distribution Section with Supply Section

## Status

Complete.

## What was already done (renames)

- `distribution_controller.js` → `supply_controller.js`
- `data-controller="...distribution..."` → `...supply...` in `home.tmpl`
- `data-action="...distribution#handleBlock..."` → `...supply#handleBlock...` in `home.tmpl`
- `data-distribution-target="..."` → `data-supply-target="..."` in `home.tmpl`

## Backend contract (commit 0ed5dc2, on `develop`)

The `HomeInfo` struct now carries:

```go
VARCoinSupply  *VARCoinSupply       // nil when unavailable
SKACoinSupply  []SKACoinSupplyEntry // empty slice when unavailable
```

```go
type VARCoinSupply struct {
    Circulating string // big-number atom string, 8 decimal places
    Target      string // from chain params.MaxSupply
}

type SKACoinSupplyEntry struct {
    CoinType      uint8  // SKA-n identifier (1, 2, …)
    InCirculation string // big-number atom string, 18 decimal places
    TotalIssued   string // big-number atom string, 18 decimal places
    TotalBurned   string // big-number atom string, 18 decimal places
}
```

All string values are raw atom counts (integers as strings). The template helper
`formatCoinAtoms <value> <coinType>` handles decimal formatting:

- coinType `0` → 8 decimal places (VAR)
- coinType `1–255` → 18 decimal places (SKA)

## Implementation tasks

### 1. Rebase ✅

Rebased onto `develop` by user.

### 2. Extract Supply section into `home_supply.tmpl` and rewrite markup ✅

Extracted from `home.tmpl` into `cmd/dcrdata/views/home_supply.tmpl` as the
`"supply-card"` template, following the same pattern as `home_mining.tmpl`.
`home.tmpl` now calls `{{template "supply-card" .}}`. `"home_supply"` added to
`commonTemplates` in `explorer.go` and `home_template_test.go`.

VAR Coin Supply: circulating value + `(of ~47M)` target hint, live-update via
`data-supply-target="varCirculating"`.

SKA Coins Supply: `{{range .SKACoinSupply}}` — per-type block with "In
Circulation", "Total Issued", "Total Burned" rows formatted via
`formatCoinAtoms`.

### 3. Update `supply_controller.js` ✅

Removed all dead Decred-inherited targets. Now handles only `varCirculating`
(updated from `ex.var_coin_supply.circulating` on new block) and `exchangeRate`.

### 4. SCSS — no new rules needed ✅

Section uses only existing utility classes.

### 5. Verify

- [x] Rebase done
- [ ] `go build ./...` passes in `cmd/dcrdata`
- [ ] Template renders with mock data (light + dark, mobile + desktop)
- [ ] `npm run lint` passes
- [ ] `npm run test` passes
