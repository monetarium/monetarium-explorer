package dcrpg

import (
	"math/big"
	"reflect"
	"testing"

	exptypes "github.com/monetarium/monetarium-explorer/explorer/types"
)

func TestPowRewardsFromMap(t *testing.T) {
	tests := []struct {
		name    string
		rewards map[uint8]*big.Int
		want    []exptypes.PoWSKAReward
	}{
		{
			name:    "Empty map",
			rewards: make(map[uint8]*big.Int),
			want:    nil,
		},
		{
			name:    "Nil map",
			rewards: nil,
			want:    nil,
		},
		{
			name: "Single coin type",
			rewards: map[uint8]*big.Int{
				1: big.NewInt(1000),
			},
			want: []exptypes.PoWSKAReward{
				{CoinType: 1, Symbol: "SKA1", Amount: "1000"},
			},
		},
		{
			name: "Multiple coin types - sorted",
			rewards: map[uint8]*big.Int{
				2: big.NewInt(2000),
				1: big.NewInt(1000),
				3: big.NewInt(3000),
			},
			want: []exptypes.PoWSKAReward{
				{CoinType: 1, Symbol: "SKA1", Amount: "1000"},
				{CoinType: 2, Symbol: "SKA2", Amount: "2000"},
				{CoinType: 3, Symbol: "SKA3", Amount: "3000"},
			},
		},
		{
			name: "Large amounts",
			rewards: map[uint8]*big.Int{
				1: func() *big.Int {
					bi, _ := new(big.Int).SetString("12345678901234567890", 10)
					return bi
				}(),
			},
			want: []exptypes.PoWSKAReward{
				{CoinType: 1, Symbol: "SKA1", Amount: "12345678901234567890"},
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := powRewardsFromMap(tt.rewards); !reflect.DeepEqual(got, tt.want) {
				t.Errorf("powRewardsFromMap() = %v, want %v", got, tt.want)
			}
		})
	}
}
