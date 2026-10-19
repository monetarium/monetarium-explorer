package dcrpg

import (
	"errors"
	"reflect"
	"testing"

	"github.com/monetarium/monetarium-explorer/db/dbtypes"
)

func TestIsRetryError(t *testing.T) {
	tests := []struct {
		name string
		err  error
		want bool
	}{
		{"true", retryError{}, true},
		{"false", errors.New("adsf"), false},
		{"nil false", nil, false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := IsRetryError(tt.err); got != tt.want {
				t.Errorf("IsRetryError() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestCoinTypesFromBalance(t *testing.T) {
	coins := func(types ...uint8) map[uint8]*dbtypes.CoinBalance {
		m := make(map[uint8]*dbtypes.CoinBalance, len(types))
		for _, ct := range types {
			m[ct] = dbtypes.NewCoinBalance(ct)
		}
		return m
	}

	tests := []struct {
		name    string
		balance *dbtypes.AddressBalance
		want    []uint8
	}{
		{
			name:    "nil balance",
			balance: nil,
			want:    nil,
		},
		{
			name:    "empty coin map",
			balance: &dbtypes.AddressBalance{Coins: map[uint8]*dbtypes.CoinBalance{}},
			want:    nil,
		},
		{
			name:    "nil coin map",
			balance: &dbtypes.AddressBalance{},
			want:    nil,
		},
		{
			name:    "single coin",
			balance: &dbtypes.AddressBalance{Coins: coins(0)},
			want:    []uint8{0},
		},
		{
			name:    "multiple coins sorted ascending",
			balance: &dbtypes.AddressBalance{Coins: coins(3, 0, 2, 1)},
			want:    []uint8{0, 1, 2, 3},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := coinTypesFromBalance(tt.balance); !reflect.DeepEqual(got, tt.want) {
				t.Errorf("coinTypesFromBalance() = %v, want %v", got, tt.want)
			}
		})
	}
}
