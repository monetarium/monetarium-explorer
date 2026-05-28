// Copyright (c) 2025, The Monetarium developers
// See LICENSE for details.

package explorer

import (
	"math/big"
	"strings"
	"testing"

	"github.com/monetarium/monetarium-node/chaincfg"
)

func TestFormatBigIntAsSKAString(t *testing.T) {
	mustBig := func(s string) *big.Int {
		n, ok := new(big.Int).SetString(s, 10)
		if !ok {
			t.Fatalf("bad bigint literal %q", s)
		}
		return n
	}

	cases := []struct {
		name string
		in   *big.Int
		want string
	}{
		{"nil", nil, "0"},
		{"zero", big.NewInt(0), "0"},
		{"one atom (smallest unit)", big.NewInt(1), "0.000000000000000001"},
		{"sub-coin", big.NewInt(500_000_000_000_000_000), "0.5"},
		{"one whole coin", mustBig("1000000000000000000"), "1"},
		{"four whole coins (MinRelayTxFee mainnet)", mustBig("4000000000000000000"), "4"},
		{"five million coins (SKA-2 MaxSupply)", mustBig("5000000000000000000000000"), "5,000,000"},
		{
			"nine hundred trillion coins (SKA-1 MaxSupply)",
			mustBig("900000000000000000000000000000000"),
			"900,000,000,000,000",
		},
		{"non-integer coin amount", mustBig("1234500000000000000"), "1.2345"},
		{"sub-coin with leading fractional zeros", mustBig("100000000000000"), "0.0001"},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := formatBigIntAsSKAString(tc.in)
			if got != tc.want {
				t.Errorf("formatBigIntAsSKAString(%v) = %q, want %q", tc.in, got, tc.want)
			}
			// Anti-regression guards on the whole class of formatter glitches:
			if strings.HasSuffix(got, ".") {
				t.Errorf("trailing decimal point in %q", got)
			}
			if strings.HasPrefix(got, ".") {
				t.Errorf("leading decimal point in %q", got)
			}
			if strings.ContainsAny(got, "eE") {
				t.Errorf("scientific notation in %q", got)
			}
		})
	}
}

func TestFormatBigIntWithCommas(t *testing.T) {
	cases := []struct {
		name string
		in   *big.Int
		want string
	}{
		{"nil", nil, "0"},
		{"zero", big.NewInt(0), "0"},
		{"single digit", big.NewInt(7), "7"},
		{"three digits", big.NewInt(123), "123"},
		{"four digits", big.NewInt(1234), "1,234"},
		{"seven digits", big.NewInt(1_000_000), "1,000,000"},
		{
			"AtomsPerCoin (1e18)",
			new(big.Int).Exp(big.NewInt(10), big.NewInt(18), nil),
			"1,000,000,000,000,000,000",
		},
		{"negative", big.NewInt(-1234567), "-1,234,567"},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := formatBigIntWithCommas(tc.in)
			if got != tc.want {
				t.Errorf("formatBigIntWithCommas(%v) = %q, want %q", tc.in, got, tc.want)
			}
			if strings.Contains(got, ".") {
				t.Errorf("integer formatter emitted a decimal point in %q", got)
			}
		})
	}
}

func TestBuildSKACoinParams_Mainnet(t *testing.T) {
	got := buildSKACoinParams(chaincfg.MainNetParams(), 0, nil)
	if len(got) < 1 {
		t.Fatalf("expected >=1 SKA entries on mainnet, got %d", len(got))
	}

	// Entries must be sorted by CoinType.
	for i := 1; i < len(got); i++ {
		if got[i-1].CoinType >= got[i].CoinType {
			t.Fatalf("SKA entries not sorted by CoinType: %d before %d", got[i-1].CoinType, got[i].CoinType)
		}
	}

	first := got[0]
	if first.CoinType != 1 {
		t.Errorf("first CoinType=%d, want 1", first.CoinType)
	}
	if first.Label != "SKA1" {
		t.Errorf("first Label=%q, want %q (no dash)", first.Label, "SKA1")
	}
	if !first.InitiallyActive {
		t.Error("SKA1 should be in InitialSKATypes")
	}
	if !first.Active {
		t.Error("SKA1 should be Active")
	}
	if !strings.Contains(first.MaxSupply, ",") {
		t.Errorf("MaxSupply=%q has no thousands separators", first.MaxSupply)
	}
	if strings.ContainsAny(first.MaxSupply, "eE") {
		t.Errorf("MaxSupply=%q must not use scientific notation", first.MaxSupply)
	}
	if strings.HasSuffix(first.MaxSupply, ".") {
		t.Errorf("MaxSupply=%q must not have a trailing decimal point for whole-coin values", first.MaxSupply)
	}

	const wantAtomsPerCoin = "1,000,000,000,000,000,000"
	if first.AtomsPerCoin != wantAtomsPerCoin {
		t.Errorf("AtomsPerCoin=%q, want %q", first.AtomsPerCoin, wantAtomsPerCoin)
	}

	if len(first.EmissionAddresses) == 0 {
		t.Error("SKA1 should have at least one EmissionAddress")
	}
	if len(first.EmissionAmounts) != len(first.EmissionAddresses) {
		t.Errorf("EmissionAmounts len=%d != EmissionAddresses len=%d",
			len(first.EmissionAmounts), len(first.EmissionAddresses))
	}
}

func TestBuildSKACoinParams_OtherNets(t *testing.T) {
	// Must not panic and must produce non-empty output where SKACoins are
	// configured. simnet/testnet/regnet may differ in coin sets but the
	// builder should work uniformly.
	for _, p := range []*chaincfg.Params{
		chaincfg.SimNetParams(),
		chaincfg.TestNet3Params(),
		chaincfg.RegNetParams(),
	} {
		got := buildSKACoinParams(p, 0, nil)
		_ = got // existence + no panic is the contract; SKACoins may be empty.
	}
}

func TestBuildSKACoinParams_RuntimeOverride(t *testing.T) {
	params := chaincfg.TestNet3Params()
	maturity := int64(params.CoinbaseMaturity)

	tests := []struct {
		name           string
		chainHeight    int64
		emissionHeight int64
		wantActive     bool
		wantPending    bool
	}{
		{
			name:           "emitted, still maturing",
			chainHeight:    150000 + maturity - 1,
			emissionHeight: 150000,
			wantActive:     false,
			wantPending:    true,
		},
		{
			name:           "emitted, past maturity",
			chainHeight:    150000 + maturity,
			emissionHeight: 150000,
			wantActive:     true,
			wantPending:    false,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			heights := map[uint8]int64{2: tc.emissionHeight}
			got := buildSKACoinParams(params, tc.chainHeight, heights)
			found := -1
			for i := range got {
				if got[i].CoinType == 2 {
					found = i
					break
				}
			}
			if found == -1 {
				t.Fatal("expected SKA2 coin type 2")
			}
			if got[found].Active != tc.wantActive {
				t.Errorf("Active = %v, want %v", got[found].Active, tc.wantActive)
			}
			if got[found].Pending != tc.wantPending {
				t.Errorf("Pending = %v, want %v", got[found].Pending, tc.wantPending)
			}
		})
	}
}
