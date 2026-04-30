// Copyright (c) 2024, The Monetarium developers
// Use of this source code is governed by an ISC
// license that can be found in the LICENSE file.

package txhelpers

import (
	"math/big"
	"testing"
)

// ---------------------------------------------------------------------------
// FormatSKAAtoms
// ---------------------------------------------------------------------------

func TestFormatSKAAtoms(t *testing.T) {
	tests := []struct {
		name string
		in   *big.Int
		want string
	}{
		{"nil input", nil, "0"},
		{"zero", big.NewInt(0), "0"},
		{"negative", big.NewInt(-1), "0"},
		{"one atom", big.NewInt(1), "1"},
		{"one coin (1e18)", new(big.Int).Exp(big.NewInt(10), big.NewInt(18), nil), "1000000000000000000"},
		{"large value", func() *big.Int {
			v, _ := new(big.Int).SetString("123456789012345678901234567890", 10)
			return v
		}(), "123456789012345678901234567890"},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := FormatSKAAtoms(tc.in)
			if got != tc.want {
				t.Errorf("FormatSKAAtoms(%v) = %q, want %q", tc.in, got, tc.want)
			}
		})
	}
}

// ---------------------------------------------------------------------------
// FormatSKAPerVAR
// ---------------------------------------------------------------------------

func TestFormatSKAPerVAR(t *testing.T) {
	zero18 := "0.000000000000000000"

	tests := []struct {
		name     string
		skaAtoms *big.Int
		varAtoms int64
		want     string
	}{
		{"nil ska", nil, 1e8, zero18},
		{"zero ska", big.NewInt(0), 1e8, zero18},
		{"negative ska", big.NewInt(-1), 1e8, zero18},
		{"zero var", big.NewInt(1e18), 0, zero18},
		{"negative var", big.NewInt(1e18), -1, zero18},
		// 1 SKA coin per 1 VAR coin: skaAtoms=1e18, varAtoms=1e8 → ratio=1.0
		{"1 SKA per 1 VAR", new(big.Int).Exp(big.NewInt(10), big.NewInt(18), nil), 1e8, "1.000000000000000000"},
		// 0.5 SKA per 1 VAR: skaAtoms=5e17, varAtoms=1e8
		{"0.5 SKA per 1 VAR", new(big.Int).SetInt64(5e17), 1e8, "0.500000000000000000"},
		// 2 SKA per 1 VAR: skaAtoms=2e18, varAtoms=1e8
		{"2 SKA per 1 VAR", new(big.Int).Mul(big.NewInt(2), new(big.Int).Exp(big.NewInt(10), big.NewInt(18), nil)), 1e8, "2.000000000000000000"},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := FormatSKAPerVAR(tc.skaAtoms, tc.varAtoms)
			if got != tc.want {
				t.Errorf("FormatSKAPerVAR(%v, %d) = %q, want %q", tc.skaAtoms, tc.varAtoms, got, tc.want)
			}
		})
	}
}

// ---------------------------------------------------------------------------
// SSFeeCoinTypes
// ---------------------------------------------------------------------------

func TestSSFeeCoinTypes(t *testing.T) {
	t.Run("empty summaries", func(t *testing.T) {
		got := SSFeeCoinTypes(nil)
		if len(got) != 0 {
			t.Errorf("expected empty map, got %v", got)
		}
	})

	t.Run("single coin type", func(t *testing.T) {
		summaries := []SSFeeSummary{
			{SSFeeTotalsByCoin: map[uint8]string{1: "100"}},
			{SSFeeTotalsByCoin: map[uint8]string{1: "200"}},
		}
		got := SSFeeCoinTypes(summaries)
		if len(got) != 1 {
			t.Errorf("expected 1 coin type, got %d", len(got))
		}
		if _, ok := got[1]; !ok {
			t.Error("expected coin type 1 to be present")
		}
	})

	t.Run("multiple coin types across blocks", func(t *testing.T) {
		summaries := []SSFeeSummary{
			{SSFeeTotalsByCoin: map[uint8]string{1: "100", 2: "200"}},
			{SSFeeTotalsByCoin: map[uint8]string{2: "300", 3: "400"}},
		}
		got := SSFeeCoinTypes(summaries)
		if len(got) != 3 {
			t.Errorf("expected 3 coin types, got %d: %v", len(got), got)
		}
		for _, ct := range []uint8{1, 2, 3} {
			if _, ok := got[ct]; !ok {
				t.Errorf("expected coin type %d to be present", ct)
			}
		}
	})

	t.Run("summaries with no coin data", func(t *testing.T) {
		summaries := []SSFeeSummary{
			{SSFeeTotalsByCoin: nil},
			{SSFeeTotalsByCoin: map[uint8]string{}},
		}
		got := SSFeeCoinTypes(summaries)
		if len(got) != 0 {
			t.Errorf("expected empty map, got %v", got)
		}
	})
}

// ---------------------------------------------------------------------------
// CalculateAverageTicketAPY
// ---------------------------------------------------------------------------

func TestCalculateAverageTicketAPY(t *testing.T) {
	// helper: parse atom string back to big.Int for comparison
	mustInt := func(s string) *big.Int {
		v, ok := new(big.Int).SetString(s, 10)
		if !ok {
			t.Fatalf("mustInt: cannot parse %q", s)
		}
		return v
	}

	// rewardPerTicket expressed as SKA coins (not atoms) — matches how
	// explorer.go builds it: totalReward/1e18/TicketsPerBlock.
	oneReward := big.NewFloat(1.0) // 1 SKA coin per ticket

	t.Run("empty vote data returns zero sentinel", func(t *testing.T) {
		got := CalculateAverageTicketAPY(nil, oneReward, 52560)
		if got != "0" {
			t.Errorf("got %q, want \"0\"", got)
		}
	})

	t.Run("all invalid tickets returns zero", func(t *testing.T) {
		data := []VoteTicket{
			{TicketPrice: "not-a-number", VoteHeight: 100, PurchaseHeight: 90},
			{TicketPrice: "0", VoteHeight: 100, PurchaseHeight: 90},
			{TicketPrice: "100000000", VoteHeight: 50, PurchaseHeight: 100}, // age <= 0
		}
		got := CalculateAverageTicketAPY(data, oneReward, 52560)
		if got != "0" {
			t.Errorf("got %q, want \"0\"", got)
		}
	})

	t.Run("result is a valid atom string (parseable as big.Int)", func(t *testing.T) {
		data := []VoteTicket{
			// ticket price 100 VAR in atoms, held for 144 blocks
			{TicketPrice: "10000000000", VoteHeight: 244, PurchaseHeight: 100},
		}
		got := CalculateAverageTicketAPY(data, oneReward, 52560)
		if got == "0" || got == "0.000000000000000000" {
			t.Fatalf("expected non-zero result, got %q", got)
		}
		// Must be parseable as a plain integer (atom string, no decimal point)
		v := mustInt(got)
		if v.Sign() <= 0 {
			t.Errorf("expected positive atom value, got %s", got)
		}
	})

	t.Run("decimal ticket price accepted", func(t *testing.T) {
		// Same ticket expressed as a decimal coin string instead of atoms
		atomData := []VoteTicket{
			{TicketPrice: "10000000000", VoteHeight: 244, PurchaseHeight: 100},
		}
		decimalData := []VoteTicket{
			{TicketPrice: "100.00000000", VoteHeight: 244, PurchaseHeight: 100},
		}
		gotAtom := CalculateAverageTicketAPY(atomData, oneReward, 52560)
		gotDecimal := CalculateAverageTicketAPY(decimalData, oneReward, 52560)
		if gotAtom != gotDecimal {
			t.Errorf("atom path %q != decimal path %q", gotAtom, gotDecimal)
		}
	})

	t.Run("higher reward produces higher APY atoms", func(t *testing.T) {
		data := []VoteTicket{
			{TicketPrice: "10000000000", VoteHeight: 244, PurchaseHeight: 100},
		}
		lowReward := big.NewFloat(0.5)
		highReward := big.NewFloat(2.0)

		low := mustInt(CalculateAverageTicketAPY(data, lowReward, 52560))
		high := mustInt(CalculateAverageTicketAPY(data, highReward, 52560))

		if high.Cmp(low) <= 0 {
			t.Errorf("expected high reward (%s) > low reward (%s)", high, low)
		}
	})

	t.Run("reward rounds to zero atoms returns zero", func(t *testing.T) {
		// A reward so small that avgAPY * 1e18 < 1 atom → should return "0".
		data := []VoteTicket{
			// ticket price 1e15 VAR atoms (~10 million VAR), age 1e9 blocks
			// APY ≈ 1e-18 * 52560 / 1e9 ≈ 5e-14, * 1e18 ≈ 0.05 → still > 0
			// Use an astronomically large age to force the product below 1 atom.
			{TicketPrice: "100000000000000000000000", VoteHeight: 1_000_000_000, PurchaseHeight: 0},
		}
		tinyReward := new(big.Float).SetFloat64(1e-30) // effectively zero SKA
		got := CalculateAverageTicketAPY(data, tinyReward, 52560)
		if got != "0" {
			t.Errorf("expected \"0\" for near-zero reward, got %q", got)
		}
	})

	t.Run("average across multiple tickets", func(t *testing.T) {
		// Two tickets with the same price but different ages → average APY
		// should be between the two individual APYs.
		data := []VoteTicket{
			{TicketPrice: "10000000000", VoteHeight: 200, PurchaseHeight: 100}, // age 100
			{TicketPrice: "10000000000", VoteHeight: 400, PurchaseHeight: 100}, // age 300
		}
		single100 := mustInt(CalculateAverageTicketAPY([]VoteTicket{data[0]}, oneReward, 52560))
		single300 := mustInt(CalculateAverageTicketAPY([]VoteTicket{data[1]}, oneReward, 52560))
		avg := mustInt(CalculateAverageTicketAPY(data, oneReward, 52560))

		// avg must be strictly between single300 and single100
		if avg.Cmp(single300) <= 0 || avg.Cmp(single100) >= 0 {
			t.Errorf("average %s not between %s (age=300) and %s (age=100)", avg, single300, single100)
		}
	})
}
