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

func TestBlockSKAFees_WithSKATransaction(t *testing.T) {
	tx := wire.NewMsgTx()
	tx.AddTxIn(wire.NewTxIn(&wire.OutPoint{}, 0, nil))

	// Input: 100 + 2902901089999999999900 atoms SKA
	vin1 := wire.NewTxIn(&wire.OutPoint{}, 0, nil)
	vin1.SKAValueIn = big.NewInt(100)
	tx.TxIn = append(tx.TxIn, vin1)

	vin2 := wire.NewTxIn(&wire.OutPoint{}, 0, nil)
	vin2.SKAValueIn, _ = new(big.Int).SetString("2902901089999999999900", 10)
	tx.TxIn = append(tx.TxIn, vin2)

	// Output: 2901069089999999999900 + 100 atoms SKA
	tx.AddTxOut(wire.NewTxOut(0, nil))
	tx.TxOut[0].CoinType = cointype.CoinType(1)
	tx.TxOut[0].SKAValue, _ = new(big.Int).SetString("2901069089999999999900", 10)

	tx.AddTxOut(wire.NewTxOut(0, nil))
	tx.TxOut[1].CoinType = cointype.CoinType(1)
	tx.TxOut[1].SKAValue = big.NewInt(100)

	got := BlockSKAFees(mockBlock(tx))

	if got == nil {
		t.Fatal("expected non-nil SKA fees")
	}

	// Expected: 1832000000000000000 atoms
	expected := "1832000000000000000"

	feeStr, ok := got[1]
	if !ok {
		t.Fatal("expected SKA1 in fees map")
	}

	if feeStr != expected {
		t.Errorf("want %s, got %s", expected, feeStr)
	}
}

func TestBlockSKAFees_NoSKA(t *testing.T) {
	// Transaction with no SKA inputs/outputs
	tx := wire.NewMsgTx()
	tx.AddTxIn(wire.NewTxIn(&wire.OutPoint{}, 0, nil))
	tx.AddTxOut(wire.NewTxOut(100000000, nil)) // DCR only

	got := BlockSKAFees(mockBlock(tx))

	if got != nil {
		t.Errorf("expected nil for no SKA, got %v", got)
	}
}

func TestBlockSKAFees_MultipleCoinTypes(t *testing.T) {
	// Three transactions with different coin types
	// TX1: SKA type 1, input 200, output 150 = fee 50
	tx1 := wire.NewMsgTx()
	tx1.AddTxIn(wire.NewTxIn(&wire.OutPoint{}, 0, nil))
	tx1.TxIn[0].SKAValueIn = big.NewInt(200)
	tx1.AddTxOut(wire.NewTxOut(0, nil))
	tx1.TxOut[0].CoinType = cointype.CoinType(1)
	tx1.TxOut[0].SKAValue = big.NewInt(150)

	// TX2: SKA type 2, input 300, output 250 = fee 50
	tx2 := wire.NewMsgTx()
	tx2.AddTxIn(wire.NewTxIn(&wire.OutPoint{}, 0, nil))
	tx2.TxIn[0].SKAValueIn = big.NewInt(300)
	tx2.AddTxOut(wire.NewTxOut(0, nil))
	tx2.TxOut[0].CoinType = cointype.CoinType(2)
	tx2.TxOut[0].SKAValue = big.NewInt(250)

	// TX3: SKA type 5, input 500, output 400 = fee 100
	tx3 := wire.NewMsgTx()
	tx3.AddTxIn(wire.NewTxIn(&wire.OutPoint{}, 0, nil))
	tx3.TxIn[0].SKAValueIn = big.NewInt(500)
	tx3.AddTxOut(wire.NewTxOut(0, nil))
	tx3.TxOut[0].CoinType = cointype.CoinType(5)
	tx3.TxOut[0].SKAValue = big.NewInt(400)

	got := BlockSKAFees(mockBlock(tx1, tx2, tx3))

	if got == nil {
		t.Fatal("expected non-nil SKA fees")
	}

	if got[1] != "50" {
		t.Errorf("want SKA1=50, got %v", got[1])
	}
	if got[2] != "50" {
		t.Errorf("want SKA2=50, got %v", got[2])
	}
	if got[5] != "100" {
		t.Errorf("want SKA5=100, got %v", got[5])
	}
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
	// SKA1 amount exceeding int64 max
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
		t.Errorf("SKA1 total: want %s, got %s", bigAmt, got[1])
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
		t.Errorf("SKA1: want %s, got %s", skaBig, got[1])
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
		t.Errorf("SKA1 TxCount: want 1, got %d", got[1].TxCount)
	}
	if got[0].Size != uint32(varTx.SerializeSize()) {
		t.Errorf("VAR Size: want %d, got %d", varTx.SerializeSize(), got[0].Size)
	}
	if got[1].Size != uint32(skaTx.SerializeSize()) {
		t.Errorf("SKA1 Size: want %d, got %d", skaTx.SerializeSize(), got[1].Size)
	}
}

func TestBlockCoinTxStats_Empty(t *testing.T) {
	blk := &wire.MsgBlock{}
	if got := blockCoinTxStats(blk); got != nil {
		t.Errorf("expected nil for empty block, got %v", got)
	}
}

func TestBlockSKAPoWRewards_SKAOnly(t *testing.T) {
	skaBig := new(big.Int).Mul(big.NewInt(1_000_000), new(big.Int).Exp(big.NewInt(10), big.NewInt(18), nil))
	coinbase := wire.NewMsgTx()
	coinbase.AddTxOut(wire.NewTxOut(100_000_000, nil))                     // VAR reward
	coinbase.AddTxOut(wire.NewTxOutSKA(skaBig, cointype.CoinType(1), nil)) // SKA1 reward
	coinbase.AddTxOut(wire.NewTxOutSKA(skaBig, cointype.CoinType(2), nil)) // SKA2 reward

	got := BlockSKAPoWRewards(mockBlock(coinbase))
	if got == nil {
		t.Fatal("expected non-nil SKAPoWRewards")
	}
	if got[1] != skaBig.String() {
		t.Errorf("SKA1: want %s, got %s", skaBig, got[1])
	}
	if got[2] != skaBig.String() {
		t.Errorf("SKA2: want %s, got %s", skaBig, got[2])
	}
	if _, hasVAR := got[0]; hasVAR {
		t.Error("expected no VAR reward in SKAPoWRewards")
	}
	if len(got) != 2 {
		t.Errorf("expected 2 SKA rewards, got %d", len(got))
	}
}

func TestBlockSKAPoWRewards_NoSKA(t *testing.T) {
	coinbase := wire.NewMsgTx()
	coinbase.AddTxOut(wire.NewTxOut(100_000_000, nil)) // Only VAR

	got := BlockSKAPoWRewards(mockBlock(coinbase))
	if got != nil {
		t.Errorf("expected nil for block without SKA rewards, got %v", got)
	}
}

func TestBlockSKAPoWRewards_Empty(t *testing.T) {
	blk := &wire.MsgBlock{}
	blk.Transactions = []*wire.MsgTx{}
	got := BlockSKAPoWRewards(blk)
	if got != nil {
		t.Errorf("expected nil for empty block, got %v", got)
	}
}

func TestBlockSKAPoWRewards_Summing(t *testing.T) {
	amt1 := big.NewInt(100)
	amt2 := big.NewInt(200)
	coinbase := wire.NewMsgTx()
	coinbase.AddTxOut(wire.NewTxOutSKA(amt1, cointype.CoinType(1), nil))
	coinbase.AddTxOut(wire.NewTxOutSKA(amt2, cointype.CoinType(1), nil))

	got := BlockSKAPoWRewards(mockBlock(coinbase))
	if got == nil {
		t.Fatal("expected non-nil SKAPoWRewards")
	}
	expected := "300"
	if got[1] != expected {
		t.Errorf("SKA1: want %s, got %s", expected, got[1])
	}
}

func TestExtractSKARewardsFromCoinbase_Standard(t *testing.T) {
	skaBig := new(big.Int).Mul(big.NewInt(1_000_000), new(big.Int).Exp(big.NewInt(10), big.NewInt(18), nil))
	coinbase := wire.NewMsgTx()
	coinbase.AddTxOut(wire.NewTxOut(100_000_000, nil))                     // VAR reward
	coinbase.AddTxOut(wire.NewTxOutSKA(skaBig, cointype.CoinType(1), nil)) // SKA1 reward
	coinbase.AddTxOut(wire.NewTxOutSKA(skaBig, cointype.CoinType(2), nil)) // SKA2 reward

	got := ExtractSKARewardsFromCoinbase(coinbase)
	if got == nil {
		t.Fatal("expected non-nil SKARewards")
	}
	if got[1] != skaBig.String() {
		t.Errorf("SKA1: want %s, got %s", skaBig, got[1])
	}
	if got[2] != skaBig.String() {
		t.Errorf("SKA2: want %s, got %s", skaBig, got[2])
	}
	if _, hasVAR := got[0]; hasVAR {
		t.Error("expected no VAR reward in ExtractSKARewardsFromCoinbase")
	}
	if len(got) != 2 {
		t.Errorf("expected 2 SKA rewards, got %d", len(got))
	}
}

func TestExtractSKARewardsFromCoinbase_NoSKA(t *testing.T) {
	coinbase := wire.NewMsgTx()
	coinbase.AddTxOut(wire.NewTxOut(100_000_000, nil)) // Only VAR

	got := ExtractSKARewardsFromCoinbase(coinbase)
	if got != nil && len(got) != 0 {
		t.Errorf("expected nil or empty map for block without SKA rewards, got %v", got)
	}
}

func TestExtractSKARewardsFromCoinbase_Nil(t *testing.T) {
	got := ExtractSKARewardsFromCoinbase(nil)
	if got != nil {
		t.Errorf("expected nil for nil coinbase, got %v", got)
	}
}

func TestExtractSKARewardsFromCoinbase_Summing(t *testing.T) {
	amt1 := big.NewInt(100)
	amt2 := big.NewInt(200)
	coinbase := wire.NewMsgTx()
	coinbase.AddTxOut(wire.NewTxOutSKA(amt1, cointype.CoinType(1), nil))
	coinbase.AddTxOut(wire.NewTxOutSKA(amt2, cointype.CoinType(1), nil))

	got := ExtractSKARewardsFromCoinbase(coinbase)
	if got == nil {
		t.Fatal("expected non-nil SKARewards")
	}
	expected := "300"
	if got[1] != expected {
		t.Errorf("SKA1: want %s, got %s", expected, got[1])
	}
}
