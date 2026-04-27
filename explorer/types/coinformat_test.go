package types

import (
	"encoding/json"
	"math/big"
	"strings"
	"testing"
)

func TestFormatVARAmount(t *testing.T) {
	tests := []struct {
		atoms int64
		full  bool
		want  string
	}{
		{100_000_000, true, "1.00000000 VAR"},
		{1_234_567_890_000, false, "12.3K VAR"},
		{1_000_000_000_000_000, false, "10M VAR"},
		{0, true, "0.00000000 VAR"},
	}
	for _, tc := range tests {
		got := FormatVARAmount(tc.atoms, tc.full)
		if got != tc.want {
			t.Errorf("FormatVARAmount(%d, %v) = %q, want %q", tc.atoms, tc.full, got, tc.want)
		}
	}
}

func TestFormatSKAAmount(t *testing.T) {
	// 1 SKA coin = 1e18 atoms
	oneAtom := "1"
	oneCoin := new(big.Int).Exp(big.NewInt(10), big.NewInt(18), nil).String()
	bigAmt := new(big.Int).Mul(new(big.Int).SetInt64(1_500_000), new(big.Int).Exp(big.NewInt(10), big.NewInt(18), nil)).String()

	tests := []struct {
		atoms    string
		coinType uint8
		full     bool
		want     string
	}{
		{oneCoin, 1, true, "1 SKA1"},
		{oneAtom, 1, true, "0.000000000000000001 SKA1"},
		{bigAmt, 2, false, "1.5M SKA2"},
		{"0", 1, true, "0 SKA1"},
		{"bad", 1, false, "0 SKA1"},
	}
	for _, tc := range tests {
		got := FormatSKAAmount(tc.atoms, tc.coinType, tc.full)
		if got != tc.want {
			t.Errorf("FormatSKAAmount(%s, %d, %v) = %q, want %q", tc.atoms, tc.coinType, tc.full, got, tc.want)
		}
	}
}

func TestCoinAmountsJSONRoundTrip(t *testing.T) {
	// Verify no float64 precision loss when marshaling/unmarshaling big SKA atom strings.
	// Use a value that exceeds float64 precision (> 2^53).
	bigStr := new(big.Int).Add(
		new(big.Int).Lsh(big.NewInt(1), 53), // 2^53
		big.NewInt(999_999_999),
	).String()

	bi := &BlockInfo{
		BlockBasic:  &BlockBasic{Height: 1},
		CoinAmounts: map[uint8]string{0: "100000000", 1: bigStr},
	}

	data, err := json.Marshal(bi)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}

	// Unmarshal into a generic map to check raw JSON values.
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(data, &raw); err != nil {
		t.Fatalf("unmarshal raw: %v", err)
	}

	// coin_amounts values must be JSON strings, not numbers (no float64 conversion).
	caRaw := raw["coin_amounts"]
	if !strings.Contains(string(caRaw), `"`+bigStr+`"`) {
		t.Errorf("expected SKA value %q as JSON string, got: %s", bigStr, caRaw)
	}

	// Round-trip back to BlockInfo.
	var bi2 BlockInfo
	bi2.BlockBasic = &BlockBasic{}
	if err := json.Unmarshal(data, &bi2); err != nil {
		t.Fatalf("unmarshal BlockInfo: %v", err)
	}
	if bi2.CoinAmounts[1] != bigStr {
		t.Errorf("round-trip SKA value: want %q, got %q", bigStr, bi2.CoinAmounts[1])
	}
}
