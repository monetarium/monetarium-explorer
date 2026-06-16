package explorer

import (
	"testing"

	"github.com/monetarium/monetarium-explorer/db/dbtypes"
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
