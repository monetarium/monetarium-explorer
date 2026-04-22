package dbtypes

import (
	"math/big"
	"testing"

	"github.com/monetarium/monetarium-node/chaincfg"
	"github.com/monetarium/monetarium-node/cointype"
	"github.com/monetarium/monetarium-node/wire"
)

// syntheticBlock builds a minimal wire.MsgBlock containing a single regular tx.
func syntheticBlock(tx *wire.MsgTx) *wire.MsgBlock {
	// Coinbase tx required as first transaction.
	coinbase := wire.NewMsgTx()
	coinbase.AddTxIn(wire.NewTxIn(&wire.OutPoint{}, 0, nil))
	coinbase.AddTxOut(wire.NewTxOut(0, nil))

	blk := &wire.MsgBlock{}
	blk.Transactions = []*wire.MsgTx{coinbase, tx}
	return blk
}

func Test_processTransactions_VAROnly(t *testing.T) {
	tx := wire.NewMsgTx()
	tx.AddTxIn(wire.NewTxIn(&wire.OutPoint{}, 1000, nil))
	tx.AddTxOut(wire.NewTxOut(900, nil)) // VAR output, 100 atoms fee

	blk := syntheticBlock(tx)
	txs, vouts, _ := processTransactions(blk, wire.TxTreeRegular, chaincfg.SimNetParams(), true, true)

	// txs[0] is coinbase, txs[1] is our tx
	if len(txs) < 2 {
		t.Fatalf("expected 2 txs, got %d", len(txs))
	}
	dbTx := txs[1]
	if dbTx.Spent != 1000 {
		t.Errorf("Spent: want 1000, got %d", dbTx.Spent)
	}
	if dbTx.Sent != 900 {
		t.Errorf("Sent: want 900, got %d", dbTx.Sent)
	}
	if dbTx.Fees != 100 {
		t.Errorf("Fees: want 100, got %d", dbTx.Fees)
	}
	if dbTx.SpentByCoin != nil || dbTx.SentByCoin != nil {
		t.Error("expected no SKA maps for VAR-only tx")
	}
	if vouts[1][0].CoinType != uint8(cointype.CoinTypeVAR) {
		t.Errorf("vout CoinType: want 0 (VAR), got %d", vouts[1][0].CoinType)
	}
	if vouts[1][0].Value != 900 {
		t.Errorf("vout Value: want 900, got %d", vouts[1][0].Value)
	}
}

func Test_processTransactions_SKAOnly(t *testing.T) {
	// SKA1 amount exceeding int64 max: 2^63 + 1
	bigAmt := new(big.Int).Add(new(big.Int).SetInt64(1<<62), big.NewInt(1<<62))
	bigAmt.Add(bigAmt, big.NewInt(1000))
	bigOut := new(big.Int).Sub(bigAmt, big.NewInt(100)) // 100 atoms fee

	tx := wire.NewMsgTx()
	txIn := wire.NewTxIn(&wire.OutPoint{}, 0, nil)
	txIn.SKAValueIn = bigAmt
	tx.AddTxIn(txIn)
	tx.AddTxOut(wire.NewTxOutSKA(bigOut, cointype.CoinType(1), nil))

	blk := syntheticBlock(tx)
	txs, vouts, _ := processTransactions(blk, wire.TxTreeRegular, chaincfg.SimNetParams(), true, true)

	if len(txs) < 2 {
		t.Fatalf("expected 2 txs, got %d", len(txs))
	}
	dbTx := txs[1]

	// VAR fields must be zero
	if dbTx.Spent != 0 || dbTx.Sent != 0 || dbTx.Fees != 0 {
		t.Errorf("VAR fields must be zero for SKA-only tx, got spent=%d sent=%d fees=%d",
			dbTx.Spent, dbTx.Sent, dbTx.Fees)
	}

	// SKA sent must equal bigOut
	if dbTx.SentByCoin == nil {
		t.Fatal("SentByCoin must not be nil for SKA tx")
	}
	sentStr, ok := dbTx.SentByCoin[1]
	if !ok {
		t.Fatal("SentByCoin missing SKA1 entry")
	}
	sentBig, _ := new(big.Int).SetString(sentStr, 10)
	if sentBig.Cmp(bigOut) != 0 {
		t.Errorf("SentByCoin[1]: want %s, got %s", bigOut, sentStr)
	}

	// Vout must carry SKAValue string, not truncated Value
	if vouts[1][0].CoinType != 1 {
		t.Errorf("vout CoinType: want 1 (SKA1), got %d", vouts[1][0].CoinType)
	}
	if vouts[1][0].Value != 0 {
		t.Errorf("vout Value must be 0 for SKA output, got %d", vouts[1][0].Value)
	}
	voutBig, _ := new(big.Int).SetString(vouts[1][0].SKAValue, 10)
	if voutBig.Cmp(bigOut) != 0 {
		t.Errorf("vout SKAValue: want %s, got %s", bigOut, vouts[1][0].SKAValue)
	}
}

func Test_processTransactions_VinCoinType(t *testing.T) {
	bigAmt := big.NewInt(1_000_000_000_000_000_000)
	bigOut := new(big.Int).Sub(bigAmt, big.NewInt(100))

	tx := wire.NewMsgTx()
	txIn := wire.NewTxIn(&wire.OutPoint{}, 0, nil)
	txIn.SKAValueIn = bigAmt
	tx.AddTxIn(txIn)
	tx.AddTxOut(wire.NewTxOutSKA(bigOut, cointype.CoinType(1), nil))

	blk := syntheticBlock(tx)
	_, vouts, vins := processTransactions(blk, wire.TxTreeRegular, chaincfg.SimNetParams(), true, true)

	// vins[1] is our tx (vins[0] is coinbase)
	if len(vins) < 2 || len(vins[1]) == 0 {
		t.Fatal("expected vin for SKA tx")
	}
	if vins[1][0].CoinType != 1 {
		t.Errorf("vin CoinType: want 1 (SKA1), got %d", vins[1][0].CoinType)
	}
	if vins[1][0].SKAValue != bigAmt.String() {
		t.Errorf("vin SKAValue: want %s, got %q", bigAmt, vins[1][0].SKAValue)
	}

	// vout SKAValue must be set, Value must be 0
	if len(vouts) < 2 || len(vouts[1]) == 0 {
		t.Fatal("expected vout for SKA tx")
	}
	if vouts[1][0].SKAValue != bigOut.String() {
		t.Errorf("vout SKAValue: want %s, got %q", bigOut, vouts[1][0].SKAValue)
	}
	if vouts[1][0].Value != 0 {
		t.Errorf("vout Value must be 0 for SKA output, got %d", vouts[1][0].Value)
	}
}

func Test_processTransactions_MixedBlock(t *testing.T) {
	// VAR tx
	varTx := wire.NewMsgTx()
	varTx.AddTxIn(wire.NewTxIn(&wire.OutPoint{}, 500, nil))
	varTx.AddTxOut(wire.NewTxOut(400, nil))

	// SKA1 tx
	skaBig := big.NewInt(1_000_000_000_000_000_000) // 1 SKA coin in atoms
	skaOut := new(big.Int).Sub(skaBig, big.NewInt(50))
	skaTx := wire.NewMsgTx()
	skaTxIn := wire.NewTxIn(&wire.OutPoint{Index: 1}, 0, nil)
	skaTxIn.SKAValueIn = skaBig
	skaTx.AddTxIn(skaTxIn)
	skaTx.AddTxOut(wire.NewTxOutSKA(skaOut, cointype.CoinType(1), nil))

	coinbase := wire.NewMsgTx()
	coinbase.AddTxIn(wire.NewTxIn(&wire.OutPoint{}, 0, nil))
	coinbase.AddTxOut(wire.NewTxOut(0, nil))

	blk := &wire.MsgBlock{}
	blk.Transactions = []*wire.MsgTx{coinbase, varTx, skaTx}

	txs, _, _ := processTransactions(blk, wire.TxTreeRegular, chaincfg.SimNetParams(), true, true)
	if len(txs) != 3 {
		t.Fatalf("expected 3 txs, got %d", len(txs))
	}

	// VAR tx
	if txs[1].Spent != 500 || txs[1].Sent != 400 || txs[1].Fees != 100 {
		t.Errorf("VAR tx: spent=%d sent=%d fees=%d", txs[1].Spent, txs[1].Sent, txs[1].Fees)
	}
	if txs[1].SentByCoin != nil {
		t.Error("VAR tx must not have SentByCoin")
	}

	// SKA tx
	if txs[2].Spent != 0 || txs[2].Sent != 0 {
		t.Errorf("SKA tx VAR fields must be zero, got spent=%d sent=%d", txs[2].Spent, txs[2].Sent)
	}
	if txs[2].SentByCoin == nil {
		t.Fatal("SKA tx must have SentByCoin")
	}
	sentStr := txs[2].SentByCoin[1]
	sentBig, _ := new(big.Int).SetString(sentStr, 10)
	if sentBig.Cmp(skaOut) != 0 {
		t.Errorf("SKA tx SentByCoin[1]: want %s, got %s", skaOut, sentStr)
	}
}
