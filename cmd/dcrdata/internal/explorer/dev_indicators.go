// Debug-only fixture page for the home-page mempool fill indicators. The
// route is registered by main only when --reload-html is set, so the handler
// is not exposed in production builds.

package explorer

import (
	"io"
	"net/http"

	"github.com/monetarium/monetarium-explorer/explorer/types"
)

// DevIndicators renders /dev/indicators with a hand-crafted set of
// MempoolInfo fixtures, exercising every status the per-coin fill bar can be
// in (ok / borrowing / full) for the no-SKA, single-SKA, and multi-SKA cases.
//
// The fixtures pass through the same computeCoinFills code path as live data,
// so the rendered indicators reflect what the production code actually
// produces — which makes this page a useful eyeball test for designers and
// for verifying regressions like the one that motivated this file.
func (exp *explorerUI) DevIndicators(w http.ResponseWriter, r *http.Request) {
	str, err := exp.templates.exec("dev_indicators", struct {
		*CommonPageData
		Scenarios []devIndicatorScenario
	}{
		CommonPageData: exp.commonData(r),
		Scenarios:      buildDevIndicatorScenarios(),
	})
	if err != nil {
		log.Errorf("Template execute failure: %v", err)
		exp.StatusPage(w, defaultErrorCode, defaultErrorMessage, "", ExpStatusError)
		return
	}
	w.Header().Set("Content-Type", "text/html")
	w.WriteHeader(http.StatusOK)
	io.WriteString(w, str) //nolint:errcheck
}

// devIndicatorScenario is the per-card payload consumed by dev_indicators.tmpl.
// The Mempool field is what the embedded mempoolCard template reads from;
// the surrounding template renders Title and Description.
type devIndicatorScenario struct {
	Title       string
	Description string
	Mempool     *types.MempoolInfo
}

// buildDevIndicatorScenarios assembles the canonical fixture set. Each
// scenario is built by handing computeCoinFills a synthetic mempool stats
// map, so the resulting CoinFillData is byte-for-byte what production code
// would emit for the same conditions.
func buildDevIndicatorScenarios() []devIndicatorScenario {
	// 100 keeps the pct math human-readable: "10 of 100 = 10%".
	const maxBlock = 100.0

	mkMempool := func(stats map[uint8]types.MempoolCoinStats, issued []uint8) *types.MempoolInfo {
		fills, totalFill, activeSKA := computeCoinFills(stats, maxBlock, issued)
		mp := &types.MempoolInfo{}
		mp.MempoolShort.CoinFills = fills
		mp.MempoolShort.TotalFillRatio = totalFill
		mp.MempoolShort.ActiveSKACount = activeSKA
		mp.CoinFills = fills
		return mp
	}

	return []devIndicatorScenario{
		{
			Title:       "Empty mempool",
			Description: "No transactions of any coin. VAR bar shows 0%; no SKA bars (no issued SKA).",
			Mempool:     mkMempool(nil, nil),
		},
		{
			Title:       "VAR within quota — 5% of block",
			Description: "Below the 10% guarantee. TOTAL and VAR labels should both read 5.0%.",
			Mempool:     mkMempool(map[uint8]types.MempoolCoinStats{0: {Size: 5}}, nil),
		},
		{
			Title:       "VAR borrowing, no SKA — 15% of block (regression case)",
			Description: "VAR uses 15% of block; no SKA active. Pre-fix this rendered 10.0% on the VAR bar while TOTAL showed 15.0%. Both should now read 15.0%.",
			Mempool:     mkMempool(map[uint8]types.MempoolCoinStats{0: {Size: 15}}, nil),
		},
		{
			Title:       "VAR full + overflow — 110% of block",
			Description: "VAR alone exceeds block capacity. Both bars clamp to 100% and show the overflow hatch.",
			Mempool:     mkMempool(map[uint8]types.MempoolCoinStats{0: {Size: 110}}, nil),
		},
		{
			Title:       "1 SKA active, both within quotas",
			Description: "VAR=5, SKA1=40 (out of 90 quota). All bars green; cumulative 45% on TOTAL.",
			Mempool: mkMempool(
				map[uint8]types.MempoolCoinStats{0: {Size: 5}, 1: {Size: 40}},
				nil,
			),
		},
		{
			Title:       "2 SKAs active, SKA1 borrowing into SKA2's space",
			Description: "Each SKA has 45% quota. SKA1 uses 50, SKA2 uses 0 — block has room so SKA1 status is 'borrowing'.",
			Mempool: mkMempool(
				map[uint8]types.MempoolCoinStats{1: {Size: 50}, 2: {Size: 0}},
				nil,
			),
		},
		{
			Title:       "SKA1 quota exceeded, can't borrow — over capacity",
			Description: "1 SKA active. VAR=5, SKA1=110 — SKA1 alone exceeds its 90% quota AND total block (115% > 100%). Status=full, percentage text shows the true 110.0% magnitude per PO.",
			Mempool: mkMempool(
				map[uint8]types.MempoolCoinStats{0: {Size: 5}, 1: {Size: 110}},
				nil,
			),
		},
		{
			Title:       "2 SKAs both full — VAR 5%, SKA1 50%, SKA2 50%",
			Description: "Block at 105%. Each SKA quota=45%. SKA1 and SKA2 each at 50% individually — both exceed their own quota AND there's no room left to borrow, so both end up status=full with 5% of overflow each. VAR is fine within its quota.",
			Mempool: mkMempool(
				map[uint8]types.MempoolCoinStats{
					0: {Size: 5},
					1: {Size: 50},
					2: {Size: 50},
				},
				nil,
			),
		},
		{
			Title:       "3 SKAs: one ok, one borrowing, one zero",
			Description: "VAR=5, SKA1=20 (within own 30 quota), SKA2=35 (borrowing past own 30 quota), SKA3 issued but empty.",
			Mempool: mkMempool(
				map[uint8]types.MempoolCoinStats{
					0: {Size: 5},
					1: {Size: 20},
					2: {Size: 35},
				},
				[]uint8{1, 2, 3},
			),
		},
		{
			Title:       "Issued-but-empty SKA stays visible",
			Description: "Only VAR active. SKA5 was issued on-chain but has no mempool txs — its bar is rendered at 0% as a placeholder.",
			Mempool: mkMempool(
				map[uint8]types.MempoolCoinStats{0: {Size: 8}},
				[]uint8{5},
			),
		},
	}
}
