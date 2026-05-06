package types

import (
	"sort"
	"testing"
)

func TestTotalSentByCoinFromMap(t *testing.T) {
	tests := []struct {
		name        string
		coinAmounts map[uint8]string
		issuedSKA   []uint8
		want        []CoinAmount
	}{
		{
			name:        "VAR only",
			coinAmounts: map[uint8]string{0: "100000000"},
			issuedSKA:   []uint8{1, 2},
			want: []CoinAmount{
				{CoinType: "VAR", Amount: "100000000"},
			},
		},
		{
			name:        "VAR and SKA",
			coinAmounts: map[uint8]string{0: "100000000", 1: "1000000000000000000"},
			issuedSKA:   []uint8{1},
			want: []CoinAmount{
				{CoinType: "VAR", Amount: "100000000"},
				{CoinType: "SKA1", Amount: "1000000000000000000"},
			},
		},
		{
			name:        "VAR and multiple SKA sorted",
			coinAmounts: map[uint8]string{0: "100000000", 1: "1000000000000000000", 2: "2000000000000000000"},
			issuedSKA:   []uint8{1, 2},
			want: []CoinAmount{
				{CoinType: "VAR", Amount: "100000000"},
				{CoinType: "SKA1", Amount: "1000000000000000000"},
				{CoinType: "SKA2", Amount: "2000000000000000000"},
			},
		},
		{
			name:        "VAR and SKA with zero SKA omitted",
			coinAmounts: map[uint8]string{0: "100000000", 1: "1000000000000000000", 2: "0"},
			issuedSKA:   []uint8{1, 2},
			want: []CoinAmount{
				{CoinType: "VAR", Amount: "100000000"},
				{CoinType: "SKA1", Amount: "1000000000000000000"},
			},
		},
		{
			name:        "empty map returns empty slice",
			coinAmounts: map[uint8]string{},
			issuedSKA:   []uint8{1},
			want:        []CoinAmount{},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := TotalSentByCoinFromMap(tt.coinAmounts, tt.issuedSKA)
			if len(got) != len(tt.want) {
				t.Errorf("len = %d, want %d", len(got), len(tt.want))
				return
			}
			for i := range got {
				if got[i].CoinType != tt.want[i].CoinType {
					t.Errorf("[%d] CoinType = %s, want %s", i, got[i].CoinType, tt.want[i].CoinType)
				}
				if got[i].Amount != tt.want[i].Amount {
					t.Errorf("[%d] Amount = %s, want %s", i, got[i].Amount, tt.want[i].Amount)
				}
			}
		})
	}
}

func TestRegularCoinCountsFromCoinRows(t *testing.T) {
	tests := []struct {
		name        string
		coinRows    []CoinRowData
		voters      uint16
		freshStake  uint8
		revocations uint32
		want        []CoinCount
	}{
		{
			name: "VAR only regular count",
			coinRows: []CoinRowData{
				{CoinType: 0, TxCount: 10}, // 10 total - 5 votes - 2 tickets - 1 rev = 2 regular
			},
			voters:      5,
			freshStake:  2,
			revocations: 1,
			want: []CoinCount{
				{CoinType: "VAR", Count: 2},
			},
		},
		{
			name: "VAR and SKA counts",
			coinRows: []CoinRowData{
				{CoinType: 0, TxCount: 10},
				{CoinType: 1, TxCount: 3},
				{CoinType: 2, TxCount: 2},
			},
			voters:      5,
			freshStake:  2,
			revocations: 1,
			want: []CoinCount{
				{CoinType: "VAR", Count: 2},
				{CoinType: "SKA1", Count: 3},
				{CoinType: "SKA2", Count: 2},
			},
		},
		{
			name: "zero SKA count omitted",
			coinRows: []CoinRowData{
				{CoinType: 0, TxCount: 10},
				{CoinType: 1, TxCount: 3},
				{CoinType: 2, TxCount: 0},
			},
			voters:      5,
			freshStake:  2,
			revocations: 1,
			want: []CoinCount{
				{CoinType: "VAR", Count: 2},
				{CoinType: "SKA1", Count: 3},
			},
		},
		{
			name: "negative regular count clamped to zero",
			coinRows: []CoinRowData{
				{CoinType: 0, TxCount: 3}, // 3 - 5 votes = -2, clamped to 0
			},
			voters:      5,
			freshStake:  0,
			revocations: 0,
			want: []CoinCount{
				{CoinType: "VAR", Count: 0},
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := RegularCoinCountsFromCoinRows(tt.coinRows, tt.voters, tt.freshStake, tt.revocations)
			if len(got) != len(tt.want) {
				t.Errorf("len = %d, want %d", len(got), len(tt.want))
				return
			}
			for i := range got {
				if got[i].CoinType != tt.want[i].CoinType {
					t.Errorf("[%d] CoinType = %s, want %s", i, got[i].CoinType, tt.want[i].CoinType)
				}
				if got[i].Count != tt.want[i].Count {
					t.Errorf("[%d] Count = %d, want %d", i, got[i].Count, tt.want[i].Count)
				}
			}
		})
	}
}

func TestFeesByCoinFromMiningFee(t *testing.T) {
	tests := []struct {
		name      string
		miningFee float64
		want      []CoinAmount
	}{
		{
			name:      "positive fee",
			miningFee: 0.12345678,
			want: []CoinAmount{
				{CoinType: "VAR", Amount: "12345678"}, // DCR atoms (8 decimals)
			},
		},
		{
			name:      "zero fee",
			miningFee: 0,
			want: []CoinAmount{
				{CoinType: "VAR", Amount: "0"},
			},
		},
		{
			name:      "large fee",
			miningFee: 100.12345678,
			want: []CoinAmount{
				{CoinType: "VAR", Amount: "10012345678"},
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := FeesByCoinFromMiningFee(tt.miningFee)
			if len(got) != len(tt.want) {
				t.Errorf("len = %d, want %d", len(got), len(tt.want))
				return
			}
			for i := range got {
				if got[i].CoinType != tt.want[i].CoinType {
					t.Errorf("[%d] CoinType = %s, want %s", i, got[i].CoinType, tt.want[i].CoinType)
				}
				if got[i].Amount != tt.want[i].Amount {
					t.Errorf("[%d] Amount = %s, want %s", i, got[i].Amount, tt.want[i].Amount)
				}
			}
		})
	}
}

func TestCoinTypeSymbol(t *testing.T) {
	tests := []struct {
		coinType uint8
		want     string
	}{
		{0, "VAR"},
		{1, "SKA1"},
		{2, "SKA2"},
		{255, "SKA255"},
	}

	for _, tt := range tests {
		t.Run(tt.want, func(t *testing.T) {
			if got := CoinTypeSymbol(tt.coinType); got != tt.want {
				t.Errorf("CoinTypeSymbol(%d) = %s, want %s", tt.coinType, got, tt.want)
			}
		})
	}
}

func TestCoinTypeFromSymbol(t *testing.T) {
	tests := []struct {
		symbol   string
		wantCoin uint8
		wantOk   bool
	}{
		{"VAR", 0, true},
		{"SKA1", 1, true},
		{"SKA2", 2, true},
		{"SKA255", 255, true},
		{"INVALID", 0, false},
		{"SKA0", 0, false}, // SKA0 is not valid
		{"VARX", 0, false},
	}

	for _, tt := range tests {
		t.Run(tt.symbol, func(t *testing.T) {
			got, ok := CoinTypeFromSymbol(tt.symbol)
			if ok != tt.wantOk {
				t.Errorf("CoinTypeFromSymbol(%s) ok = %v, want %v", tt.symbol, ok, tt.wantOk)
			}
			if got != tt.wantCoin {
				t.Errorf("CoinTypeFromSymbol(%s) = %d, want %d", tt.symbol, got, tt.wantCoin)
			}
		})
	}
}

func TestCoinTypesSorted(t *testing.T) {
	// Ensure SKA coin types are sorted in ascending order
	types := []uint8{0, 2, 1, 255, 10}
	sorted := make([]uint8, len(types))
	copy(sorted, types)
	sort.Slice(sorted, func(i, j int) bool {
		return sorted[i] < sorted[j]
	})
	want := []uint8{0, 1, 2, 10, 255}
	for i := range sorted {
		if sorted[i] != want[i] {
			t.Errorf("sorted[%d] = %d, want %d", i, sorted[i], want[i])
		}
	}
}
