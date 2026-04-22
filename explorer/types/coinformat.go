package types

import (
	"fmt"
	"math/big"
	"strings"
)

// atomsPerVAR is 1e8 (VAR has 8 decimal places).
const atomsPerVAR = 1e8

// atomsPerSKA is 10^18 (SKA has 18 decimal places).
var atomsPerSKA = new(big.Int).Exp(big.NewInt(10), big.NewInt(18), nil)

// suffixes for 3-sig-fig formatting.
var amountSuffixes = []struct {
	threshold *big.Float
	suffix    string
}{
	{big.NewFloat(1e12), "T"},
	{big.NewFloat(1e9), "B"},
	{big.NewFloat(1e6), "M"},
	{big.NewFloat(1e3), "K"},
}

// threeSignificantFigs formats a *big.Float to 3 significant figures with K/M/B/T suffix.
func threeSignificantFigs(f *big.Float) string {
	for _, s := range amountSuffixes {
		if f.Cmp(s.threshold) >= 0 {
			v := new(big.Float).Quo(f, s.threshold)
			return fmt.Sprintf("%.3g%s", v, s.suffix)
		}
	}
	return fmt.Sprintf("%.3g", f)
}

// FormatVARAmount formats a VAR amount (int64 atoms) as a human-readable string.
// If full is true, returns full decimal precision (e.g. "1.23456789 VAR").
// If full is false, returns 3 significant figures with K/M/B/T suffix (e.g. "1.23M VAR").
func FormatVARAmount(atoms int64, full bool) string {
	coins := new(big.Float).Quo(new(big.Float).SetInt64(atoms), big.NewFloat(atomsPerVAR))
	if full {
		return fmt.Sprintf("%s VAR", coins.Text('f', 8))
	}
	return threeSignificantFigs(coins) + " VAR"
}

// FormatSKAAmount formats a SKA amount (decimal atom string) as a human-readable string.
// coinType is the SKA type number (1-255).
// If full is true, returns full decimal precision (18 decimals).
// If full is false, returns 3 significant figures with K/M/B/T suffix.
func FormatSKAAmount(atomsStr string, coinType uint8, full bool) string {
	label := fmt.Sprintf("SKA%d", coinType)
	atoms, ok := new(big.Int).SetString(atomsStr, 10)
	if !ok {
		return "0 " + label
	}
	coins := new(big.Float).Quo(new(big.Float).SetInt(atoms), new(big.Float).SetInt(atomsPerSKA))
	if full {
		// Trim trailing zeros after decimal point.
		s := coins.Text('f', 18)
		if strings.Contains(s, ".") {
			s = strings.TrimRight(s, "0")
			s = strings.TrimRight(s, ".")
		}
		return s + " " + label
	}
	return threeSignificantFigs(coins) + " " + label
}
