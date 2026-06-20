package mempool

import (
	"testing"

	"github.com/monetarium/monetarium-node/chaincfg"
	"github.com/monetarium/monetarium-node/chaincfg/chainhash"

	exptypes "github.com/monetarium/monetarium-explorer/explorer/types"
)

func TestParseTxns_CoinStats(t *testing.T) {
	params := chaincfg.MainNetParams()
	lastBlock := &BlockID{Hash: chainhash.Hash{}, Height: 1, Time: 0}

	varTx := exptypes.MempoolTx{
		TxID:     "aaaa",
		Size:     250,
		TotalOut: 1.0,
		TypeID:   0, // regular
	}
	skaTx := exptypes.MempoolTx{
		TxID:      "bbbb",
		Size:      300,
		TotalOut:  0,
		TypeID:    0, // regular
		SKATotals: map[uint8]string{1: "1000000000000000000"},
	}

	inv := ParseTxns([]exptypes.MempoolTx{varTx, skaTx}, params, lastBlock)

	if inv.CoinStats[0].TxCount != 1 {
		t.Errorf("VAR TxCount: want 1, got %d", inv.CoinStats[0].TxCount)
	}
	if inv.CoinStats[0].Size != 250 {
		t.Errorf("VAR Size: want 250, got %d", inv.CoinStats[0].Size)
	}
	if inv.CoinStats[1].TxCount != 1 {
		t.Errorf("SKA1 TxCount: want 1, got %d", inv.CoinStats[1].TxCount)
	}
	if inv.CoinStats[1].Size != 300 {
		t.Errorf("SKA1 Size: want 300, got %d", inv.CoinStats[1].Size)
	}
	if inv.CoinStats[1].Amount != "1000000000000000000" {
		t.Errorf("SKA1 Amount: want 1000000000000000000, got %s", inv.CoinStats[1].Amount)
	}
}

// TestParseTxns_PerTypeAmounts_VAR asserts that per-type amount aggregates are
// populated for each tx-type on the VAR coin entry, with "0" for types that
// received no contribution, and that the total Amount equals the sum of the
// per-type amounts (internal consistency).
func TestParseTxns_PerTypeAmounts_VAR(t *testing.T) {
	params := chaincfg.MainNetParams()
	lastBlock := &BlockID{Hash: chainhash.Hash{}, Height: 1, Time: 0}

	txs := []exptypes.MempoolTx{
		{TxID: "r1", Size: 100, TotalOut: 1.0, Type: "Regular"},
		{TxID: "t1", Size: 100, TotalOut: 2.0, Type: "Ticket"},
		{TxID: "v1", Size: 100, TotalOut: 3.0, Type: "Vote"},
		{TxID: "x1", Size: 100, TotalOut: 4.0, Type: "Revocation"},
	}

	inv := ParseTxns(txs, params, lastBlock)
	s := inv.CoinStats[0]

	if got, want := s.RegularAmount, "100000000"; got != want {
		t.Errorf("RegularAmount: want %s, got %s", want, got)
	}
	if got, want := s.TicketAmount, "200000000"; got != want {
		t.Errorf("TicketAmount: want %s, got %s", want, got)
	}
	if got, want := s.VoteAmount, "300000000"; got != want {
		t.Errorf("VoteAmount: want %s, got %s", want, got)
	}
	if got, want := s.RevokeAmount, "400000000"; got != want {
		t.Errorf("RevokeAmount: want %s, got %s", want, got)
	}
	if got, want := s.Amount, "1000000000"; got != want {
		t.Errorf("Amount (total): want %s, got %s", want, got)
	}
}

// TestParseTxns_PerTypeAmounts_SKA_Precision asserts that an SKA Regular tx
// with an 18-decimal amount that exceeds float64's significand round-trips
// exactly through aggregation, and that ticket/vote/revoke amounts stay "0"
// (SKA cannot appear in stake transactions).
func TestParseTxns_PerTypeAmounts_SKA_Precision(t *testing.T) {
	params := chaincfg.MainNetParams()
	lastBlock := &BlockID{Hash: chainhash.Hash{}, Height: 1, Time: 0}

	// 21-digit atom value, well beyond float64's 2^53 (~16 digits).
	const bigAtoms = "123456789012345678901"
	txs := []exptypes.MempoolTx{
		{
			TxID:      "s1",
			Size:      200,
			TotalOut:  0,
			Type:      "Regular",
			SKATotals: map[uint8]string{2: bigAtoms},
		},
	}

	inv := ParseTxns(txs, params, lastBlock)
	s := inv.CoinStats[2]

	if got, want := s.RegularAmount, bigAtoms; got != want {
		t.Errorf("SKA RegularAmount: want %s, got %s", want, got)
	}
	if got, want := s.Amount, bigAtoms; got != want {
		t.Errorf("SKA Amount (total): want %s, got %s", want, got)
	}
	for label, got := range map[string]string{
		"TicketAmount": s.TicketAmount,
		"VoteAmount":   s.VoteAmount,
		"RevokeAmount": s.RevokeAmount,
	} {
		if got != "0" {
			t.Errorf("SKA %s: want \"0\", got %q", label, got)
		}
	}
}
