package explorer

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"sort"
	"strconv"
	"time"

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
		interval = "week"
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
