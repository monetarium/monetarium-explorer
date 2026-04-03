package blockdata

import (
	"math/big"
	"testing"

	"github.com/monetarium/monetarium-node/cointype"
	"github.com/monetarium/monetarium-node/wire"
)

// mockBlock builds a wire.MsgBlock with the given regular transactions.
func mockBlock(txs ...*wire.MsgTx) *wire.MsgBlock {
	blk := &wire.MsgBlock{}
	blk.Transactions = txs
	return blk
}

func TestBlockCoinAmounts_VAROnly(t *testing.T) {
	tx := wire.NewMsgTx()
	tx.AddTxOut(wire.NewTxOut(500_000_000, nil)) // 5 VAR
	tx.AddTxOut(wire.NewTxOut(300_000_000, nil)) // 3 VAR

	got := blockCoinAmounts(mockBlock(tx))
	if got == nil {
		t.Fatal("expected non-nil CoinAmounts")
	}
	if got[0] != "800000000" {
		t.Errorf("VAR total: want 800000000, got %s", got[0])
	}
	if len(got) != 1 {
		t.Errorf("expected only VAR key, got %v", got)
	}
}

func TestBlockCoinAmounts_SKAOnly(t *testing.T) {
	// SKA-1 amount exceeding int64 max
	bigAmt := new(big.Int).Add(
		new(big.Int).Lsh(big.NewInt(1), 63),
		big.NewInt(999),
	)
	tx := wire.NewMsgTx()
	tx.AddTxOut(wire.NewTxOutSKA(bigAmt, cointype.CoinType(1), nil))

	got := blockCoinAmounts(mockBlock(tx))
	if got == nil {
		t.Fatal("expected non-nil CoinAmounts")
	}
	if got[1] != bigAmt.String() {
		t.Errorf("SKA-1 total: want %s, got %s", bigAmt, got[1])
	}
	if _, hasVAR := got[0]; hasVAR {
		t.Error("expected no VAR key for SKA-only block")
	}
}

func TestBlockCoinAmounts_Mixed(t *testing.T) {
	skaBig := new(big.Int).Mul(big.NewInt(1_000_000), new(big.Int).Exp(big.NewInt(10), big.NewInt(18), nil))

	varTx := wire.NewMsgTx()
	varTx.AddTxOut(wire.NewTxOut(100_000_000, nil)) // 1 VAR

	skaTx := wire.NewMsgTx()
	skaTx.AddTxOut(wire.NewTxOutSKA(skaBig, cointype.CoinType(1), nil))

	blk := &wire.MsgBlock{}
	blk.Transactions = []*wire.MsgTx{varTx, skaTx}

	got := blockCoinAmounts(blk)
	if got[0] != "100000000" {
		t.Errorf("VAR: want 100000000, got %s", got[0])
	}
	if got[1] != skaBig.String() {
		t.Errorf("SKA-1: want %s, got %s", skaBig, got[1])
	}
}

func TestBlockCoinAmounts_Empty(t *testing.T) {
	blk := &wire.MsgBlock{}
	blk.Transactions = []*wire.MsgTx{}
	got := blockCoinAmounts(blk)
	if got != nil {
		t.Errorf("expected nil for empty block, got %v", got)
	}
}

func TestBlockCoinTxStats_Mixed(t *testing.T) {
	varTx := wire.NewMsgTx()
	varTx.AddTxOut(wire.NewTxOut(100_000_000, nil))

	skaTx := wire.NewMsgTx()
	skaBig := new(big.Int).Mul(big.NewInt(1_000_000), new(big.Int).Exp(big.NewInt(10), big.NewInt(18), nil))
	skaTx.AddTxOut(wire.NewTxOutSKA(skaBig, cointype.CoinType(1), nil))

	blk := &wire.MsgBlock{}
	blk.Transactions = []*wire.MsgTx{varTx, skaTx}

	got := blockCoinTxStats(blk)
	if got == nil {
		t.Fatal("expected non-nil CoinTxStats")
	}
	if got[0].TxCount != 1 {
		t.Errorf("VAR TxCount: want 1, got %d", got[0].TxCount)
	}
	if got[1].TxCount != 1 {
		t.Errorf("SKA-1 TxCount: want 1, got %d", got[1].TxCount)
	}
	if got[0].Size != uint32(varTx.SerializeSize()) {
		t.Errorf("VAR Size: want %d, got %d", varTx.SerializeSize(), got[0].Size)
	}
	if got[1].Size != uint32(skaTx.SerializeSize()) {
		t.Errorf("SKA-1 Size: want %d, got %d", skaTx.SerializeSize(), got[1].Size)
	}
}

func TestBlockCoinTxStats_Empty(t *testing.T) {
	blk := &wire.MsgBlock{}
	if got := blockCoinTxStats(blk); got != nil {
		t.Errorf("expected nil for empty block, got %v", got)
	}
}
