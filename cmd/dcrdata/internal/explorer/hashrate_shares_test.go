package explorer

import (
	"encoding/json"
	"math"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/monetarium/monetarium-explorer/db/dbtypes"
	"github.com/monetarium/monetarium-explorer/explorer/types"
)

// TestHashrateSharesData_BlockRange drives the from/to branch of
// HashrateSharesData. It verifies param validation (including the length cap
// and the chain-tip clamp), that the data source receives the parsed window,
// and that the response JSON carries the range label, shares, and totals.
func TestHashrateSharesData_BlockRange(t *testing.T) {
	const tipHeight = int64(5000)
	mockDS := &mockDataSource{
		blocks:  make(map[string]*types.BlockInfo),
		heights: make(map[int64]string),
		hashrateRows: []dbtypes.MinerRewardCount{
			{Address: "Vsaaa", Count: 7, RewardAtoms: 7_000_000_000, PaidAtoms: 7_000_010_000},
			{Address: "Vsbbb", Count: 3, RewardAtoms: 3_000_000_000, PaidAtoms: 3_000_004_000},
		},
	}
	exp := &explorerUI{
		dataSource: mockDS,
		pageData: &pageData{
			BlockInfo: &types.BlockInfo{
				BlockBasic: &types.BlockBasic{Height: tipHeight},
			},
		},
	}

	call := func(query string) *httptest.ResponseRecorder {
		t.Helper()
		req := httptest.NewRequest(http.MethodGet, "/hashrate-shares/data"+query, nil)
		rec := httptest.NewRecorder()
		exp.HashrateSharesData(rec, req)
		return rec
	}

	type resp struct {
		Interval  string               `json:"interval"`
		Total     int64                `json:"total"`
		Miners    []MinerShareView     `json:"miners"`
		Totals    hashrateSharesTotals `json:"totals"`
		Truncated bool                 `json:"truncated"`
	}

	t.Run("passes parsed window to the data source", func(t *testing.T) {
		rec := call("?from=1000&to=2000")
		if rec.Code != http.StatusOK {
			t.Fatalf("status: want 200, got %d", rec.Code)
		}
		if mockDS.gotHashrateMin != 1000 || mockDS.gotHashrateMax != 2000 {
			t.Fatalf("window: want (1000, 2000), got (%d, %d)",
				mockDS.gotHashrateMin, mockDS.gotHashrateMax)
		}

		var out resp
		if err := json.NewDecoder(rec.Body).Decode(&out); err != nil {
			t.Fatalf("decode: %v", err)
		}
		if out.Interval != "range:1000-2000" {
			t.Fatalf("interval: want %q, got %q", "range:1000-2000", out.Interval)
		}
		if out.Truncated {
			t.Fatalf("truncated: want false, got true")
		}
		if out.Total != 10 {
			t.Fatalf("total: want 10, got %d", out.Total)
		}
		if len(out.Miners) != 2 || out.Miners[0].Rank != 1 || out.Miners[0].Address != "Vsaaa" {
			t.Fatalf("miners: %#v", out.Miners)
		}
		// fees = paid - reward, computed server-side
		if out.Miners[0].MinerReward != "7000000000" || out.Miners[0].Fees != "10000" {
			t.Fatalf("row atoms: %#v", out.Miners[0])
		}
		if out.Totals.Addresses != 2 || out.Totals.Blocks != 10 ||
			out.Totals.MinerReward != "10000000000" || out.Totals.Fees != "14000" ||
			out.Totals.Total != "10000014000" {
			t.Fatalf("totals: %#v", out.Totals)
		}
	})

	t.Run("range has priority when interval is also set", func(t *testing.T) {
		rec := call("?from=1000&to=2000&interval=year")
		if rec.Code != http.StatusOK {
			t.Fatalf("status: want 200, got %d", rec.Code)
		}
		if mockDS.gotHashrateMin != 1000 || mockDS.gotHashrateMax != 2000 {
			t.Fatalf("window: want (1000, 2000), got (%d, %d)",
				mockDS.gotHashrateMin, mockDS.gotHashrateMax)
		}
	})

	t.Run("rejects from > to", func(t *testing.T) {
		rec := call("?from=2000&to=1000")
		if rec.Code != http.StatusBadRequest {
			t.Fatalf("status: want 400, got %d", rec.Code)
		}
	})

	t.Run("rejects negative heights", func(t *testing.T) {
		rec := call("?from=-1&to=100")
		if rec.Code != http.StatusBadRequest {
			t.Fatalf("status: want 400, got %d", rec.Code)
		}
	})

	t.Run("rejects non-numeric heights", func(t *testing.T) {
		rec := call("?from=abc&to=100")
		if rec.Code != http.StatusBadRequest {
			t.Fatalf("status: want 400, got %d", rec.Code)
		}
	})

	t.Run("rejects a range longer than the cap", func(t *testing.T) {
		rec := call("?from=1&to=100000000")
		if rec.Code != http.StatusBadRequest {
			t.Fatalf("status: want 400, got %d", rec.Code)
		}
	})

	t.Run("clamps to above the chain tip to the tip and marks truncated", func(t *testing.T) {
		rec := call("?from=10&to=99999")
		if rec.Code != http.StatusOK {
			t.Fatalf("status: want 200, got %d", rec.Code)
		}
		if mockDS.gotHashrateMax != tipHeight {
			t.Fatalf("max: want %d (tip), got %d", tipHeight, mockDS.gotHashrateMax)
		}
		var out resp
		if err := json.NewDecoder(rec.Body).Decode(&out); err != nil {
			t.Fatalf("decode: %v", err)
		}
		if !out.Truncated {
			t.Fatalf("truncated: want true, got false")
		}
	})

	t.Run("does not claim truncation when the whole range is beyond the tip", func(t *testing.T) {
		// from > tip: nothing in the range exists yet, so the range is left
		// untouched (no clamp, no inverted from/to) and truncated stays false —
		// "showing up to the tip only" would be misleading.
		rec := call("?from=6000&to=6001")
		if rec.Code != http.StatusOK {
			t.Fatalf("status: want 200, got %d", rec.Code)
		}
		if mockDS.gotHashrateMin != 6000 || mockDS.gotHashrateMax != 6001 {
			t.Fatalf("window: want (6000, 6001), got (%d, %d)",
				mockDS.gotHashrateMin, mockDS.gotHashrateMax)
		}
		var out resp
		if err := json.NewDecoder(rec.Body).Decode(&out); err != nil {
			t.Fatalf("decode: %v", err)
		}
		if out.Truncated {
			t.Fatalf("truncated: want false, got true")
		}
	})

	t.Run("interval branch passes tip as the upper bound", func(t *testing.T) {
		rec := call("?interval=week")
		if rec.Code != http.StatusOK {
			t.Fatalf("status: want 200, got %d", rec.Code)
		}
		if mockDS.gotHashrateMax != tipHeight {
			t.Fatalf("max: want %d (tip), got %d", tipHeight, mockDS.gotHashrateMax)
		}
	})
}

// TestHashrateSharesData_IntervalNoTip locks in the early-startup window: with
// no chain tip known yet, the interval branch must leave the upper bound open
// (the whole chain) instead of clamping to height 0.
func TestHashrateSharesData_IntervalNoTip(t *testing.T) {
	mockDS := &mockDataSource{
		blocks:       make(map[string]*types.BlockInfo),
		heights:      make(map[int64]string),
		hashrateRows: []dbtypes.MinerRewardCount{},
	}
	exp := &explorerUI{
		dataSource: mockDS,
		pageData:   &pageData{},
	}
	req := httptest.NewRequest(http.MethodGet, "/hashrate-shares/data?interval=week", nil)
	rec := httptest.NewRecorder()
	exp.HashrateSharesData(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status: want 200, got %d", rec.Code)
	}
	if mockDS.gotHashrateMax != math.MaxInt64 {
		t.Fatalf("max: want %d (open), got %d", math.MaxInt64, mockDS.gotHashrateMax)
	}
}

func TestMinerShares(t *testing.T) {
	t.Run("empty input", func(t *testing.T) {
		total, views, totals := minerShares(nil)
		if total != 0 || views != nil || totals.Addresses != 0 {
			t.Fatalf("want (0, nil, zero totals), got (%d, %#v, %#v)", total, views, totals)
		}
	})

	t.Run("single miner is 100.0", func(t *testing.T) {
		total, views, totals := minerShares([]dbtypes.MinerRewardCount{
			{Address: "Vsaaa", Count: 7, RewardAtoms: 7_000_000_000, PaidAtoms: 7_000_100_000},
		})
		if total != 7 {
			t.Fatalf("total: want 7, got %d", total)
		}
		if len(views) != 1 {
			t.Fatalf("len: want 1, got %d", len(views))
		}
		v := views[0]
		if v.Rank != 1 || v.Address != "Vsaaa" || v.Count != 7 || v.Percent != "100.0" {
			t.Fatalf("unexpected view: %#v", v)
		}
		// fees = paid - reward
		if v.MinerReward != "7000000000" || v.Fees != "100000" {
			t.Fatalf("row atoms: %#v", v)
		}
		if totals.Addresses != 1 || totals.Blocks != 7 ||
			totals.MinerReward != "7000000000" || totals.Fees != "100000" ||
			totals.Total != "7000100000" {
			t.Fatalf("totals: %#v", totals)
		}
	})

	t.Run("two miners 1-dp percents and ranks", func(t *testing.T) {
		total, views, _ := minerShares([]dbtypes.MinerRewardCount{
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
		_, views, _ := minerShares([]dbtypes.MinerRewardCount{
			{Address: "Vsbig", Count: 9996},
			{Address: "Vstiny", Count: 4}, // 0.04% -> "0.0"
		})
		if views[1].Address != "Vstiny" || views[1].Percent != "0.0" {
			t.Fatalf("tiny view: %#v", views[1])
		}
	})

	t.Run("returns every miner ranked, with no Others cap", func(t *testing.T) {
		// minerShares returns one ranked row per miner (no top-N truncation):
		// the client renders the full list and derives the pie's "Others"
		// aggregate itself. 30 miners in => 30 ranked rows out.
		rows := make([]dbtypes.MinerRewardCount, 0, 30)
		for i := 0; i < 25; i++ {
			rows = append(rows, dbtypes.MinerRewardCount{Address: "big", Count: 100})
		}
		for i := 0; i < 5; i++ {
			rows = append(rows, dbtypes.MinerRewardCount{Address: "small", Count: 10})
		}
		total, views, _ := minerShares(rows)
		if total != 2550 {
			t.Fatalf("total: want 2550, got %d", total)
		}
		if len(views) != 30 {
			t.Fatalf("len: want 30 (one row per miner), got %d", len(views))
		}
	})

	t.Run("ranks are 1-based, contiguous, and ordered by descending count", func(t *testing.T) {
		views := func() []MinerShareView {
			_, v, _ := minerShares([]dbtypes.MinerRewardCount{
				{Address: "c", Count: 5},
				{Address: "a", Count: 50},
				{Address: "b", Count: 20},
			})
			return v
		}()
		want := []struct {
			rank int
			addr string
		}{{1, "a"}, {2, "b"}, {3, "c"}}
		if len(views) != len(want) {
			t.Fatalf("len: want %d, got %d", len(want), len(views))
		}
		for i, w := range want {
			if views[i].Rank != w.rank || views[i].Address != w.addr {
				t.Fatalf("view[%d]: want rank %d addr %q, got %#v", i, w.rank, w.addr, views[i])
			}
		}
	})
}
