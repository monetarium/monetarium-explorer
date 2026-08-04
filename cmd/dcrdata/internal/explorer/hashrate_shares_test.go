package explorer

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/monetarium/monetarium-explorer/db/dbtypes"
	"github.com/monetarium/monetarium-explorer/explorer/types"
)

// TestHashrateSharesData_CustomRange drives the custom first_block/last_block
// branch of HashrateSharesData. It verifies param validation (including the
// chain-tip cap), that the data source receives the parsed range, and that the
// response JSON carries the custom interval label and shares.
func TestHashrateSharesData_CustomRange(t *testing.T) {
	const tipHeight = int64(5000)
	mockDS := &mockDataSource{
		blocks:  make(map[string]*types.BlockInfo),
		heights: make(map[int64]string),
		hashrateRangeRows: []dbtypes.MinerRewardCount{
			{Address: "Vsaaa", Count: 7},
			{Address: "Vsbbb", Count: 3},
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

	t.Run("passes parsed range to the data source", func(t *testing.T) {
		rec := call("?first_block=1000&last_block=2000")
		if rec.Code != http.StatusOK {
			t.Fatalf("status: want 200, got %d", rec.Code)
		}
		if mockDS.gotHashrateFirst != 1000 || mockDS.gotHashrateLast != 2000 {
			t.Fatalf("range: want (1000, 2000), got (%d, %d)",
				mockDS.gotHashrateFirst, mockDS.gotHashrateLast)
		}

		var resp struct {
			Interval string           `json:"interval"`
			Total    int64            `json:"total"`
			Miners   []MinerShareView `json:"miners"`
		}
		if err := json.NewDecoder(rec.Body).Decode(&resp); err != nil {
			t.Fatalf("decode: %v", err)
		}
		if resp.Interval != "custom:1000-2000" {
			t.Fatalf("interval: want %q, got %q", "custom:1000-2000", resp.Interval)
		}
		if resp.Total != 10 {
			t.Fatalf("total: want 10, got %d", resp.Total)
		}
		if len(resp.Miners) != 2 || resp.Miners[0].Rank != 1 || resp.Miners[0].Address != "Vsaaa" {
			t.Fatalf("miners: %#v", resp.Miners)
		}
	})

	t.Run("rejects first > last", func(t *testing.T) {
		rec := call("?first_block=2000&last_block=1000")
		if rec.Code != http.StatusBadRequest {
			t.Fatalf("status: want 400, got %d", rec.Code)
		}
	})

	t.Run("rejects negative heights", func(t *testing.T) {
		rec := call("?first_block=-1&last_block=100")
		if rec.Code != http.StatusBadRequest {
			t.Fatalf("status: want 400, got %d", rec.Code)
		}
	})

	t.Run("rejects last beyond chain tip", func(t *testing.T) {
		rec := call("?first_block=10&last_block=999999")
		if rec.Code != http.StatusBadRequest {
			t.Fatalf("status: want 400, got %d", rec.Code)
		}
	})

	t.Run("rejects non-numeric heights", func(t *testing.T) {
		rec := call("?first_block=abc&last_block=100")
		if rec.Code != http.StatusBadRequest {
			t.Fatalf("status: want 400, got %d", rec.Code)
		}
	})
}

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
		if v.Rank != 1 || v.Address != "Vsaaa" || v.Count != 7 || v.Percent != "100.0" {
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

	t.Run("returns every miner ranked, with no Others cap", func(t *testing.T) {
		// The view no longer truncates to a top-N + "Others" aggregate: it
		// returns one ranked row per miner so the client can paginate the full
		// set (the pie's "Others" bucket is derived client-side). 30 miners in
		// => 30 ranked rows out.
		rows := make([]dbtypes.MinerRewardCount, 0, 30)
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
		if len(views) != 30 {
			t.Fatalf("len: want 30 (one row per miner), got %d", len(views))
		}
	})

	t.Run("ranks are 1-based, contiguous, and ordered by descending count", func(t *testing.T) {
		views := func() []MinerShareView {
			_, v := minerShares([]dbtypes.MinerRewardCount{
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
