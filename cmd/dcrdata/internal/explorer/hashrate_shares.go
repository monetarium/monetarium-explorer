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

// MinerShareView is one rendered row of the hashrate-shares view: a ranked miner
// reward address with its reward-tx count and 1-decimal percent share.
type MinerShareView struct {
	Rank    int    `json:"rank"`
	Address string `json:"address"`
	Count   int64  `json:"count"`
	Percent string `json:"percent"` // pre-formatted to 1 decimal place, e.g. "32.2"
}

// minerShares converts raw per-miner reward counts into ranked views with
// 1-decimal-place percent shares of the network total. It sorts descending by
// count and returns one row per miner (no top-N truncation): the client
// paginates the full list and derives the pie's "Others" aggregate itself. The
// denominator is the total across all miners, so shares sum to ~100%. Returns
// (0, nil) when there is no data.
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

	views = make([]MinerShareView, len(sorted))
	for i, r := range sorted {
		views[i] = MinerShareView{
			Rank:    i + 1,
			Address: r.Address,
			Count:   r.Count,
			Percent: pct(r.Count),
		}
	}

	return total, views
}

// intervalMinHeight maps an interval label to the minimum block height of the
// window, relative to the chain tip time. "all" (and anything unrecognized)
// returns 0 (whole chain). day/week/month/year subtract the corresponding
// duration from the tip time and map it to a height via the data source.
func (exp *explorerUI) intervalMinHeight(ctx context.Context, interval string) (int64, error) {
	var dur time.Duration
	switch interval {
	case "day":
		dur = 24 * time.Hour
	case "week":
		dur = 7 * 24 * time.Hour
	case "month":
		dur = 30 * 24 * time.Hour
	case "year":
		dur = 365 * 24 * time.Hour
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
// for the /hashrate-shares page controller. Query param: ?interval=all|year|month|week|day.
func (exp *explorerUI) HashrateSharesData(w http.ResponseWriter, r *http.Request) {
	interval := r.URL.Query().Get("interval")
	switch interval {
	case "all", "year", "month", "week", "day":
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
