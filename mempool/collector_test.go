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
		Hash:     "aaaa",
		TxID:     "aaaa",
		Size:     250,
		TotalOut: 1.0,
		TypeID:   0, // regular
	}
	skaTx := exptypes.MempoolTx{
		Hash:      "bbbb",
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
		t.Errorf("SKA-1 TxCount: want 1, got %d", inv.CoinStats[1].TxCount)
	}
	if inv.CoinStats[1].Size != 300 {
		t.Errorf("SKA-1 Size: want 300, got %d", inv.CoinStats[1].Size)
	}
	if inv.CoinStats[1].Amount != "1000000000000000000" {
		t.Errorf("SKA-1 Amount: want 1000000000000000000, got %s", inv.CoinStats[1].Amount)
	}
}
