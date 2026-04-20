package types_test

import (
	"testing"

	"github.com/monetarium/monetarium-explorer/explorer/types"
)

func TestBlockInfo_SKAPoWRewards(t *testing.T) {
	bi := &types.BlockInfo{}
	bi.SKAPoWRewards = []types.PoWSKAReward{
		{CoinType: 1, Symbol: "SKA-1", Amount: "100"},
	}
	if len(bi.SKAPoWRewards) != 1 {
		t.Errorf("expected 1 reward, got %d", len(bi.SKAPoWRewards))
	}
}
