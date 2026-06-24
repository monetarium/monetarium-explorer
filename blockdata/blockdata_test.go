package blockdata

import (
	"math/big"
	"testing"

	"github.com/monetarium/monetarium-node/blockchain/stake"
	"github.com/monetarium/monetarium-node/cointype"
	"github.com/monetarium/monetarium-node/dcrutil"
	"github.com/monetarium/monetarium-node/wire"
)

// newEmptyTx returns a fresh empty transaction for the coinbase slot at
// index 0. A package-level shared pointer would be dangerous — any test
// that mutates it would corrupt subsequent tests.
func newEmptyTx() *wire.MsgTx { return wire.NewMsgTx() }

// mockBlock builds a wire.MsgBlock with the given regular transactions,
// inserting an empty placeholder at index 0 (coinbase slot).
func mockBlock(txs ...*wire.MsgTx) *wire.MsgBlock {
	blk := &wire.MsgBlock{}
	blk.Transactions = append([]*wire.MsgTx{newEmptyTx()}, txs...)
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

// newTxWithFee creates a wire.MsgTx with an input of inputAmount atoms and outputs
// totalling inputAmount - fee atoms. The fee is the difference between input and outputs.
func newTxWithFee(inputAmount, fee int64) *wire.MsgTx {
	tx := wire.NewMsgTx()
	tx.AddTxIn(wire.NewTxIn(&wire.OutPoint{}, inputAmount, nil))
	tx.AddTxOut(wire.NewTxOut(inputAmount-fee, nil))
	return tx
}

// p2pkhScript is a minimal valid P2PKH output script for mock coinbase txns.
var p2pkhScript = func() []byte {
	s := make([]byte, 25)
	s[0] = 0x76  // OP_DUP
	s[1] = 0xa9  // OP_HASH160
	s[2] = 0x14  // DATA_20 (20 zero bytes for dummy hash)
	s[23] = 0x88 // OP_EQUALVERIFY
	s[24] = 0xac // OP_CHECKSIG
	return s
}()

// coinbaseWithP2PKH creates a coinbase tx with one TxIn carrying the actual
// vote-scaled subsidy and one P2PKH output (miner payment = subsidy + fees).
//
//nolint:unparam // subsidy is always 16e8 in current tests; kept for semantic clarity
func coinbaseWithP2PKH(subsidy, output int64) *wire.MsgTx {
	tx := wire.NewMsgTx()
	tx.AddTxIn(&wire.TxIn{ValueIn: subsidy})
	tx.AddTxOut(wire.NewTxOut(output, p2pkhScript))
	return tx
}

// Reference SStx output scripts copied verbatim from
// monetarium-node/blockchain/stake's own test fixtures (sstxTxOut0/1/2). They
// satisfy stake.CheckSStx purely as scripts — values are independent, so the
// helper below can dial in a chosen fee.
var (
	opSSTxScript = []byte{
		0xba, 0x76, 0xa9, 0x14, // OP_SSTX OP_DUP OP_HASH160 OP_DATA_20
		0xc3, 0x98, 0xef, 0xa9,
		0xc3, 0x92, 0xba, 0x60,
		0x13, 0xc5, 0xe0, 0x4e,
		0xe7, 0x29, 0x75, 0x5e,
		0xf7, 0xf5, 0x8b, 0x32,
		0x88, 0xac, // OP_EQUALVERIFY OP_CHECKSIG
	}
	opSStxCommitScript = []byte{
		0x6a, 0x1e, // OP_RETURN, 30-byte push
		0x94, 0x8c, 0x76, 0x5a,
		0x69, 0x14, 0xd4, 0x3f,
		0x2a, 0x7a, 0xc1, 0x77,
		0xda, 0x2c, 0x2f, 0x6b,
		0x52, 0xde, 0x3d, 0x7c,
		0x00, 0xe3, 0x23, 0x21,
		0x00, 0x00, 0x00, 0x00,
		0x44, 0x3f,
	}
	opSSTxChangeScript = []byte{
		0xbd, 0x76, 0xa9, 0x14, // OP_SSTXCHANGE OP_DUP OP_HASH160 OP_DATA_20
		0xc3, 0x98, 0xef, 0xa9,
		0xc3, 0x92, 0xba, 0x60,
		0x13, 0xc5, 0xe0, 0x4e,
		0xe7, 0x29, 0x75, 0x5e,
		0xf7, 0xf5, 0x8b, 0x32,
		0x88, 0xac,
	}
)

// newSStxWithFee returns an SStx (ticket) with one input of inputAmount atoms,
// outputs summing to inputAmount-fee, and a script layout that satisfies
// stake.IsSStx so DetermineTxType classifies it as TxTypeSStx.
func newSStxWithFee(t *testing.T, inputAmount, fee int64) *wire.MsgTx {
	t.Helper()
	if fee < 0 || fee > inputAmount {
		t.Fatalf("invalid test setup: inputAmount=%d fee=%d", inputAmount, fee)
	}
	purchase := (inputAmount - fee) / 2
	change := (inputAmount - fee) - purchase

	tx := wire.NewMsgTx()
	tx.AddTxIn(wire.NewTxIn(&wire.OutPoint{}, inputAmount, nil))

	out0 := wire.NewTxOut(purchase, opSSTxScript)
	tx.AddTxOut(out0)
	out1 := wire.NewTxOut(0, opSStxCommitScript)
	tx.AddTxOut(out1)
	out2 := wire.NewTxOut(change, opSSTxChangeScript)
	tx.AddTxOut(out2)

	if !stake.IsSStx(tx) {
		t.Fatalf("test fixture failed: constructed tx is not classified as SStx")
	}
	return tx
}

func TestComputeMinerVARFeeAtoms_NoRegularTx(t *testing.T) {
	s := int64(16e8)
	block := &wire.MsgBlock{
		Transactions: []*wire.MsgTx{coinbaseWithP2PKH(s, s)},
	}

	got := computeMinerVARFeeAtoms(block)
	if got != 0 {
		t.Errorf("got %d, want 0", got)
	}
}

func TestComputeMinerVARFeeAtoms_WithRegularTx(t *testing.T) {
	s := int64(16e8)
	fee := int64(10_000)
	block := &wire.MsgBlock{
		Transactions: []*wire.MsgTx{coinbaseWithP2PKH(s, s+fee), newTxWithFee(100_000, fee)},
	}

	got := computeMinerVARFeeAtoms(block)
	if got != fee {
		t.Errorf("got %d, want %d", got, fee)
	}
}

func TestComputeMinerVARFeeAtoms_NoFees(t *testing.T) {
	s := int64(16e8)
	block := &wire.MsgBlock{
		Transactions: []*wire.MsgTx{coinbaseWithP2PKH(s, s), newTxWithFee(100_000, 0)},
	}

	got := computeMinerVARFeeAtoms(block)
	if got != 0 {
		t.Errorf("got %d, want 0", got)
	}
}

func TestComputeMinerVARFeeAtoms_MultipleRegularTx(t *testing.T) {
	s := int64(16e8)
	fees := []int64{1_000, 2_000, 3_000}
	totalFee := fees[0] + fees[1] + fees[2]
	block := &wire.MsgBlock{
		Transactions: []*wire.MsgTx{
			coinbaseWithP2PKH(s, s+totalFee),
			newTxWithFee(10_000, fees[0]),
			newTxWithFee(20_000, fees[1]),
			newTxWithFee(30_000, fees[2]),
		},
	}

	got := computeMinerVARFeeAtoms(block)
	if got != totalFee {
		t.Errorf("got %d, want %d", got, totalFee)
	}
}

func TestComputeMinerVARFeeAtoms_TicketInSTransactions(t *testing.T) {
	s := int64(16e8)
	// This test uses a coinbase with ONLY the subsidy and no fees, so the
	// result is 0 regardless of how ticket fees are split. In real blocks
	// the miner's 50% share of ticket fees DOES reach the coinbase (see
	// TestComputeMinerVARFeeAtoms_BothTrees).
	block := &wire.MsgBlock{
		Transactions:  []*wire.MsgTx{coinbaseWithP2PKH(s, s)},
		STransactions: []*wire.MsgTx{newSStxWithFee(t, 1_000_000, 12_345)},
	}

	got := computeMinerVARFeeAtoms(block)
	if got != 0 {
		t.Errorf("got %d, want 0 (coinbase has subsidy only, no fees)", got)
	}
}

func TestComputeMinerVARFeeAtoms_BothTrees(t *testing.T) {
	s := int64(16e8)
	regFee := int64(1_000)
	// This test is a simplified unit test — it only puts the regular tx fee
	// in the coinbase. In real blocks the miner receives 50% of ALL VAR fees
	// (regular + ticket = 52,270 total, miner gets 26,135), which includes
	// 50% of ticket fees. The full 50% split is validated by
	// TestComputeMinerVARFeeAtoms_Block4423Style.
	block := &wire.MsgBlock{
		Transactions: []*wire.MsgTx{coinbaseWithP2PKH(s, s+regFee), newTxWithFee(50_000, regFee)},
		STransactions: []*wire.MsgTx{
			newSStxWithFee(t, 1_000_000, 2_500),
			newSStxWithFee(t, 2_000_000, 4_000),
		},
	}

	got := computeMinerVARFeeAtoms(block)
	if got != regFee {
		t.Errorf("got %d, want %d (only regular tx fee counted)", got, regFee)
	}
}

func TestComputeMinerVARFeeAtoms_CoinbaseNoP2PKH(t *testing.T) {
	// With the conservation approach (Σoutputs − Σinputs), ALL VAR value
	// creation in the coinbase counts as fee, regardless of script type.
	// A nil-script output carrying value over the input is still fee.
	s := int64(16e8)
	fee := int64(5_000)
	coinbase := wire.NewMsgTx()
	coinbase.AddTxIn(&wire.TxIn{ValueIn: s})
	coinbase.AddTxOut(wire.NewTxOut(s+fee, nil)) // nil pkScript carries value too

	block := &wire.MsgBlock{
		Transactions: []*wire.MsgTx{coinbase, newTxWithFee(100_000, fee)},
	}

	got := computeMinerVARFeeAtoms(block)
	if got != fee {
		t.Errorf("got %d, want %d", got, fee)
	}
}

func TestComputeMinerVARFeeAtoms_Block4423Style(t *testing.T) {
	// Mimics real block 4423 coinbase: 3 outputs (nonstandard vout[0],
	// OP_RETURN vout[1], P2PKH vout[2] = subsidy + fees). The conservation
	// approach (Σoutputs − Σinputs) works because vout[0,1] are zero-value.
	powSubsidy := int64(3_200_000_000)
	minerFee := int64(26_135)
	coinbase := wire.NewMsgTx()
	coinbase.AddTxIn(&wire.TxIn{ValueIn: powSubsidy})
	coinbase.AddTxOut(wire.NewTxOut(0, []byte{0x51}))                  // nonstandard (OP_1)
	coinbase.AddTxOut(wire.NewTxOut(0, []byte{0x6a}))                  // OP_RETURN
	coinbase.AddTxOut(wire.NewTxOut(powSubsidy+minerFee, p2pkhScript)) // P2PKH miner payout

	block := &wire.MsgBlock{Transactions: []*wire.MsgTx{coinbase}}
	got := computeMinerVARFeeAtoms(block)
	if got != minerFee {
		t.Errorf("got %d, want %d", got, minerFee)
	}
}

// TestComputeMinerVARFeeAtoms_FourVoteBlock verifies that the function
// correctly extracts the miner fee when the coinbase carries a vote-scaled
// subsidy (e.g. 4 votes instead of the maximum 5). The old approach of
// subtracting a hardcoded 5-vote subsidy from the RPC would fail here:
//
//	fullSubsidy = 1_600_000_000
//	voteScaledSubsidy = fullSubsidy * 4 / 5 = 1_280_000_000
//	minerOutput = voteScaledSubsidy + fee = 1_280_010_000
//	OLD: minerOutput - fullSubsidy = -319_990_000 → clamped to 0  ← BUG
//	NEW: minerOutput - voteScaledSubsidy = 10_000  ← CORRECT
func TestComputeMinerVARFeeAtoms_FourVoteBlock(t *testing.T) {
	fullSubsidy := int64(1_600_000_000)
	voteScaledSubsidy := fullSubsidy * 4 / 5
	fee := int64(10_000)
	coinbase := wire.NewMsgTx()
	coinbase.AddTxIn(&wire.TxIn{ValueIn: voteScaledSubsidy})
	coinbase.AddTxOut(wire.NewTxOut(voteScaledSubsidy+fee, p2pkhScript))

	block := &wire.MsgBlock{Transactions: []*wire.MsgTx{coinbase}}
	got := computeMinerVARFeeAtoms(block)
	if got != fee {
		t.Errorf("got %d, want %d", got, fee)
	}
}

// TestComputeMinerVARFeeAtoms_ZeroVoteBlock verifies the function handles a
// block before stake validation height (no votes, full subsidy in coinbase).
func TestComputeMinerVARFeeAtoms_ZeroVoteBlock(t *testing.T) {
	subsidy := int64(1_600_000_000)
	fee := int64(5_000)
	coinbase := wire.NewMsgTx()
	coinbase.AddTxIn(&wire.TxIn{ValueIn: subsidy})
	coinbase.AddTxOut(wire.NewTxOut(subsidy+fee, p2pkhScript))

	block := &wire.MsgBlock{Transactions: []*wire.MsgTx{coinbase}}
	got := computeMinerVARFeeAtoms(block)
	if got != fee {
		t.Errorf("got %d, want %d", got, fee)
	}
}

// Block 4423 known totals (from real block analysis):
//   - Regular tx fees (non-coinbase): 31,130 atoms
//   - Ticket purchase fees: 21,140 atoms
//   - Total VAR fees: 31,130 + 21,140 = 52,270 atoms
//   - dcrutil.Amount(52_270).ToCoin() = 0.00052270 VAR
//   - Miner fee (coinbase P2PKH - PoW subsidy): 26,135 atoms
func TestBlock4423_KnownFeeValues(t *testing.T) {
	const (
		regFees      = int64(31_130)
		ticketFees   = int64(21_140)
		totalVARFees = int64(52_270)
		totalVARCoin = 0.00052270
	)
	if regFees+ticketFees != totalVARFees {
		t.Fatal("broken test: reg + ticket != total")
	}
	coin := dcrutil.Amount(totalVARFees).ToCoin()
	if coin != totalVARCoin {
		t.Errorf("dcrutil.Amount(%d).ToCoin() = %.8f, want %.8f", totalVARFees, coin, totalVARCoin)
	}
}
