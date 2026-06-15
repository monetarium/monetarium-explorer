# Hashrate Shares Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a standalone `/hashrate-shares` explorer page showing each miner's share of network hashrate (approximated from coinbase/PoW-reward transactions) as a full SVG pie + ranked table, with an All/Month/Week/Day interval switcher.

**Architecture:** A new DB query reuses the existing `BackfillMiners` coinbase-reward-address predicate, windowed by `block_height`, grouped per address. A pure Go function turns `(address, count)` rows into ranked, percent-formatted views (top-25 + "Others"). A new explorer JSON endpoint serves per-interval data; a new standalone page + Stimulus controller draws the pie and table client-side. The existing `/charts` CHART `<select>` gains an option that navigates to the new page.

**Tech Stack:** Go + PostgreSQL (backend), Go `html/template` (page), Hotwired Stimulus + hand-rolled SVG (frontend), vitest (JS tests).

**Spec:** `docs/superpowers/specs/2026-06-15-hashrate-shares-page-design.md`

---

## File Structure

**Backend (Go):**
- `db/dbtypes/types.go` — add `MinerRewardCount` struct (shared row type).
- `db/dcrpg/internal/minerstmts.go` — add `SelectMinerRewardCounts` SQL.
- `db/dcrpg/queries.go` — add `retrieveMinerRewardCounts` helper.
- `db/dcrpg/pgblockchain.go` — add `(*ChainDB).MinerHashrateShares` method.
- `cmd/dcrdata/internal/explorer/explorer.go` — add `MinerHashrateShares` to the `explorerDataSource` interface; add `"hashrate_shares"` to the template names list.
- `cmd/dcrdata/internal/explorer/explorer_test.go` — add `MinerHashrateShares` to `mockDataSource`.
- `cmd/dcrdata/internal/explorer/hashrate_shares.go` (NEW) — `MinerShareView` type, pure `minerShares` function, `intervalMinHeight` helper, `HashrateShares` page handler, `HashrateSharesData` JSON handler.
- `cmd/dcrdata/internal/explorer/hashrate_shares_test.go` (NEW) — unit tests for `minerShares`.
- `cmd/dcrdata/main.go` — register `/hashrate-shares` and `/hashrate-shares/data` routes.

**Frontend:**
- `cmd/dcrdata/views/hashrate_shares.tmpl` (NEW) — page shell.
- `cmd/dcrdata/views/charts.tmpl` — add the `Hashrate Shares` `<option>`.
- `cmd/dcrdata/public/js/controllers/charts_controller.js` — navigate away when `hashrate-shares` is selected.
- `cmd/dcrdata/public/js/controllers/hashrate_shares_controller.js` (NEW) — fetch + render pie/table; pure helpers.
- `cmd/dcrdata/public/js/controllers/hashrate_shares_controller.test.js` (NEW) — vitest for pure helpers.
- `cmd/dcrdata/public/scss/_hashrate_shares.scss` (NEW) + import — page styles.

**Module note:** backend changes span the root module (`db/...`) and `cmd/dcrdata`. Build/test each from its own module directory (`db/dcrpg` is its own module: `cd db/dcrpg`; the explorer code is under `cmd/dcrdata`: `cd cmd/dcrdata`). Run `go build ./...` in both after the interface change.

---

## Task 1: Shared row type `MinerRewardCount`

**Files:**
- Modify: `db/dbtypes/types.go` (append at end of file)

- [ ] **Step 1: Add the struct**

Append to `db/dbtypes/types.go`:

```go

// MinerRewardCount is one miner reward address and how many PoW-reward (coinbase)
// transactions paid it within a queried block-height window. Used by the
// hashrate-shares page. Count is the number of distinct coinbase blocks that paid
// the address (DISTINCT (address, height)).
type MinerRewardCount struct {
	Address string
	Count   int64
}
```

- [ ] **Step 2: Build the module**

Run: `cd db && go build ./...`
Expected: builds with no error.

- [ ] **Step 3: Commit**

```bash
git add db/dbtypes/types.go
git commit -m "db/dbtypes: add MinerRewardCount row type for hashrate shares"
```

---

## Task 2: SQL statement for per-miner reward counts

**Files:**
- Modify: `db/dcrpg/internal/minerstmts.go` (add constant inside the existing `const (...)` block, before the closing `)`)

- [ ] **Step 1: Add the statement**

In `db/dcrpg/internal/minerstmts.go`, add this constant just before the final `)` of the `const` block (after `CleanupMinerZeros`):

```go

	// SelectMinerRewardCounts returns, for every miner reward address that
	// received at least one PoW-reward (coinbase) transaction at or above
	// $1 (minHeight), the number of distinct coinbase blocks that paid it,
	// ordered descending. The predicate matches BackfillMiners exactly (the
	// codebase's canonical definition of a miner-reward output): coinbase =
	// tree 0 / block_index 0 / mainchain; recipient = a single payment-script
	// address (no multisig sets) with value > 0. minHeight = 0 selects the
	// whole chain ("All").
	SelectMinerRewardCounts = `
		SELECT sub.addr, COUNT(*)::INT8 AS reward_tx_count
		FROM (
			SELECT DISTINCT v.script_addresses AS addr, t.block_height AS height
			FROM vouts v
			JOIN transactions t ON v.tx_hash = t.tx_hash
			WHERE t.tree = 0
			  AND t.block_index = 0
			  AND t.is_mainchain = true
			  AND t.block_height >= $1
			  AND v.script_type IN ('pubkeyhash', 'scripthash', 'pubkey', 'pubkeyalt', 'pubkeyhashalt')
			  AND v.value > 0
			  AND v.script_addresses IS NOT NULL
			  AND v.script_addresses NOT IN ('', 'unknown')
			  AND v.script_addresses NOT LIKE '{%}'
		) sub
		WHERE sub.addr IS NOT NULL AND sub.addr != ''
		GROUP BY sub.addr
		ORDER BY reward_tx_count DESC`
```

- [ ] **Step 2: Build the module**

Run: `cd db/dcrpg && go build ./...`
Expected: builds (unused constant is allowed for exported package-level identifiers).

- [ ] **Step 3: Commit**

```bash
git add db/dcrpg/internal/minerstmts.go
git commit -m "db/dcrpg: add SelectMinerRewardCounts statement (windowed per-miner coinbase counts)"
```

---

## Task 3: DB query helper + ChainDB method

**Files:**
- Modify: `db/dcrpg/queries.go` (add `retrieveMinerRewardCounts` near the other miner helpers, e.g. after `retrieveMiners`)
- Modify: `db/dcrpg/pgblockchain.go` (add `MinerHashrateShares` next to `ActiveMiners`)

- [ ] **Step 1: Add the row-scanning helper**

In `db/dcrpg/queries.go`, add after `retrieveMiners`:

```go

// retrieveMinerRewardCounts returns per-miner reward-transaction counts at or
// above minHeight, ordered descending by count.
func retrieveMinerRewardCounts(ctx context.Context, db *sql.DB, minHeight int64) ([]dbtypes.MinerRewardCount, error) {
	rows, err := db.QueryContext(ctx, internal.SelectMinerRewardCounts, minHeight)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []dbtypes.MinerRewardCount
	for rows.Next() {
		var m dbtypes.MinerRewardCount
		if err := rows.Scan(&m.Address, &m.Count); err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}
```

- [ ] **Step 2: Add the ChainDB method**

In `db/dcrpg/pgblockchain.go`, add immediately after the `ActiveMiners` method (around line 5397):

```go

// MinerHashrateShares returns per-miner PoW-reward (coinbase) transaction counts
// for all reward addresses that received at least one reward at or above
// minHeight, ordered descending by count. minHeight = 0 covers the whole chain.
func (pgb *ChainDB) MinerHashrateShares(ctx context.Context, minHeight int64) ([]dbtypes.MinerRewardCount, error) {
	ctx, cancel := context.WithTimeout(ctx, pgb.queryTimeout)
	defer cancel()
	rows, err := retrieveMinerRewardCounts(ctx, pgb.db, minHeight)
	return rows, pgb.replaceCancelError(err)
}
```

- [ ] **Step 3: Build the module**

Run: `cd db/dcrpg && go build ./...`
Expected: builds with no error.

- [ ] **Step 4: Commit**

```bash
git add db/dcrpg/queries.go db/dcrpg/pgblockchain.go
git commit -m "db/dcrpg: add MinerHashrateShares query for hashrate-shares page"
```

---

## Task 4: Extend the explorer data-source interface + mock

**Files:**
- Modify: `cmd/dcrdata/internal/explorer/explorer.go` (interface near the `ActiveMiners` line, ~127)
- Modify: `cmd/dcrdata/internal/explorer/explorer_test.go` (mock near line 203)

- [ ] **Step 1: Add the interface method**

In `cmd/dcrdata/internal/explorer/explorer.go`, in the `explorerDataSource` interface, add directly under the `ActiveMiners(...)` line:

```go
	MinerHashrateShares(ctx context.Context, minHeight int64) ([]dbtypes.MinerRewardCount, error)
```

- [ ] **Step 2: Add the mock implementation**

In `cmd/dcrdata/internal/explorer/explorer_test.go`, add after the existing `mockDataSource.ActiveMiners` method:

```go

func (m *mockDataSource) MinerHashrateShares(_ context.Context, _ int64) ([]dbtypes.MinerRewardCount, error) {
	return nil, nil
}
```

- [ ] **Step 3: Build + vet the explorer module**

Run: `cd cmd/dcrdata && go build ./... && go vet ./internal/explorer/`
Expected: builds with no error. (If the build reports another type missing `MinerHashrateShares`, that type is an additional `explorerDataSource` implementer — add the same method to it; the only expected implementers are `*dcrpg.ChainDB` and `mockDataSource`.)

- [ ] **Step 4: Commit**

```bash
git add cmd/dcrdata/internal/explorer/explorer.go cmd/dcrdata/internal/explorer/explorer_test.go
git commit -m "explorer: add MinerHashrateShares to data-source interface + mock"
```

---

## Task 5: Pure share-math function (TDD)

**Files:**
- Create: `cmd/dcrdata/internal/explorer/hashrate_shares.go`
- Test: `cmd/dcrdata/internal/explorer/hashrate_shares_test.go`

- [ ] **Step 1: Write the failing test**

Create `cmd/dcrdata/internal/explorer/hashrate_shares_test.go`:

```go
package explorer

import (
	"testing"

	"github.com/decred/dcrdata/v8/db/dbtypes"
)

func TestMinerShares(t *testing.T) {
	t.Run("empty input", func(t *testing.T) {
		total, views := minerShares(nil)
		if total != 0 || views != nil {
			t.Fatalf("want (0, nil), got (%d, %#v)", total, views)
		}
	})

	t.Run("single miner is 100.0", func(t *testing.T) {
		total, views := minerShares([]dbtypes.MinerRewardCount{{Address: "Vsaaa", Count: 7}})
		if total != 7 {
			t.Fatalf("total: want 7, got %d", total)
		}
		if len(views) != 1 {
			t.Fatalf("len: want 1, got %d", len(views))
		}
		v := views[0]
		if v.Rank != 1 || v.Address != "Vsaaa" || v.Count != 7 || v.Percent != "100.0" || v.IsOthers {
			t.Fatalf("unexpected view: %#v", v)
		}
	})

	t.Run("two miners 1-dp percents and ranks", func(t *testing.T) {
		total, views := minerShares([]dbtypes.MinerRewardCount{
			{Address: "Vsbig", Count: 322},
			{Address: "Vssml", Count: 678},
		})
		if total != 1000 {
			t.Fatalf("total: want 1000, got %d", total)
		}
		// sorted desc: 678 (67.8) then 322 (32.2)
		if views[0].Rank != 1 || views[0].Address != "Vssml" || views[0].Percent != "67.8" {
			t.Fatalf("view0: %#v", views[0])
		}
		if views[1].Rank != 2 || views[1].Address != "Vsbig" || views[1].Percent != "32.2" {
			t.Fatalf("view1: %#v", views[1])
		}
	})

	t.Run("tiny miner rounds to 0.0", func(t *testing.T) {
		_, views := minerShares([]dbtypes.MinerRewardCount{
			{Address: "Vsbig", Count: 9996},
			{Address: "Vstiny", Count: 4}, // 0.04% -> "0.0"
		})
		if views[1].Address != "Vstiny" || views[1].Percent != "0.0" {
			t.Fatalf("tiny view: %#v", views[1])
		}
	})

	t.Run("more than 25 miners -> top 25 + Others", func(t *testing.T) {
		rows := make([]dbtypes.MinerRewardCount, 0, 30)
		// 25 miners of 100 each, plus 5 miners of 10 each.
		for i := 0; i < 25; i++ {
			rows = append(rows, dbtypes.MinerRewardCount{Address: "big", Count: 100})
		}
		for i := 0; i < 5; i++ {
			rows = append(rows, dbtypes.MinerRewardCount{Address: "small", Count: 10})
		}
		total, views := minerShares(rows)
		if total != 2550 {
			t.Fatalf("total: want 2550, got %d", total)
		}
		if len(views) != 26 {
			t.Fatalf("len: want 26 (25 + Others), got %d", len(views))
		}
		others := views[25]
		if !others.IsOthers || others.Rank != 0 || others.Count != 50 {
			t.Fatalf("others: %#v", others)
		}
		// 50/2550*100 = 1.96... -> "2.0"
		if others.Percent != "2.0" {
			t.Fatalf("others percent: want 2.0, got %q", others.Percent)
		}
	})

	t.Run("exactly 25 miners -> no Others", func(t *testing.T) {
		rows := make([]dbtypes.MinerRewardCount, 0, 25)
		for i := 0; i < 25; i++ {
			rows = append(rows, dbtypes.MinerRewardCount{Address: "m", Count: 4})
		}
		_, views := minerShares(rows)
		if len(views) != 25 {
			t.Fatalf("len: want 25, got %d", len(views))
		}
		for _, v := range views {
			if v.IsOthers {
				t.Fatalf("unexpected Others row when miners == 25")
			}
		}
	})
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd cmd/dcrdata && go test ./internal/explorer/ -run TestMinerShares`
Expected: FAIL — `undefined: minerShares` / `undefined: MinerShareView`.

- [ ] **Step 3: Write the minimal implementation**

Create `cmd/dcrdata/internal/explorer/hashrate_shares.go`:

```go
package explorer

import (
	"sort"
	"strconv"

	"github.com/decred/dcrdata/v8/db/dbtypes"
)

// maxMinerRows caps the number of ranked miner rows shown on the hashrate-shares
// page; remaining miners are aggregated into a single "Others" entry.
const maxMinerRows = 25

// MinerShareView is one rendered row/slice of the hashrate-shares view: a ranked
// miner reward address with its reward-tx count and 1-decimal percent share.
// The "Others" aggregate uses Rank 0 and IsOthers = true.
type MinerShareView struct {
	Rank     int    `json:"rank"`
	Address  string `json:"address"`
	Count    int64  `json:"count"`
	Percent  string `json:"percent"` // pre-formatted to 1 decimal place, e.g. "32.2"
	IsOthers bool   `json:"isOthers"`
}

// minerShares converts raw per-miner reward counts into ranked views with
// 1-decimal-place percent shares of the network total. It sorts descending by
// count, keeps the top maxMinerRows, and aggregates the remainder into a single
// "Others" entry. The denominator is the total across ALL miners (not just the
// top rows), so shares sum to ~100%. Returns (0, nil) when there is no data.
func minerShares(rows []dbtypes.MinerRewardCount) (total int64, views []MinerShareView) {
	for _, r := range rows {
		total += r.Count
	}
	if total == 0 {
		return 0, nil
	}

	pct := func(c int64) string {
		return strconv.FormatFloat(float64(c)/float64(total)*100, 'f', 1, 64)
	}

	sorted := append([]dbtypes.MinerRewardCount(nil), rows...)
	sort.SliceStable(sorted, func(i, j int) bool { return sorted[i].Count > sorted[j].Count })

	top := len(sorted)
	if top > maxMinerRows {
		top = maxMinerRows
	}

	var topSum int64
	for i := 0; i < top; i++ {
		topSum += sorted[i].Count
		views = append(views, MinerShareView{
			Rank:    i + 1,
			Address: sorted[i].Address,
			Count:   sorted[i].Count,
			Percent: pct(sorted[i].Count),
		})
	}

	if len(sorted) > maxMinerRows {
		othersCount := total - topSum
		views = append(views, MinerShareView{
			Rank:     0,
			Count:    othersCount,
			Percent:  pct(othersCount),
			IsOthers: true,
		})
	}

	return total, views
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd cmd/dcrdata && go test ./internal/explorer/ -run TestMinerShares -v`
Expected: PASS (all subtests).

- [ ] **Step 5: Commit**

```bash
git add cmd/dcrdata/internal/explorer/hashrate_shares.go cmd/dcrdata/internal/explorer/hashrate_shares_test.go
git commit -m "explorer: pure minerShares (top-25 + Others, 1-dp percents)"
```

---

## Task 6: Interval→minHeight helper + JSON data handler

**Files:**
- Modify: `cmd/dcrdata/internal/explorer/hashrate_shares.go` (append)

- [ ] **Step 1: Add the interval helper and the JSON handler**

Append to `cmd/dcrdata/internal/explorer/hashrate_shares.go`. Add `context`, `encoding/json`, `net/http`, and `time` to the import block (final import block shown for clarity):

```go
import (
	"context"
	"encoding/json"
	"net/http"
	"sort"
	"strconv"
	"time"

	"github.com/decred/dcrdata/v8/db/dbtypes"
)
```

Then append the helper + handler:

```go

// intervalMinHeight maps an interval label to the minimum block height of the
// window, relative to the chain tip time. "all" (and anything unrecognized)
// returns 0 (whole chain). day/week/month subtract the corresponding duration
// from the tip time and map it to a height via the data source.
func (exp *explorerUI) intervalMinHeight(ctx context.Context, interval string) (int64, error) {
	var dur time.Duration
	switch interval {
	case "day":
		dur = 24 * time.Hour
	case "week":
		dur = 7 * 24 * time.Hour
	case "month":
		dur = 30 * 24 * time.Hour
	default: // "all"
		return 0, nil
	}

	exp.pageData.RLock()
	hasTip := exp.pageData.BlockInfo != nil && exp.pageData.BlockInfo.BlockBasic != nil
	var tipTime time.Time
	if hasTip {
		tipTime = exp.pageData.BlockInfo.BlockTime.T
	}
	exp.pageData.RUnlock()

	if !hasTip {
		// No tip yet (early startup): fall back to whole chain.
		return 0, nil
	}

	return exp.dataSource.GetHeightByTimestamp(ctx, tipTime.Add(-dur))
}

// HashrateSharesData serves the per-interval miner hashrate-share data as JSON
// for the /hashrate-shares page controller. Query param: ?interval=all|month|week|day.
func (exp *explorerUI) HashrateSharesData(w http.ResponseWriter, r *http.Request) {
	interval := r.URL.Query().Get("interval")
	switch interval {
	case "all", "month", "week", "day":
	default:
		interval = "all"
	}

	ctx := r.Context()
	minHeight, err := exp.intervalMinHeight(ctx, interval)
	if err != nil {
		log.Errorf("hashrate-shares: intervalMinHeight: %v", err)
		http.Error(w, http.StatusText(http.StatusInternalServerError), http.StatusInternalServerError)
		return
	}

	rows, err := exp.dataSource.MinerHashrateShares(ctx, minHeight)
	if err != nil {
		log.Errorf("hashrate-shares: MinerHashrateShares: %v", err)
		http.Error(w, http.StatusText(http.StatusInternalServerError), http.StatusInternalServerError)
		return
	}

	total, views := minerShares(rows)
	if views == nil {
		views = []MinerShareView{} // emit [] not null
	}

	resp := struct {
		Interval string           `json:"interval"`
		Total    int64            `json:"total"`
		Miners   []MinerShareView `json:"miners"`
	}{
		Interval: interval,
		Total:    total,
		Miners:   views,
	}

	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(resp); err != nil {
		log.Errorf("hashrate-shares: encode: %v", err)
	}
}
```

- [ ] **Step 2: Build the explorer module**

Run: `cd cmd/dcrdata && go build ./...`
Expected: builds with no error. (`log` is the explorer package logger already used across this package; `exp.pageData.BlockInfo` / `.BlockTime.T` mirror `explorer.go`'s usage.)

- [ ] **Step 3: Re-run the share-math test (no regression)**

Run: `cd cmd/dcrdata && go test ./internal/explorer/ -run TestMinerShares`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add cmd/dcrdata/internal/explorer/hashrate_shares.go
git commit -m "explorer: hashrate-shares JSON data endpoint + interval window"
```

---

## Task 7: Page handler + template registration

**Files:**
- Modify: `cmd/dcrdata/internal/explorer/hashrate_shares.go` (append page handler)
- Modify: `cmd/dcrdata/internal/explorer/explorer.go` (add `"hashrate_shares"` to template names, ~line 393)

- [ ] **Step 1: Add `io` to imports and the page handler**

Add `"io"` to the import block in `hashrate_shares.go`, then append:

```go

// HashrateShares renders the standalone /hashrate-shares page shell. The pie and
// table are populated client-side by the hashrate_shares Stimulus controller,
// which fetches /hashrate-shares/data.
func (exp *explorerUI) HashrateShares(w http.ResponseWriter, r *http.Request) {
	exp.pageData.RLock()
	skaSupply := exp.pageData.HomeInfo.SKACoinSupply
	exp.pageData.RUnlock()

	activeSKATypes := make([]uint8, len(skaSupply))
	for i, entry := range skaSupply {
		activeSKATypes[i] = entry.CoinType
	}

	str, err := exp.templates.exec("hashrate_shares", struct {
		*CommonPageData
		ActiveSKATypes []uint8
	}{
		CommonPageData: exp.commonData(r),
		ActiveSKATypes: activeSKATypes,
	})
	if err != nil {
		log.Errorf("Template execute failure: %v", err)
		exp.StatusPage(w, defaultErrorCode, defaultErrorMessage, "", ExpStatusError)
		return
	}

	w.Header().Set("Content-Type", "text/html")
	w.WriteHeader(http.StatusOK)
	io.WriteString(w, str)
}
```

- [ ] **Step 2: Register the template name**

In `cmd/dcrdata/internal/explorer/explorer.go`, locate the `tmpls := []string{...}` list (around line 393) and add `"hashrate_shares"` to it, e.g. change:

```go
	tmpls := []string{"home", "blocks", "mempool", "block", "tx", "address",
		"rawtx", "status", "parameters", "agenda", "agendas", "charts",
```

so that `"hashrate_shares"` appears in the slice (append it after `"charts"`):

```go
	tmpls := []string{"home", "blocks", "mempool", "block", "tx", "address",
		"rawtx", "status", "parameters", "agenda", "agendas", "charts", "hashrate_shares",
```

- [ ] **Step 3: Build (will fail until the template file exists at runtime, but must compile)**

Run: `cd cmd/dcrdata && go build ./...`
Expected: builds with no error (the template file is loaded at runtime in Task 8; compilation does not require it).

- [ ] **Step 4: Commit**

```bash
git add cmd/dcrdata/internal/explorer/hashrate_shares.go cmd/dcrdata/internal/explorer/explorer.go
git commit -m "explorer: hashrate-shares page handler + template registration"
```

---

## Task 8: Page template

**Files:**
- Create: `cmd/dcrdata/views/hashrate_shares.tmpl`

- [ ] **Step 1: Create the template**

Create `cmd/dcrdata/views/hashrate_shares.tmpl`. It mirrors `charts.tmpl`'s CHART `<select>` (with `Hashrate Shares` pre-selected) and adds the interval pills + pie/table containers:

```html
{{define "hashrate_shares"}}
<!DOCTYPE html>
<html lang="en">
{{template "html-head" headData .CommonPageData "Monetarium Hashrate Shares"}}
    {{template "navbar" . }}

    <div data-controller="hashrate-shares" class="container main">

        <div class="d-flex flex-wrap justify-content-center align-items-center chart-controls mb-1 mt-1">
            <div class="chart-control-wrapper me-2 mb-1">
                <div class="chart-control-label">CHART</div>
                <div class="chart-control">
                    <select
                        id="selectBox"
                        class="form-control chart-form-control dropdown"
                        data-action="hashrate-shares#selectChart"
                    >
                        <option value="ticket-price">Ticket Price</option>
                        <option value="ticket-pool-size">Ticket Pool Size</option>
                        <option value="ticket-pool-value">Ticket Pool Value</option>
                        <option value="stake-participation">Stake Participation</option>
                        <option value="block-size">Block Size</option>
                        <option value="blockchain-size">Blockchain Size</option>
                        <option value="tx-count">Transaction Count</option>
                        <option value="pow-difficulty">PoW Difficulty</option>
                        <option value="coin-supply/0">Circulation (VAR)</option>
                        {{range $t := .ActiveSKATypes}}<option value="coin-supply/{{$t}}">Circulation (SKA{{$t}})</option>
                         {{end}}<option value="fees">Fees (VAR)</option>
                         {{range $t := .ActiveSKATypes}}<option value="fees/{{$t}}">Fees (SKA{{$t}})</option>
                          {{end}}
                         <option value="duration-btw-blocks">Duration Between Blocks</option>
                        <option value="chainwork">Total Work</option>
                        <option value="hashrate">Hashrate</option>
                        <option value="hashrate-shares" selected>Hashrate Shares</option>
                        <option value="missed-votes">Missed Votes</option>
                    </select>
                </div>
            </div>

            <div class="chart-control-wrapper me-2 mb-1">
                <div class="chart-control-label">INTERVAL</div>
                <div class="chart-control">
                    <ul class="nav nav-pills">
                        <li class="nav-item nav-link active" data-hashrate-shares-target="intervalOption"
                            data-action="click->hashrate-shares#setInterval" data-option="all">All</li>
                        <li class="nav-item nav-link" data-hashrate-shares-target="intervalOption"
                            data-action="click->hashrate-shares#setInterval" data-option="month">Month</li>
                        <li class="nav-item nav-link" data-hashrate-shares-target="intervalOption"
                            data-action="click->hashrate-shares#setInterval" data-option="week">Week</li>
                        <li class="nav-item nav-link" data-hashrate-shares-target="intervalOption"
                            data-action="click->hashrate-shares#setInterval" data-option="day">Day</li>
                    </ul>
                </div>
            </div>
        </div>

        <p class="text-center text-secondary fs13 mb-2">
            Share of network hashrate approximated from PoW Reward (coinbase) transactions,
            per <strong>reward address</strong>. An operator using multiple payout addresses
            appears as multiple entries.
        </p>

        <div class="hashrate-shares-layout d-flex flex-wrap justify-content-center align-items-start">
            <div class="hashrate-shares-pie-wrap" data-hashrate-shares-target="pieWrap">
                <svg data-hashrate-shares-target="pie" viewBox="0 0 360 360" class="hashrate-shares-pie"></svg>
            </div>
            <div class="hashrate-shares-table-wrap">
                <table class="table table-sm hashrate-shares-table">
                    <thead>
                        <tr>
                            <th class="text-end">#</th>
                            <th></th>
                            <th class="text-end">%</th>
                            <th>Reward Address</th>
                        </tr>
                    </thead>
                    <tbody data-hashrate-shares-target="tableBody"></tbody>
                </table>
                <div class="d-hide text-secondary p-3" data-hashrate-shares-target="empty">
                    No PoW Reward transactions in the selected period.
                </div>
            </div>
        </div>
    </div>

{{ template "footer" . }}
</body>
</html>
{{end}}
```

> **Verify the page scaffold matches siblings:** open `cmd/dcrdata/views/charts.tmpl` and confirm the opening (`html-head`, `navbar`) and closing (`footer`, `</body></html>`) match what this file uses. If `charts.tmpl` closes differently (e.g. a different footer partial), mirror it exactly.

- [ ] **Step 2: Build the frontend + run the binary to smoke-test the route**

Run: `cd cmd/dcrdata && npm run build && go build -o /tmp/mon-explorer .`
Expected: both succeed. (Full runtime check happens in Task 13.)

- [ ] **Step 3: Commit**

```bash
git add cmd/dcrdata/views/hashrate_shares.tmpl
git commit -m "views: add hashrate_shares page template"
```

---

## Task 9: CHART `<select>` option + navigate-away

**Files:**
- Modify: `cmd/dcrdata/views/charts.tmpl` (~line 40-41)
- Modify: `cmd/dcrdata/public/js/controllers/charts_controller.js` (`selectChart`, ~line 852)

- [ ] **Step 1: Add the option between Hashrate and Missed Votes**

In `cmd/dcrdata/views/charts.tmpl`, change:

```html
                            <option value="hashrate">Hashrate</option>
                            <option value="missed-votes">Missed Votes</option>
```

to:

```html
                            <option value="hashrate">Hashrate</option>
                            <option value="hashrate-shares">Hashrate Shares</option>
                            <option value="missed-votes">Missed Votes</option>
```

- [ ] **Step 2: Navigate away when the option is chosen**

In `cmd/dcrdata/public/js/controllers/charts_controller.js`, in `selectChart()`, insert the redirect as the first lines of the method body (right after `const selection = (this.settings.chart = this.chartSelectTarget.value)`):

```js
  async selectChart() {
    const selection = (this.settings.chart = this.chartSelectTarget.value)
    if (selection === 'hashrate-shares') {
      window.location.assign('/hashrate-shares')
      return
    }
    this.customLimits = null
```

- [ ] **Step 3: Build the frontend**

Run: `cd cmd/dcrdata && npm run build`
Expected: builds, manifest updated.

- [ ] **Step 4: Lint the changed JS**

Run: `cd cmd/dcrdata && npx eslint public/js/controllers/charts_controller.js`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add cmd/dcrdata/views/charts.tmpl cmd/dcrdata/public/js/controllers/charts_controller.js
git commit -m "charts: add Hashrate Shares option that opens the new page"
```

---

## Task 10: Controller pure helpers (TDD)

**Files:**
- Create: `cmd/dcrdata/public/js/controllers/hashrate_shares_controller.js` (helpers first)
- Test: `cmd/dcrdata/public/js/controllers/hashrate_shares_controller.test.js`

- [ ] **Step 1: Write the failing test for pure helpers**

Create `cmd/dcrdata/public/js/controllers/hashrate_shares_controller.test.js`:

No `@hotwired/stimulus` mock is needed here — the test imports only the pure named
helpers; the default Controller subclass is defined but never instantiated, so importing the
real Stimulus `Controller` class is harmless.

```js
import { describe, it, expect } from 'vitest'
import {
  middleTruncate,
  colorForIndex,
  sliceLabelFits,
  arcPath,
  PIE,
  PALETTE
} from './hashrate_shares_controller'

describe('middleTruncate', () => {
  it('truncates the middle of a long address', () => {
    // head 8 = "VsAbCdEf", tail 6 = "Yz1234"
    expect(middleTruncate('VsAbCdEfGhIjKlMnOpQrStUvWxYz1234', 8, 6)).toBe('VsAbCdEf…Yz1234')
  })
  it('keeps short strings unchanged', () => {
    expect(middleTruncate('short', 8, 6)).toBe('short')
  })
})

describe('colorForIndex', () => {
  it('is deterministic and wraps the palette', () => {
    expect(colorForIndex(0)).toBe(PALETTE[0])
    expect(colorForIndex(1)).toBe(PALETTE[1])
    expect(colorForIndex(PALETTE.length)).toBe(PALETTE[0]) // wraps
  })
})

describe('sliceLabelFits', () => {
  it('numbers a large slice', () => {
    expect(sliceLabelFits(Math.PI / 2)).toBe(true) // 90deg
  })
  it('skips a sliver', () => {
    expect(sliceLabelFits(0.02)).toBe(false) // ~1.1deg
  })
})

describe('arcPath', () => {
  it('produces a wedge path string from center', () => {
    const d = arcPath(0, Math.PI / 2)
    expect(d.startsWith(`M ${PIE.cx} ${PIE.cy}`)).toBe(true)
    expect(d.trim().endsWith('Z')).toBe(true)
  })
  it('sets the large-arc flag based on sweep', () => {
    // path arc segment is "A 165 165 0 <largeArc> 1 ..." (PIE.r === 165)
    expect(arcPath(0, Math.PI / 2)).toContain('165 0 0 1') // <180deg -> large-arc 0
    expect(arcPath(0, (3 * Math.PI) / 2)).toContain('165 0 1 1') // >180deg -> large-arc 1
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd cmd/dcrdata && npx vitest run public/js/controllers/hashrate_shares_controller.test.js`
Expected: FAIL — cannot resolve exports / module not found.

- [ ] **Step 3: Implement the controller with exported pure helpers**

Create `cmd/dcrdata/public/js/controllers/hashrate_shares_controller.js`:

```js
import { Controller } from '@hotwired/stimulus'
import { requestJSON } from '../helpers/http'

// Pie geometry constants (SVG viewBox is 360x360).
export const PIE = { cx: 180, cy: 180, r: 165, labelR: 110 }

// Fixed 25-color categorical palette (visually distinct in light and dark themes).
export const PALETTE = [
  '#2970FF', '#E03131', '#2DB35E', '#F08C00', '#1098AD',
  '#7048E8', '#E64980', '#0B7285', '#F59F00', '#495057',
  '#4263EB', '#74B816', '#D6336C', '#1864AB', '#9C36B5',
  '#0CA678', '#E8590C', '#3B5BDB', '#66A80F', '#C2255C',
  '#5C940D', '#A61E4D', '#364FC7', '#087F5B', '#862E9C'
]
export const OTHERS_COLOR = '#adb5bd'

// Minimum slice sweep (radians) for a rank number to fit inside the slice.
export const MIN_LABEL_SWEEP = 0.18 // ~10.3 degrees

export function colorForIndex(i) {
  return PALETTE[i % PALETTE.length]
}

export function sliceLabelFits(sweepRadians) {
  return sweepRadians >= MIN_LABEL_SWEEP
}

export function middleTruncate(s, head = 8, tail = 6) {
  if (typeof s !== 'string' || s.length <= head + tail + 1) return s
  return `${s.slice(0, head)}…${s.slice(-tail)}`
}

// arcPath returns an SVG wedge path from the pie center spanning [start, end]
// (radians, clockwise from +x axis).
export function arcPath(start, end) {
  const { cx, cy, r } = PIE
  const x1 = cx + r * Math.cos(start)
  const y1 = cy + r * Math.sin(start)
  const x2 = cx + r * Math.cos(end)
  const y2 = cy + r * Math.sin(end)
  const largeArc = end - start > Math.PI ? 1 : 0
  return `M ${cx} ${cy} L ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 ${largeArc} 1 ${x2.toFixed(2)} ${y2.toFixed(2)} Z`
}

const SVGNS = 'http://www.w3.org/2000/svg'

export default class extends Controller {
  static targets = ['pie', 'tableBody', 'intervalOption', 'empty', 'pieWrap']

  connect() {
    this.interval = 'all'
    this.fetchAndRender()
  }

  setInterval(e) {
    const option = e.currentTarget.dataset.option
    if (option === this.interval) return
    this.interval = option
    this.intervalOptionTargets.forEach((el) => {
      el.classList.toggle('active', el.dataset.option === option)
    })
    this.fetchAndRender()
  }

  // Navigate to /charts for any non-hashrate-shares selection (parity with the
  // CHART <select> on /charts).
  selectChart(e) {
    const value = e.currentTarget.value
    if (value === 'hashrate-shares') return
    window.location.assign(`/charts?chart=${encodeURIComponent(value)}`)
  }

  async fetchAndRender() {
    let data
    try {
      data = await requestJSON(`/hashrate-shares/data?interval=${this.interval}`)
    } catch (err) {
      console.error('hashrate-shares fetch failed', err)
      return
    }
    const miners = (data && data.miners) || []
    this.renderTable(miners)
    this.renderPie(miners)
  }

  renderTable(miners) {
    const empty = !miners.length
    this.emptyTarget.classList.toggle('d-hide', !empty)
    const rows = miners.map((m, i) => {
      const color = m.isOthers ? OTHERS_COLOR : colorForIndex(i)
      const rank = m.isOthers ? '' : m.rank
      const swatch = `<span class="hashrate-shares-swatch" style="background:${color}"></span>`
      const addr = m.isOthers
        ? '<span class="text-secondary">Others</span>'
        : `<a class="mono" href="/address/${m.address}">${middleTruncate(m.address)}</a>`
      return `<tr>
        <td class="text-end">${rank}</td>
        <td>${swatch}</td>
        <td class="text-end mono">${m.percent}%</td>
        <td class="break-word">${addr}</td>
      </tr>`
    })
    this.tableBodyTarget.innerHTML = rows.join('')
  }

  renderPie(miners) {
    const svg = this.pieTarget
    svg.innerHTML = ''
    if (!miners.length) return

    const total = miners.reduce((acc, m) => acc + Number(m.count), 0)
    if (total <= 0) return

    // Single slice cannot be drawn as a wedge arc — use a full circle.
    if (miners.length === 1) {
      const c = document.createElementNS(SVGNS, 'circle')
      c.setAttribute('cx', PIE.cx)
      c.setAttribute('cy', PIE.cy)
      c.setAttribute('r', PIE.r)
      c.setAttribute('fill', miners[0].isOthers ? OTHERS_COLOR : colorForIndex(0))
      svg.appendChild(c)
      return
    }

    let angle = -Math.PI / 2 // start at 12 o'clock
    miners.forEach((m, i) => {
      const sweep = (Number(m.count) / total) * 2 * Math.PI
      const start = angle
      const end = angle + sweep
      angle = end

      const path = document.createElementNS(SVGNS, 'path')
      path.setAttribute('d', arcPath(start, end))
      path.setAttribute('fill', m.isOthers ? OTHERS_COLOR : colorForIndex(i))
      path.setAttribute('stroke', 'var(--hashrate-shares-stroke, #fff)')
      path.setAttribute('stroke-width', '1')
      svg.appendChild(path)

      // Rank number only when it fits and the slice is not "Others".
      if (!m.isOthers && sliceLabelFits(sweep)) {
        const mid = (start + end) / 2
        const lx = PIE.cx + PIE.labelR * Math.cos(mid)
        const ly = PIE.cy + PIE.labelR * Math.sin(mid)
        const text = document.createElementNS(SVGNS, 'text')
        text.setAttribute('x', lx.toFixed(1))
        text.setAttribute('y', ly.toFixed(1))
        text.setAttribute('text-anchor', 'middle')
        text.setAttribute('dominant-baseline', 'central')
        text.setAttribute('class', 'hashrate-shares-rank')
        text.textContent = String(m.rank)
        svg.appendChild(text)
      }
    })
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd cmd/dcrdata && npx vitest run public/js/controllers/hashrate_shares_controller.test.js`
Expected: PASS.

- [ ] **Step 5: Lint**

Run: `cd cmd/dcrdata && npx eslint public/js/controllers/hashrate_shares_controller.js`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add cmd/dcrdata/public/js/controllers/hashrate_shares_controller.js cmd/dcrdata/public/js/controllers/hashrate_shares_controller.test.js
git commit -m "controllers: hashrate_shares controller (SVG pie + table) with tested helpers"
```

---

## Task 11: Register the page routes

**Files:**
- Modify: `cmd/dcrdata/main.go` (page route group, near `withCache.Get("/charts", explore.Charts)`, ~line 772)

- [ ] **Step 1: Add the routes**

In `cmd/dcrdata/main.go`, immediately after the line:

```go
		withCache.Get("/charts", explore.Charts)
```

add:

```go
		withCache.Get("/hashrate-shares", explore.HashrateShares)
		// Data endpoint is NOT under withCache: it varies by ?interval= and is
		// fetched on demand by the controller, so it must not share the page's
		// block-scoped ETag/Last-Modified caching.
		r.Get("/hashrate-shares/data", explore.HashrateSharesData)
```

(`r` is the `SyncStatusPageIntercept` group router; `withCache` is `r.With(explore.ETagAndLastModifiedIntercept)`. Both are in scope here.)

- [ ] **Step 2: Build the binary**

Run: `cd cmd/dcrdata && go build -o /tmp/mon-explorer .`
Expected: builds with no error.

- [ ] **Step 3: Commit**

```bash
git add cmd/dcrdata/main.go
git commit -m "main: register /hashrate-shares page and data routes"
```

---

## Task 12: Styles

**Files:**
- Create: `cmd/dcrdata/public/scss/_hashrate_shares.scss`
- Modify: the main SCSS entry that `@use`/`@import`s partials (find it in Step 1)

- [ ] **Step 1: Find the SCSS entry and how partials are included**

Run: `cd cmd/dcrdata && ls public/scss && grep -rn "charts" public/scss/*.scss | grep -iE "use|import|forward" | head`
Expected: identifies the main entry (e.g. `style.scss`) and the `@use`/`@import` convention used for partials. Mirror that convention in Step 3.

- [ ] **Step 2: Create the partial**

Create `cmd/dcrdata/public/scss/_hashrate_shares.scss`:

```scss
.hashrate-shares-layout {
  gap: 2rem;
}

.hashrate-shares-pie-wrap {
  flex: 0 0 360px;
  max-width: 360px;
}

.hashrate-shares-pie {
  width: 100%;
  height: auto;
}

.hashrate-shares-rank {
  fill: #fff;
  font-size: 14px;
  font-weight: 600;
  pointer-events: none;
}

.hashrate-shares-table-wrap {
  flex: 1 1 320px;
  min-width: 280px;
}

.hashrate-shares-swatch {
  display: inline-block;
  width: 14px;
  height: 14px;
  border-radius: 2px;
  vertical-align: middle;
}

.hashrate-shares-table td,
.hashrate-shares-table th {
  vertical-align: middle;
}
```

- [ ] **Step 3: Include the partial**

Add an include line to the main SCSS entry identified in Step 1, following its existing convention (example for an `@import` entry):

```scss
@import 'hashrate_shares';
```

(If the project uses `@use`, write `@use 'hashrate_shares';` instead, placed with the other partial includes.)

- [ ] **Step 4: Build the frontend**

Run: `cd cmd/dcrdata && npm run build`
Expected: builds; no SCSS errors.

- [ ] **Step 5: Lint the SCSS**

Run: `cd cmd/dcrdata && npx stylelint public/scss/_hashrate_shares.scss`
Expected: no errors (fix any reported ordering/format issues, or run `npm run lint:css:fix`).

- [ ] **Step 6: Commit**

```bash
git add cmd/dcrdata/public/scss/_hashrate_shares.scss cmd/dcrdata/public/scss/*.scss
git commit -m "scss: hashrate-shares page styles"
```

---

## Task 13: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Go tests (explorer module)**

Run: `cd cmd/dcrdata && go test ./internal/explorer/`
Expected: PASS.

- [ ] **Step 2: Go build (both modules)**

Run: `cd db/dcrpg && go build ./... && cd ../.. && cd cmd/dcrdata && go build ./...`
Expected: both succeed.

- [ ] **Step 3: Frontend checks**

Run: `cd cmd/dcrdata && npm run build && npm test`
Expected: webpack build succeeds; vitest passes (including the new controller test).

- [ ] **Step 4: Lint/format gate (matches pre-commit hook)**

Run: `cd cmd/dcrdata && npm run check` and `gofmt -l internal/explorer/hashrate_shares.go`
Expected: `npm run check` clean; `gofmt -l` prints nothing.

- [ ] **Step 5: Manual smoke test (requires a synced node + DB)**

Run the binary against a configured backend, then:
- Visit `/charts`, open the CHART dropdown, confirm `Hashrate Shares` sits **between** `Hashrate` and `Missed Votes`; select it → lands on `/hashrate-shares`.
- On `/hashrate-shares`: pie renders as a **full** pie (no hole); the largest slices carry rank numbers; the table shows ≤ 25 rows (+ Others when applicable) sorted by share desc with matching swatch colors, 1-dp percentages, and middle-truncated reward addresses linking to `/address/...`.
- Toggle INTERVAL (All / Month / Week / Day) → pie + table recompute without a full reload.
- `curl -s 'http://<host>/hashrate-shares/data?interval=week'` returns the expected JSON shape.

If a live backend is unavailable in this environment, record that Step 5 was not run and rely on Steps 1–4 (the data path is exercised by `TestMinerShares` and the predicate is the already-shipped `BackfillMiners` predicate).

- [ ] **Step 6: Final review against the spec**

Re-read `docs/superpowers/specs/2026-06-15-hashrate-shares-page-design.md` §§1–8 and confirm each acceptance criterion in issue #468 maps to delivered behavior. Note any deferred item (e.g. the §9 EXPLAIN/index check if no seeded DB was available).

---

## Notes carried from the spec

- **Performance (spec §9):** the "All" query scans all coinbases. If a seeded DB is available, run `EXPLAIN ANALYZE` for the `interval=all` data endpoint; if it seq-scans `transactions`, add a partial index `CREATE INDEX ... ON transactions (block_height) WHERE tree = 0 AND block_index = 0` via `db/dcrpg/internal/indexes.go`. The `miners` table is a documented fast-path fallback (with the output-vs-tx-count caveat) if needed.
- **No new project standards** (spec §10/§12): no WCAG/breadcrumb/sitemap/active-nav work; the table already carries data independently of color.
- **Independent of PR #460** — do not consult or merge that branch.
