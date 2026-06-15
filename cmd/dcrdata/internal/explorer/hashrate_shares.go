package explorer

import (
	"sort"
	"strconv"

	"github.com/monetarium/monetarium-explorer/db/dbtypes"
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
