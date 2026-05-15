package mempool

import (
	"testing"

	"github.com/monetarium/monetarium-node/chaincfg/chainhash"
	"github.com/monetarium/monetarium-node/wire"

	exptypes "github.com/monetarium/monetarium-explorer/explorer/types"
	"github.com/monetarium/monetarium-explorer/txhelpers"
)

// TestAddTxToCoinStats_IncrementalVAR verifies that the incremental per-tx
// update applies counts and per-type amounts equivalently to the batch path:
// after adding VAR Regular + Ticket + Vote + Revocation txs, each *Amount
// field on CoinStats[0] reflects its tx-type only, and Amount equals the sum.
func TestAddTxToCoinStats_IncrementalVAR(t *testing.T) {
	stats := map[uint8]exptypes.MempoolCoinStats{}
	txs := []exptypes.MempoolTx{
		{Hash: "r1", Size: 100, TotalOut: 1.0, Type: "Regular"},
		{Hash: "t1", Size: 100, TotalOut: 2.0, Type: "Ticket"},
		{Hash: "v1", Size: 100, TotalOut: 3.0, Type: "Vote"},
		{Hash: "x1", Size: 100, TotalOut: 4.0, Type: "Revocation"},
	}
	for _, tx := range txs {
		addTxToCoinStats(stats, tx)
	}
	s := stats[0]
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
		t.Errorf("Amount: want %s, got %s", want, got)
	}
	if s.RegularCount != 1 || s.TicketCount != 1 || s.VoteCount != 1 || s.RevokeCount != 1 {
		t.Errorf("per-type counts: %+v", s)
	}
	if s.TxCount != 4 {
		t.Errorf("TxCount: want 4, got %d", s.TxCount)
	}
}

// TestAddTxToCoinStats_IncrementalSKA_Precision verifies that an SKA Regular
// tx with an amount exceeding float64's significand is preserved exactly
// through the incremental path, and that ticket/vote/revoke amounts for the
// SKA entry stay "0" by chain invariant.
func TestAddTxToCoinStats_IncrementalSKA_Precision(t *testing.T) {
	const bigAtoms = "123456789012345678901"
	stats := map[uint8]exptypes.MempoolCoinStats{}
	tx := exptypes.MempoolTx{
		Hash:      "s1",
		Size:      200,
		Type:      "Regular",
		SKATotals: map[uint8]string{2: bigAtoms},
	}
	addTxToCoinStats(stats, tx)

	s := stats[2]
	if got, want := s.RegularAmount, bigAtoms; got != want {
		t.Errorf("SKA RegularAmount: want %s, got %s", want, got)
	}
	if got, want := s.Amount, bigAtoms; got != want {
		t.Errorf("SKA Amount: want %s, got %s", want, got)
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

// TestAddTxToCoinStats_IncrementalAccumulates verifies repeated adds for the
// same coin accumulate the matching per-type amount without resetting it,
// and that types that never receive a contribution stay "0".
func TestAddTxToCoinStats_IncrementalAccumulates(t *testing.T) {
	stats := map[uint8]exptypes.MempoolCoinStats{}
	// Three VAR Regular txs.
	for range 3 {
		addTxToCoinStats(stats, exptypes.MempoolTx{
			Hash: "r", Size: 100, TotalOut: 1.5, Type: "Regular",
		})
	}
	s := stats[0]
	if got, want := s.RegularAmount, "450000000"; got != want {
		t.Errorf("RegularAmount: want %s, got %s", want, got)
	}
	if s.TicketAmount != "0" || s.VoteAmount != "0" || s.RevokeAmount != "0" {
		t.Errorf("untouched per-type fields should be \"0\": %+v", s)
	}
	if s.Amount != "450000000" {
		t.Errorf("Amount: want 450000000, got %s", s.Amount)
	}
}

// TestUnconfirmedTxnsForAddress_PerCoinCounts is the regression guard for
// issue #247: an address with one unconfirmed VAR tx and two unconfirmed SKA1
// txs must report numByCoin[0]==1, numByCoin[1]==2, and an aggregate of 3.
// Counts are distinct per tx hash (not per outpoint), so two outpoints from
// the same SKA1 tx still count once.
func TestUnconfirmedTxnsForAddress_PerCoinCounts(t *testing.T) {
	const addr = "TestAddr"

	// Three distinct unconfirmed txs funding the address: one VAR (coin 0)
	// and two SKA1 (coin 1). The VAR tx contributes two outpoints to prove
	// the count is per-tx, not per-outpoint.
	varHash := chainhash.Hash{0x01}
	ska1aHash := chainhash.Hash{0x02}
	ska1bHash := chainhash.Hash{0x03}

	txnsStore := txhelpers.TxnsStore{
		varHash:   {CoinInfo: txhelpers.CoinInfoMap{0: {CoinType: 0}, 1: {CoinType: 0}}},
		ska1aHash: {CoinInfo: txhelpers.CoinInfoMap{0: {CoinType: 1}}},
		ska1bHash: {CoinInfo: txhelpers.CoinInfoMap{0: {CoinType: 1}}},
	}

	outs := txhelpers.NewAddressOutpoints(addr)
	outs.Outpoints = []*wire.OutPoint{
		{Hash: varHash, Index: 0},
		{Hash: varHash, Index: 1}, // same tx, second output — must not double-count
		{Hash: ska1aHash, Index: 0},
		{Hash: ska1bHash, Index: 0},
	}

	p := &MempoolMonitor{txnsStore: txnsStore}
	p.addrMap.store = txhelpers.MempoolAddressStore{addr: outs}

	_, numByCoin, err := p.UnconfirmedTxnsForAddress(addr)
	if err != nil {
		t.Fatalf("UnconfirmedTxnsForAddress: %v", err)
	}

	if got := numByCoin[0]; got != 1 {
		t.Errorf("numByCoin[VAR]: want 1, got %d", got)
	}
	if got := numByCoin[1]; got != 2 {
		t.Errorf("numByCoin[SKA1]: want 2, got %d", got)
	}

	var aggregate int64
	for _, n := range numByCoin {
		aggregate += n
	}
	if aggregate != 3 {
		t.Errorf("aggregate NumUnconfirmed: want 3, got %d", aggregate)
	}
}
