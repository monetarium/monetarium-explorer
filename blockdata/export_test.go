package blockdata_test

import (
	"math/big"
	"testing"

	"github.com/monetarium/monetarium-explorer/blockdata"
	"github.com/monetarium/monetarium-node/cointype"
	"github.com/monetarium/monetarium-node/wire"
)

func TestBlockSKAPoWRewards(t *testing.T) {
	t.Run("EmptyBlock", func(t *testing.T) {
		blk := &wire.MsgBlock{}
		got := blockdata.BlockSKAPoWRewards(blk)
		if got != nil {
			t.Errorf("expected nil for empty block, got %v", got)
		}
	})

	t.Run("NoSKARewards", func(t *testing.T) {
		tx := wire.NewMsgTx()
		tx.AddTxOut(wire.NewTxOut(100_000_000, nil)) // VAR reward
		blk := &wire.MsgBlock{Transactions: []*wire.MsgTx{tx}}
		got := blockdata.BlockSKAPoWRewards(blk)
		if got != nil {
			t.Errorf("expected nil for block with no SKA rewards, got %v", got)
		}
	})

	t.Run("SingleSKAReward", func(t *testing.T) {
		amt := big.NewInt(1_000_000_000)
		tx := wire.NewMsgTx()
		tx.AddTxOut(wire.NewTxOutSKA(amt, cointype.CoinType(1), nil))
		blk := &wire.MsgBlock{Transactions: []*wire.MsgTx{tx}}
		got := blockdata.BlockSKAPoWRewards(blk)
		if got == nil {
			t.Fatal("expected non-nil rewards")
		}
		if got[1] != amt.String() {
			t.Errorf("want %s, got %s", amt.String(), got[1])
		}
		if len(got) != 1 {
			t.Errorf("expected 1 reward, got %d", len(got))
		}
	})

	t.Run("MultipleSKARewards", func(t *testing.T) {
		amt1 := big.NewInt(1_000_000)
		amt2 := big.NewInt(2_000_000)
		tx := wire.NewMsgTx()
		tx.AddTxOut(wire.NewTxOutSKA(amt1, cointype.CoinType(1), nil))
		tx.AddTxOut(wire.NewTxOutSKA(amt2, cointype.CoinType(2), nil))
		blk := &wire.MsgBlock{Transactions: []*wire.MsgTx{tx}}
		got := blockdata.BlockSKAPoWRewards(blk)
		if got == nil {
			t.Fatal("expected non-nil rewards")
		}
		if got[1] != amt1.String() || got[2] != amt2.String() {
			t.Errorf("unexpected rewards: %v", got)
		}
		if len(got) != 2 {
			t.Errorf("expected 2 rewards, got %d", len(got))
		}
	})
}
