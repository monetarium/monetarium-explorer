package explorer

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"net/http"
	"sort"
	"strconv"
	"time"

	"github.com/monetarium/monetarium-explorer/db/dbtypes"
)

// maxHashrateShareRange is the maximum length of a custom block range
// (to - from), per the hashrate-shares block-range spec §10.2: the data
// endpoint is public and deliberately uncached, so an arbitrary range from an
// outsider is an open DB query. 100,000 blocks is far beyond the current chain
// length (~20k) while still bounding a hostile request. The block_height index
// keeps a capped range cheaper than the open-ended interval query.
const maxHashrateShareRange = 100_000

// MinerShareView is one rendered row of the hashrate-shares view: a ranked
// miner reward address with its block count, 1-decimal percent share of the
// total blocks, and the VAR atoms the address received for those blocks.
// Atom values are JSON strings per the spec §4.6 (formatted client-side); Fees
// is computed server-side as paid - reward (spec §9).
type MinerShareView struct {
	Rank        int    `json:"rank"`
	Address     string `json:"address"`
	Count       int64  `json:"count"`
	Percent     string `json:"percent"` // pre-formatted to 1 decimal place, e.g. "32.2"
	MinerReward string `json:"miner_reward"`
	Fees        string `json:"fees"`
}

// hashrateSharesTotals aggregates the whole period (spec §4.2): the number of
// reward addresses, the total distinct blocks, the total miner reward, the
// total fees, and their sum. Atoms are strings as in MinerShareView.
type hashrateSharesTotals struct {
	Addresses   int64  `json:"addresses"`
	Blocks      int64  `json:"blocks"`
	MinerReward string `json:"miner_reward"`
	Fees        string `json:"fees"`
	Total       string `json:"total"`
}

// minerShares converts raw per-miner reward data into ranked views with
// 1-decimal-place percent shares of the period's total blocks, plus the
// period totals. It sorts descending by count and returns one row per miner
// (no top-N truncation): the client renders the full list and derives the
// pie's "Others" aggregate itself. The denominator for percents is the total
// across all miners, so shares sum to ~100%. Fees = paid - reward is computed
// here (both atom values already live in the DB rows); the total sum is
// reward + fees. Returns zero-valued views/totals when there is no data.
func minerShares(rows []dbtypes.MinerRewardCount) (total int64, views []MinerShareView, totals hashrateSharesTotals) {
	if len(rows) == 0 {
		return 0, nil, hashrateSharesTotals{}
	}

	for _, r := range rows {
		total += r.Count
	}

	pct := func(c int64) string {
		return strconv.FormatFloat(float64(c)/float64(total)*100, 'f', 1, 64)
	}

	sorted := append([]dbtypes.MinerRewardCount(nil), rows...)
	sort.SliceStable(sorted, func(i, j int) bool { return sorted[i].Count > sorted[j].Count })

	views = make([]MinerShareView, len(sorted))
	var rewardTotal, feesTotal int64
	for i, r := range sorted {
		fees := r.PaidAtoms - r.RewardAtoms
		rewardTotal += r.RewardAtoms
		feesTotal += fees
		views[i] = MinerShareView{
			Rank:        i + 1,
			Address:     r.Address,
			Count:       r.Count,
			Percent:     pct(r.Count),
			MinerReward: strconv.FormatInt(r.RewardAtoms, 10),
			Fees:        strconv.FormatInt(fees, 10),
		}
	}

	totals = hashrateSharesTotals{
		Addresses:   int64(len(sorted)),
		Blocks:      total,
		MinerReward: strconv.FormatInt(rewardTotal, 10),
		Fees:        strconv.FormatInt(feesTotal, 10),
		Total:       strconv.FormatInt(rewardTotal+feesTotal, 10),
	}

	return total, views, totals
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

// tipHeight returns the current chain tip height, or (0, false) when no tip is
// known yet (early startup).
func (exp *explorerUI) tipHeight() (int64, bool) {
	exp.pageData.RLock()
	defer exp.pageData.RUnlock()
	if exp.pageData.BlockInfo == nil || exp.pageData.BlockInfo.BlockBasic == nil {
		return 0, false
	}
	return exp.pageData.BlockInfo.Height, true
}

// HashrateSharesData serves the per-period miner hashrate-share data as JSON
// for the /hashrate-shares page controller. Query params (spec §3.2):
//
//	?from=N&to=M                       — explicit inclusive block range (priority)
//	?interval=all|year|month|week|day  — standard time window
//
// The range is validated per spec §3.3: non-numeric/negative heights or from > to
// are rejected with 400; a range longer than maxHashrateShareRange is refused
// naming the cap; to above the chain tip is clamped to the tip with
// truncated=true instead of failing. Both from/to and interval present → the
// range wins. The response carries the period totals (spec §4.2).
func (exp *explorerUI) HashrateSharesData(w http.ResponseWriter, r *http.Request) {
	fromStr := r.URL.Query().Get("from")
	toStr := r.URL.Query().Get("to")

	var (
		rows      []dbtypes.MinerRewardCount
		interval  string
		truncated bool
		err       error
	)

	ctx := r.Context()

	if fromStr != "" && toStr != "" {
		from, err1 := strconv.ParseInt(fromStr, 10, 64)
		to, err2 := strconv.ParseInt(toStr, 10, 64)
		if err1 != nil || err2 != nil || from < 0 || to < 0 {
			hashrateError(w, "Invalid block range. Provide from and to as non-negative block heights.")
			return
		}
		if from > to {
			hashrateError(w, "Invalid block range. from must be <= to.")
			return
		}
		// to beyond the chain tip is clamped, not rejected (spec §3.3), and the
		// length cap is applied to the effective (clamped) range: a to far past
		// the tip just means "to now". A range entirely ahead of the tip
		// (from > tip) has nothing to clamp and nothing to show, so it is left
		// untouched and truncated stays false — claiming a partial result would
		// be misleading. Without a known tip there is nothing to clamp to, so
		// the raw range length is still capped (the hostile-request guard).
		if tip, ok := exp.tipHeight(); ok && to > tip && from <= tip {
			truncated = true
			to = tip
		}
		if to-from > maxHashrateShareRange {
			hashrateError(w, fmt.Sprintf("Block range too long. Maximum range length is %d blocks.", maxHashrateShareRange))
			return
		}

		rows, err = exp.dataSource.MinerHashrateShares(ctx, from, to)
		interval = fmt.Sprintf("range:%d-%d", from, to)
	} else {
		interval = r.URL.Query().Get("interval")
		switch interval {
		case "all", "year", "month", "week", "day":
		default:
			interval = "week"
		}

		minHeight, minErr := exp.intervalMinHeight(ctx, interval)
		if minErr != nil {
			log.Errorf("hashrate-shares: intervalMinHeight: %v", minErr)
			http.Error(w, http.StatusText(http.StatusInternalServerError), http.StatusInternalServerError)
			return
		}

		// Interval windows always end at the chain tip. With no tip known yet
		// (early startup) the upper bound is left open (the whole chain): the
		// SQL window is [minHeight, maxHeight], so an open upper bound is
		// MaxInt64, not 0.
		maxHeight := int64(math.MaxInt64)
		if tip, ok := exp.tipHeight(); ok {
			maxHeight = tip
		}
		rows, err = exp.dataSource.MinerHashrateShares(ctx, minHeight, maxHeight)
	}

	if err != nil {
		log.Errorf("hashrate-shares: MinerHashrateShares: %v", err)
		http.Error(w, http.StatusText(http.StatusInternalServerError), http.StatusInternalServerError)
		return
	}

	total, views, totals := minerShares(rows)
	if views == nil {
		views = []MinerShareView{} // emit [] not null
	}

	resp := struct {
		Interval  string               `json:"interval"`
		Total     int64                `json:"total"`
		Miners    []MinerShareView     `json:"miners"`
		Totals    hashrateSharesTotals `json:"totals"`
		Truncated bool                 `json:"truncated"`
	}{
		Interval:  interval,
		Total:     total,
		Miners:    views,
		Totals:    totals,
		Truncated: truncated,
	}

	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(resp); err != nil {
		log.Errorf("hashrate-shares: encode: %v", err)
	}
}

// hashrateError writes a 400 response with a JSON error body.
func hashrateError(w http.ResponseWriter, msg string) {
	body, err := json.Marshal(map[string]string{"error": msg})
	if err != nil {
		http.Error(w, msg, http.StatusBadRequest)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusBadRequest)
	w.Write(body)
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
