// Copyright (c) 2024, The Monetarium developers
// Use of this source code is governed by an ISC
// license that can be found in the LICENSE file.

package txhelpers

import (
	"math"
	"math/big"
	"testing"

	"github.com/monetarium/monetarium-explorer/api/rewardtypes"
	"github.com/monetarium/monetarium-node/blockchain/stake"
	"github.com/monetarium/monetarium-node/chaincfg"
	"github.com/monetarium/monetarium-node/cointype"
	"github.com/monetarium/monetarium-node/wire"
)

// ---------------------------------------------------------------------------
// FormatSKAAtoms
// ---------------------------------------------------------------------------

func TestFormatSKAAtoms(t *testing.T) {
	tests := []struct {
		name string
		in   *big.Int
		want string
	}{
		{"nil input", nil, "0"},
		{"zero", big.NewInt(0), "0"},
		{"negative", big.NewInt(-1), "0"},
		{"one atom", big.NewInt(1), "1"},
		{"one coin (1e18)", new(big.Int).Exp(big.NewInt(10), big.NewInt(18), nil), "1000000000000000000"},
		{"large value", func() *big.Int {
			v, _ := new(big.Int).SetString("123456789012345678901234567890", 10)
			return v
		}(), "123456789012345678901234567890"},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := FormatSKAAtoms(tc.in)
			if got != tc.want {
				t.Errorf("FormatSKAAtoms(%v) = %q, want %q", tc.in, got, tc.want)
			}
		})
	}
}

// ---------------------------------------------------------------------------
// FormatSKAPerVAR
// ---------------------------------------------------------------------------

func TestFormatSKAPerVAR(t *testing.T) {
	zero18 := "0.000000000000000000"

	tests := []struct {
		name     string
		skaAtoms *big.Int
		varAtoms int64
		want     string
	}{
		{"nil ska", nil, 1e8, zero18},
		{"zero ska", big.NewInt(0), 1e8, zero18},
		{"negative ska", big.NewInt(-1), 1e8, zero18},
		{"zero var", big.NewInt(1e18), 0, zero18},
		{"negative var", big.NewInt(1e18), -1, zero18},
		{"1 SKA per 1 VAR", new(big.Int).Exp(big.NewInt(10), big.NewInt(18), nil), 1e8, "1.000000000000000000"},
		{"0.5 SKA per 1 VAR", new(big.Int).SetInt64(5e17), 1e8, "0.500000000000000000"},
		{"2 SKA per 1 VAR", new(big.Int).Mul(big.NewInt(2), new(big.Int).Exp(big.NewInt(10), big.NewInt(18), nil)), 1e8, "2.000000000000000000"},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := FormatSKAPerVAR(tc.skaAtoms, tc.varAtoms)
			if got != tc.want {
				t.Errorf("FormatSKAPerVAR(%v, %d) = %q, want %q", tc.skaAtoms, tc.varAtoms, got, tc.want)
			}
		})
	}
}

// ---------------------------------------------------------------------------
// SSFeeCoinTypes
// ---------------------------------------------------------------------------

func TestSSFeeCoinTypes(t *testing.T) {
	t.Run("empty summaries", func(t *testing.T) {
		got := SSFeeCoinTypes(nil)
		if len(got) != 0 {
			t.Errorf("expected empty map, got %v", got)
		}
	})

	t.Run("single coin type", func(t *testing.T) {
		summaries := []BlockSummary{
			{SSFeeTotalsByCoin: map[uint8]rewardtypes.SSFeeSplit{1: {PoS: big.NewInt(100)}}},
			{SSFeeTotalsByCoin: map[uint8]rewardtypes.SSFeeSplit{1: {PoS: big.NewInt(200)}}},
		}
		got := SSFeeCoinTypes(summaries)
		if len(got) != 1 {
			t.Errorf("expected 1 coin type, got %d", len(got))
		}
		if _, ok := got[1]; !ok {
			t.Error("expected coin type 1 to be present")
		}
	})

	t.Run("multiple coin types across blocks", func(t *testing.T) {
		summaries := []BlockSummary{
			{SSFeeTotalsByCoin: map[uint8]rewardtypes.SSFeeSplit{1: {PoS: big.NewInt(100)}, 2: {PoS: big.NewInt(200)}}},
			{SSFeeTotalsByCoin: map[uint8]rewardtypes.SSFeeSplit{2: {PoS: big.NewInt(300)}, 3: {PoS: big.NewInt(400)}}},
		}
		got := SSFeeCoinTypes(summaries)
		if len(got) != 3 {
			t.Errorf("expected 3 coin types, got %d: %v", len(got), got)
		}
		for _, ct := range []uint8{1, 2, 3} {
			if _, ok := got[ct]; !ok {
				t.Errorf("expected coin type %d to be present", ct)
			}
		}
	})

	t.Run("summaries with no coin data", func(t *testing.T) {
		summaries := []BlockSummary{
			{SSFeeTotalsByCoin: nil},
			{SSFeeTotalsByCoin: map[uint8]rewardtypes.SSFeeSplit{}},
		}
		got := SSFeeCoinTypes(summaries)
		if len(got) != 0 {
			t.Errorf("expected empty map, got %v", got)
		}
	})
}

// ---------------------------------------------------------------------------
// CalculateAverageTicketAPY
// ---------------------------------------------------------------------------

func TestCalculateAverageTicketAPY(t *testing.T) {
	mustInt := func(s string) *big.Int {
		v, ok := new(big.Int).SetString(s, 10)
		if !ok {
			t.Fatalf("mustInt: cannot parse %q", s)
		}
		return v
	}

	oneReward := big.NewFloat(1.0)

	t.Run("empty vote data returns zero sentinel", func(t *testing.T) {
		got := CalculateAverageTicketAPY(nil, oneReward, big.NewFloat(52560))
		if got != "0" {
			t.Errorf("got %q, want \"0\"", got)
		}
	})

	t.Run("all invalid tickets returns zero", func(t *testing.T) {
		data := []VoteTicketData{
			{TicketPrice: "not-a-number", VoteHeight: 100, PurchaseHeight: 90},
			{TicketPrice: "0", VoteHeight: 100, PurchaseHeight: 90},
			{TicketPrice: "100000000", VoteHeight: 50, PurchaseHeight: 100},
		}
		got := CalculateAverageTicketAPY(data, oneReward, big.NewFloat(52560))
		if got != "0" {
			t.Errorf("got %q, want \"0\"", got)
		}
	})

	t.Run("result is a valid atom string", func(t *testing.T) {
		data := []VoteTicketData{
			{TicketPrice: "10000000000", VoteHeight: 244, PurchaseHeight: 100},
		}
		got := CalculateAverageTicketAPY(data, oneReward, big.NewFloat(52560))
		if got == "0" || got == "0.000000000000000000" {
			t.Fatalf("expected non-zero result, got %q", got)
		}
		v := mustInt(got)
		if v.Sign() <= 0 {
			t.Errorf("expected positive atom value, got %s", got)
		}
	})

	t.Run("decimal ticket price accepted", func(t *testing.T) {
		atomData := []VoteTicketData{
			{TicketPrice: "10000000000", VoteHeight: 244, PurchaseHeight: 100},
		}
		decimalData := []VoteTicketData{
			{TicketPrice: "100.00000000", VoteHeight: 244, PurchaseHeight: 100},
		}
		gotAtom := CalculateAverageTicketAPY(atomData, oneReward, big.NewFloat(52560))
		gotDecimal := CalculateAverageTicketAPY(decimalData, oneReward, big.NewFloat(52560))
		if gotAtom != gotDecimal {
			t.Errorf("atom path %q != decimal path %q", gotAtom, gotDecimal)
		}
	})

	t.Run("higher reward produces higher APY atoms", func(t *testing.T) {
		data := []VoteTicketData{
			{TicketPrice: "10000000000", VoteHeight: 244, PurchaseHeight: 100},
		}
		lowReward := big.NewFloat(0.5)
		highReward := big.NewFloat(2.0)
		low := mustInt(CalculateAverageTicketAPY(data, lowReward, big.NewFloat(52560)))
		high := mustInt(CalculateAverageTicketAPY(data, highReward, big.NewFloat(52560)))
		if high.Cmp(low) <= 0 {
			t.Errorf("expected high reward (%s) > low reward (%s)", high, low)
		}
	})

	t.Run("reward rounds to zero atoms returns zero", func(t *testing.T) {
		data := []VoteTicketData{
			{TicketPrice: "100000000000000000000000", VoteHeight: 1_000_000_000, PurchaseHeight: 0},
		}
		tinyReward := new(big.Float).SetFloat64(1e-30)
		got := CalculateAverageTicketAPY(data, tinyReward, big.NewFloat(52560))
		if got != "0" {
			t.Errorf("expected \"0\" for near-zero reward, got %q", got)
		}
	})

	t.Run("average across multiple tickets", func(t *testing.T) {
		data := []VoteTicketData{
			{TicketPrice: "10000000000", VoteHeight: 200, PurchaseHeight: 100},
			{TicketPrice: "10000000000", VoteHeight: 400, PurchaseHeight: 100},
		}
		single100 := mustInt(CalculateAverageTicketAPY([]VoteTicketData{data[0]}, oneReward, big.NewFloat(52560)))
		single300 := mustInt(CalculateAverageTicketAPY([]VoteTicketData{data[1]}, oneReward, big.NewFloat(52560)))
		avg := mustInt(CalculateAverageTicketAPY(data, oneReward, big.NewFloat(52560)))
		if avg.Cmp(single300) <= 0 || avg.Cmp(single100) >= 0 {
			t.Errorf("average %s not between %s (age=300) and %s (age=100)", avg, single300, single100)
		}
	})
}

// ---------------------------------------------------------------------------
// ComputeVoteVARReward
// ---------------------------------------------------------------------------

func TestComputeVoteVARReward(t *testing.T) {
	params := &chaincfg.Params{
		TargetTimePerBlock: 15 * 60 * 1e9,
		CoinbaseMaturity:   100,
	}

	t.Run("Block 36354 reproduction", func(t *testing.T) {
		latestVarFee := 3.19483536
		voters := int64(5)
		subsidy := 16.0
		voteData := []VoteTicketData{}
		res := ComputeVoteVARReward(latestVarFee, voteData, params, voters, subsidy)
		expectedFee := 0.638967072
		if res.Fee <= 0 {
			t.Errorf("Reproduction failed: Fee is %.8f, but expected a positive value around %.8f", res.Fee, expectedFee)
		} else if math.Abs(res.Fee-expectedFee) > 0.0001 {
			t.Errorf("Incorrect fee calculation: got %.8f, want %.8f", res.Fee, expectedFee)
		}
	})
}

// ---------------------------------------------------------------------------
// BlockSSFeeTotals
// ---------------------------------------------------------------------------

func TestBlockSSFeeTotals(t *testing.T) {
	t.Run("empty block returns nil", func(t *testing.T) {
		// Using an empty slice of MsgTx to satisfy the type
		got := BlockSSFeeTotals(nil, []*wire.MsgTx{})
		if got != nil {
			t.Errorf("expected nil, got %v", got)
		}
	})
	t.Run("SSGen block with fees", func(t *testing.T) {
		ssGenTxs := []TxFeeData{
			{
				TotalVAROutputs: 1602300000,
				TotalInputs:     1600000000,
				IsSSGen:         true,
				TxType:          int(stake.TxTypeSSGen),
			},
		}
		sTxs := []*wire.MsgTx{}
		got := BlockSSFeeTotals(ssGenTxs, sTxs)
		if got != nil {
			// In our new logic, we ONLY sum type=7 in sTxs.
			// ssGenTxs are used for VAR net, but if sTxs is empty,
			// we only have VAR reward.
			if split, ok := got[0]; ok {
				if split.PoS.Cmp(big.NewInt(2300000)) != 0 {
					t.Errorf("expected VAR fee 2300000, got %v", split.PoS)
				}
			} else {
				t.Errorf("expected VAR fee to be present")
			}
		}
	})
	t.Run("Marker-based attribution", func(t *testing.T) {
		// A realistic stakegen script to help stake.DetermineTxType recognize this as an SSFee tx
		stakegenScript := []byte{0xbb, 0x76, 0xa9, 0x14, 0x16, 0xed, 0x35, 0x0c, 0x59, 0xde, 0x7a, 0x50, 0x35, 0x95, 0x2d, 0x19, 0x49, 0xae, 0x15, 0xca, 0xba, 0x18, 0xf0, 0x81, 0x88, 0xac}

		tests := []struct {
			name     string
			coinType uint8
			inputs   []int64
			outputs  []int64
			scripts  [][]byte
			wantPoW  *big.Int
			wantPoS  *big.Int
		}{
			{
				name:     "Miner marker (MF)",
				coinType: 1,
				inputs:   []int64{1844000000000000000},
				outputs:  []int64{2394000000000000000, 0},
				scripts: [][]byte{
					stakegenScript,
					{0x6a, 0x06, 0x4d, 0x46, 0x06, 0x12, 0x00, 0x00}, // OP_RETURN MF...
				},
				wantPoW: big.NewInt(550000000000000000),
				wantPoS: nil,
			},
			{
				name:     "Staker marker (SF)",
				coinType: 1,
				inputs:   []int64{1128000000000000000},
				outputs:  []int64{1568000000000000000, 0},
				scripts: [][]byte{
					stakegenScript,
					{0x6a, 0x08, 0x53, 0x46, 0x06, 0x12, 0x00, 0x00, 0x00, 0x00}, // OP_RETURN SF...
				},
				wantPoW: nil,
				wantPoS: big.NewInt(440000000000000000),
			},
			{
				name:     "No valid marker",
				coinType: 1,
				inputs:   []int64{1000},
				outputs:  []int64{2000, 0},
				scripts: [][]byte{
					stakegenScript,
					{0x6a, 0x01, 0x00}, // Invalid marker
				},
				wantPoW: nil,
				wantPoS: nil,
			},
		}

		for _, tc := range tests {
			t.Run(tc.name, func(t *testing.T) {
				var txs []*wire.MsgTx
				tx := &wire.MsgTx{}
				for _, inVal := range tc.inputs {
					tx.TxIn = append(tx.TxIn, &wire.TxIn{
						ValueIn:    inVal,
						SKAValueIn: big.NewInt(inVal),
					})
				}
				for j, outVal := range tc.outputs {
					tx.TxOut = append(tx.TxOut, &wire.TxOut{
						Value:     outVal,
						PkScript:  tc.scripts[j],
						CoinType:  cointype.CoinType(tc.coinType),
						SKAValue:   big.NewInt(outVal),
					})
				}
				txs = append(txs, tx)

				got := blockSSFeeTotalsInternal(nil, txs, func(tx *wire.MsgTx) stake.TxType {
					return stake.TxTypeSSFee
				})
				if got == nil {
					t.Fatalf("expected non-nil result, got nil")
				}

				split, ok := got[tc.coinType]
				if !ok {
					t.Fatalf("expected coin type %d to be present", tc.coinType)
				}

				if (split.PoW == nil) != (tc.wantPoW == nil) || (split.PoW != nil && split.PoW.Cmp(tc.wantPoW) != 0) {
					t.Errorf("PoW reward = %v, want %v", split.PoW, tc.wantPoW)
				}
				if (split.PoS == nil) != (tc.wantPoS == nil) || (split.PoS != nil && split.PoS.Cmp(tc.wantPoS) != 0) {
					t.Errorf("PoS reward = %v, want %v", split.PoS, tc.wantPoS)
				}
			})
		}
	})
}
