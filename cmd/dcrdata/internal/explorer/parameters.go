// Copyright (c) 2025, The Monetarium developers
// See LICENSE for details.

package explorer

import (
	"math/big"
	"sort"
	"strconv"
	"strings"

	"github.com/monetarium/monetarium-explorer/explorer/types"
	"github.com/monetarium/monetarium-node/chaincfg"
	"github.com/monetarium/monetarium-node/cointype"
)

// buildSKACoinParams walks chaincfg.Params.SKACoins in CoinType order and
// returns a pre-formatted view-model slice for the /parameters template. All
// 18-decimal SKA atom values are converted to plain decimal strings via
// formatAtomsAsCoinString; no *big.Int crosses the template boundary (see
// wiki/core/constraints.md#C1).
func buildSKACoinParams(params *chaincfg.Params) []types.SKACoinParam {
	if len(params.SKACoins) == 0 {
		return nil
	}

	initial := make(map[cointype.CoinType]struct{}, len(params.InitialSKATypes))
	for _, ct := range params.InitialSKATypes {
		initial[ct] = struct{}{}
	}

	coinTypes := make([]cointype.CoinType, 0, len(params.SKACoins))
	for ct := range params.SKACoins {
		coinTypes = append(coinTypes, ct)
	}
	sort.Slice(coinTypes, func(i, j int) bool { return coinTypes[i] < coinTypes[j] })

	out := make([]types.SKACoinParam, 0, len(coinTypes))
	for _, ct := range coinTypes {
		c := params.SKACoins[ct]
		if c == nil {
			continue
		}
		_, initiallyActive := initial[ct]

		emissionAmounts := make([]string, len(c.EmissionAmounts))
		for i, amt := range c.EmissionAmounts {
			emissionAmounts[i] = formatBigIntAsSKAString(amt)
		}

		out = append(out, types.SKACoinParam{
			CoinType:          uint8(ct),
			Label:             "SKA" + strconv.Itoa(int(ct)),
			Name:              c.Name,
			Symbol:            c.Symbol,
			Description:       c.Description,
			Active:            c.Active,
			InitiallyActive:   initiallyActive,
			MaxSupply:         formatBigIntAsSKAString(c.MaxSupply),
			AtomsPerCoin:      formatBigIntWithCommas(c.AtomsPerCoin),
			MinRelayTxFee:     formatBigIntAsSKAString(c.MinRelayTxFee),
			MaxFeeMultiplier:  c.MaxFeeMultiplier,
			EmissionHeight:    c.EmissionHeight,
			EmissionWindow:    c.EmissionWindow,
			EmissionAddresses: append([]string(nil), c.EmissionAddresses...),
			EmissionAmounts:   emissionAmounts,
		})
	}
	return out
}

// formatBigIntAsSKAString renders an SKA atom *big.Int as a full-precision
// 18-decimal coin string with thousands separators, no rounding and no
// scientific notation. Whole-coin values render without a trailing decimal
// point. nil renders as "0".
func formatBigIntAsSKAString(n *big.Int) string {
	if n == nil {
		return "0"
	}
	// formatAtomsAsCoinString switches on coinType: 0 → VAR (8 dec), any other
	// → SKA (18 dec). Use CoinTypeMax to make the SKA intent obvious.
	s := formatAtomsAsCoinString(n.String(), uint8(cointype.CoinTypeMax), 0)
	// With minDecimals=0 and a whole-coin value, formatAtomsAsCoinString
	// trims the fractional digits down to "" and still appends a stray "."
	// (e.g. "900,000,000,000,000."). Strip that trailing dot.
	return strings.TrimSuffix(s, ".")
}

// formatBigIntWithCommas renders a *big.Int as a base-10 integer with
// thousands separators. Used for AtomsPerCoin (the per-coin atomic scale,
// meaningful as an integer, not a coin amount).
func formatBigIntWithCommas(n *big.Int) string {
	if n == nil {
		return "0"
	}
	s := n.String()
	prefix := ""
	if strings.HasPrefix(s, "-") {
		prefix = "-"
		s = s[1:]
	}
	if len(s) <= 3 {
		return prefix + s
	}
	var out []byte
	for i := 0; i < len(s); i++ {
		if i > 0 && (len(s)-i)%3 == 0 {
			out = append(out, ',')
		}
		out = append(out, s[i])
	}
	return prefix + string(out)
}
