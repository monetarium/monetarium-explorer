package dbtypes

import (
	"math"
	"math/big"
	"testing"

	"github.com/monetarium/monetarium-node/blockchain/stake"
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

func Test_processTransactions_CoinbaseRewardSplit(t *testing.T) {
	// Coinbase with multiple vouts: index 0 = PoW, index > 0 = PoS.
	// IsCoinBaseTx requires prevOut.Index == math.MaxUint32.
	coinbase := wire.NewMsgTx()
	coinbase.AddTxIn(wire.NewTxIn(&wire.OutPoint{Index: math.MaxUint32}, 0, nil))
	coinbase.AddTxOut(wire.NewTxOut(1000, nil)) // index 0
	coinbase.AddTxOut(wire.NewTxOut(500, nil))  // index 1
	coinbase.AddTxOut(wire.NewTxOut(300, nil))  // index 2

	blk := &wire.MsgBlock{}
	blk.Transactions = []*wire.MsgTx{coinbase}

	txs, vouts, _ := processTransactions(blk, wire.TxTreeRegular, chaincfg.SimNetParams(), true, true)

	if len(vouts) < 1 || len(vouts[0]) < 3 {
		t.Fatalf("expected 3 vouts, got %d", len(vouts[0]))
	}
	if vouts[0][0].TxType != TxTypeBlockRewardPoW {
		t.Errorf("vout[0] TxType: want %d (PoW), got %d", TxTypeBlockRewardPoW, vouts[0][0].TxType)
	}
	if vouts[0][1].TxType != TxTypeBlockRewardPoS {
		t.Errorf("vout[1] TxType: want %d (PoS), got %d", TxTypeBlockRewardPoS, vouts[0][1].TxType)
	}
	if vouts[0][2].TxType != TxTypeBlockRewardPoS {
		t.Errorf("vout[2] TxType: want %d (PoS), got %d", TxTypeBlockRewardPoS, vouts[0][2].TxType)
	}
	if txs[0].TxType != 0 {
		t.Errorf("coinbase tx TxType: want 0 (regular), got %d", txs[0].TxType)
	}
}

func Test_processTransactions_TicketClassification(t *testing.T) {
	t.Run("valid SStx via DetermineTxType", func(t *testing.T) {
		ticket := validSStx()

		blk := &wire.MsgBlock{}
		blk.STransactions = []*wire.MsgTx{ticket}

		txs, _, _ := processTransactions(blk, wire.TxTreeStake, chaincfg.SimNetParams(), true, true)

		if len(txs) < 1 {
			t.Fatalf("expected 1 tx, got %d", len(txs))
		}
		if txs[0].TxType != TxTypeTicketPurchase {
			t.Errorf("TxType: want %d (TicketPurchase), got %d", TxTypeTicketPurchase, txs[0].TxType)
		}
	})

	t.Run("script fallback for tx that misclassifies as regular", func(t *testing.T) {
		tx := wire.NewMsgTx()
		tx.AddTxIn(wire.NewTxIn(&wire.OutPoint{}, 1000, nil))
		tx.AddTxOut(wire.NewTxOut(100000000, opSSTXP2PKH()))

		blk := &wire.MsgBlock{}
		blk.STransactions = []*wire.MsgTx{tx}

		txs, _, _ := processTransactions(blk, wire.TxTreeStake, chaincfg.SimNetParams(), true, true)

		if len(txs) < 1 {
			t.Fatalf("expected 1 tx, got %d", len(txs))
		}
		if txs[0].TxType != TxTypeTicketPurchase {
			t.Errorf("TxType: want %d (TicketPurchase), got %d", TxTypeTicketPurchase, txs[0].TxType)
		}
	})
}

func Test_processTransactions_SSFeeMarkerSplit(t *testing.T) {
	sfScript := stake.CreateStakerSSFeeMarker(1338, 1)
	mfScript := stake.CreateMinerSSFeeMarker(1338)
	p2pkhScript := opP2PKH()

	sfTx := wire.NewMsgTx()
	sfTx.Version = 3
	sfTx.AddTxIn(wire.NewTxIn(&wire.OutPoint{}, 0, nil))
	sfTx.AddTxOut(&wire.TxOut{
		Value:    0,
		Version:  0,
		PkScript: sfScript,
		CoinType: cointype.CoinTypeVAR,
	})
	sfTx.AddTxOut(&wire.TxOut{
		Value:    100000000,
		Version:  0,
		PkScript: p2pkhScript,
		CoinType: cointype.CoinTypeVAR,
	})

	skaOut := big.NewInt(500000000000000000)
	mfTx := wire.NewMsgTx()
	mfTx.Version = 3
	mfTx.AddTxIn(wire.NewTxIn(&wire.OutPoint{}, 0, nil))
	mfTx.AddTxOut(&wire.TxOut{
		Value:    0,
		Version:  0,
		PkScript: mfScript,
		CoinType: cointype.CoinType(1),
	})
	mfTx.AddTxOut(&wire.TxOut{
		Value:    0,
		Version:  0,
		PkScript: p2pkhScript,
		CoinType: cointype.CoinType(1),
		SKAValue: skaOut,
	})

	blk := &wire.MsgBlock{}
	blk.STransactions = []*wire.MsgTx{sfTx, mfTx}

	txs, _, _ := processTransactions(blk, wire.TxTreeStake, chaincfg.SimNetParams(), true, true)

	if len(txs) < 2 {
		t.Fatalf("expected 2 txs, got %d", len(txs))
	}
	if txs[0].TxType != TxTypeSSFeePoS {
		t.Errorf("SF tx TxType: want %d (SSFeePoS), got %d", TxTypeSSFeePoS, txs[0].TxType)
	}
	if txs[1].TxType != TxTypeSSFeePoW {
		t.Errorf("MF tx TxType: want %d (SSFeePoW), got %d", TxTypeSSFeePoW, txs[1].TxType)
	}
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// opP2PKH builds a standard P2PKH script (25 bytes).
func opP2PKH() []byte {
	script := make([]byte, 25)
	script[0] = 0x76  // OP_DUP
	script[1] = 0xa9  // OP_HASH160
	script[2] = 0x14  // OP_DATA_20
	script[23] = 0x88 // OP_EQUALVERIFY
	script[24] = 0xac // OP_CHECKSIG
	return script
}

// opSSTXP2PKH builds an OP_SSTX-tagged P2PKH script (26 bytes).
func opSSTXP2PKH() []byte {
	script := make([]byte, 26)
	script[0] = 0xba  // OP_SSTX
	script[1] = 0x76  // OP_DUP
	script[2] = 0xa9  // OP_HASH160
	script[3] = 0x14  // OP_DATA_20
	script[24] = 0x88 // OP_EQUALVERIFY
	script[25] = 0xac // OP_CHECKSIG
	return script
}

// validSStx builds a valid stake submission (ticket) tx with 1 input
// and 3 outputs (OP_SSTX, OP_RETURN commitment, OP_SSTXCHANGE).
func validSStx() *wire.MsgTx {
	tx := wire.NewMsgTx()
	tx.AddTxIn(wire.NewTxIn(&wire.OutPoint{}, 100000000, nil))

	tx.AddTxOut(wire.NewTxOut(100000000, opSSTXP2PKH()))

	commitment := make([]byte, 42)
	commitment[0] = 0x6a // OP_RETURN
	commitment[1] = 0x28 // OP_DATA_40
	tx.AddTxOut(wire.NewTxOut(0, commitment))

	changeScript := make([]byte, 26)
	changeScript[0] = 0xbd  // OP_SSTXCHANGE
	changeScript[1] = 0x76  // OP_DUP
	changeScript[2] = 0xa9  // OP_HASH160
	changeScript[3] = 0x14  // OP_DATA_20
	changeScript[24] = 0x88 // OP_EQUALVERIFY
	changeScript[25] = 0xac // OP_CHECKSIG
	tx.AddTxOut(wire.NewTxOut(20000000, changeScript))

	return tx
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
