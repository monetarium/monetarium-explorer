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
		// latestVarFee is now the isolated SF-marked SSFee VAR staker payout
		// (positive), no longer the lumped SSGen/SSRtx/SSFee net that the
		// consolidation made ≤ 0. The fee must flow through.
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

	t.Run("negative fee is no longer capped to zero", func(t *testing.T) {
		// Replaces the old TestComputeVoteVARReward_NegativeFee, with the
		// expectation flipped: per the spec the 0-cap is removed, so a
		// negative net redistribution propagates instead of being zeroed.
		latestVarFee := -0.00614520
		voters := int64(5)
		subsidy := 16.0
		res := ComputeVoteVARReward(latestVarFee, []VoteTicketData{}, params, voters, subsidy)
		wantFee := latestVarFee / float64(voters)
		if math.Abs(res.Fee-wantFee) > 1e-12 {
			t.Errorf("Fee got %.10f, want %.10f (must not be capped to 0)", res.Fee, wantFee)
		}
		if math.Abs(res.PerBlock-(subsidy/float64(voters)+wantFee)) > 1e-9 {
			t.Errorf("PerBlock got %.10f, want %.10f", res.PerBlock, subsidy/float64(voters)+wantFee)
		}
	})
}

// ---------------------------------------------------------------------------
// BlockSSFeeTotals
// ---------------------------------------------------------------------------

// ssfeeStakegenScript is a realistic OP_SSGEN-tagged P2PKH script so the
// (stubbed) tx is shaped like a real SSFee payout output.
var ssfeeStakegenScript = []byte{0xbb, 0x76, 0xa9, 0x14, 0x16, 0xed, 0x35, 0x0c, 0x59, 0xde, 0x7a, 0x50, 0x35, 0x95, 0x2d, 0x19, 0x49, 0xae, 0x15, 0xca, 0xba, 0x18, 0xf0, 0x81, 0x88, 0xac}

func mfMarker() []byte { return []byte{0x6a, 0x06, 0x4d, 0x46, 0x06, 0x12, 0x00, 0x00} }
func sfMarker() []byte {
	return []byte{0x6a, 0x08, 0x53, 0x46, 0x06, 0x12, 0x00, 0x00, 0x00, 0x00}
}

// makeSSFeeTx builds a single-input SSFee-shaped tx. For SKA coin types the
// per-output big amount is set on SKAValue; for VAR it is set on Value only
// (SKAValue left nil) so a test can prove the correct value field is read.
func makeSSFeeTx(ct uint8, in int64, outs []int64, scripts [][]byte) *wire.MsgTx {
	isSKA := cointype.CoinType(ct).IsSKA()
	tx := &wire.MsgTx{}
	vin := &wire.TxIn{ValueIn: in}
	if isSKA {
		vin.SKAValueIn = big.NewInt(in)
	}
	tx.TxIn = append(tx.TxIn, vin)
	for j, ov := range outs {
		out := &wire.TxOut{Value: ov, PkScript: scripts[j], CoinType: cointype.CoinType(ct)}
		if isSKA {
			out.SKAValue = big.NewInt(ov)
		}
		tx.TxOut = append(tx.TxOut, out)
	}
	return tx
}

func ssfeeAll(_ *wire.MsgTx) stake.TxType { return stake.TxTypeSSFee }

func TestBlockSSFeeTotals(t *testing.T) {
	t.Run("empty block returns nil", func(t *testing.T) {
		if got := BlockSSFeeTotals([]*wire.MsgTx{}); got != nil {
			t.Errorf("expected nil, got %v", got)
		}
	})

	t.Run("non-SSFee stake txs are ignored (no false VAR fee)", func(t *testing.T) {
		// Only TxTypeSSFee contributes now; SSGen/SSRtx are subsidy/principal
		// movement and must not be counted as fee.
		tx := makeSSFeeTx(0, 1600000000, []int64{1602300000}, [][]byte{ssfeeStakegenScript})
		got := blockSSFeeTotalsInternal([]*wire.MsgTx{tx}, func(*wire.MsgTx) stake.TxType {
			return stake.TxTypeSSGen
		})
		if got != nil {
			t.Errorf("expected nil (no SSFee tx), got %v", got)
		}
	})

	t.Run("marker-based attribution", func(t *testing.T) {
		tests := []struct {
			name     string
			coinType uint8
			in       int64
			outs     []int64
			scripts  [][]byte
			wantPoW  *big.Int
			wantPoS  *big.Int
		}{
			{
				name: "SKA miner marker (MF) -> PoW", coinType: 1,
				in: 1844000000000000000, outs: []int64{2394000000000000000, 0},
				scripts: [][]byte{ssfeeStakegenScript, mfMarker()},
				wantPoW: big.NewInt(550000000000000000), wantPoS: nil,
			},
			{
				name: "SKA staker marker (SF) -> PoS", coinType: 1,
				in: 1128000000000000000, outs: []int64{1568000000000000000, 0},
				scripts: [][]byte{ssfeeStakegenScript, sfMarker()},
				wantPoW: nil, wantPoS: big.NewInt(440000000000000000),
			},
			{
				name: "no valid marker -> neither", coinType: 1,
				in: 1000, outs: []int64{2000, 0},
				scripts: [][]byte{ssfeeStakegenScript, {0x6a, 0x01, 0x00}},
				wantPoW: nil, wantPoS: nil,
			},
			{
				// Spec: VAR staker fees are delivered via SF SSFee. This is
				// the isolation that the old lumped SSGen net masked.
				name: "VAR staker marker (SF) -> PoS (isolated)", coinType: 0,
				in: 6128216, outs: []int64{6773796, 0},
				scripts: [][]byte{ssfeeStakegenScript, sfMarker()},
				wantPoW: nil, wantPoS: big.NewInt(645580),
			},
			{
				// Negative net (consolidation input > outputs) still flows
				// through — no clamping at this layer.
				name: "SF with negative net is not clamped", coinType: 1,
				in: 1000000000000000000, outs: []int64{400000000000000000, 0},
				scripts: [][]byte{ssfeeStakegenScript, sfMarker()},
				wantPoW: nil, wantPoS: big.NewInt(-600000000000000000),
			},
		}
		for _, tc := range tests {
			t.Run(tc.name, func(t *testing.T) {
				tx := makeSSFeeTx(tc.coinType, tc.in, tc.outs, tc.scripts)
				got := blockSSFeeTotalsInternal([]*wire.MsgTx{tx}, ssfeeAll)
				if got == nil {
					t.Fatal("expected non-nil result")
				}
				split, ok := got[tc.coinType]
				if !ok {
					t.Fatalf("expected coin type %d present", tc.coinType)
				}
				if (split.PoW == nil) != (tc.wantPoW == nil) || (split.PoW != nil && split.PoW.Cmp(tc.wantPoW) != 0) {
					t.Errorf("PoW = %v, want %v", split.PoW, tc.wantPoW)
				}
				if (split.PoS == nil) != (tc.wantPoS == nil) || (split.PoS != nil && split.PoS.Cmp(tc.wantPoS) != 0) {
					t.Errorf("PoS = %v, want %v", split.PoS, tc.wantPoS)
				}
			})
		}
	})

	t.Run("VAR reads Value, not SKAValue", func(t *testing.T) {
		// VAR coin type: SKAValue is intentionally left nil by makeSSFeeTx;
		// the result must come from the int64 Value field.
		tx := makeSSFeeTx(0, 100000000, []int64{150000000, 0},
			[][]byte{ssfeeStakegenScript, sfMarker()})
		got := blockSSFeeTotalsInternal([]*wire.MsgTx{tx}, ssfeeAll)
		split, ok := got[0]
		if !ok || split.PoS == nil {
			t.Fatalf("expected VAR PoS present, got %v", got)
		}
		if split.PoS.Cmp(big.NewInt(50000000)) != 0 {
			t.Errorf("VAR PoS = %v, want 50000000", split.PoS)
		}
	})

	t.Run("multiple SSFee txs aggregate per coin and marker", func(t *testing.T) {
		txs := []*wire.MsgTx{
			makeSSFeeTx(1, 1000000000000000000, []int64{1300000000000000000, 0},
				[][]byte{ssfeeStakegenScript, sfMarker()}), // SKA1 PoS +3e17
			makeSSFeeTx(1, 2000000000000000000, []int64{2500000000000000000, 0},
				[][]byte{ssfeeStakegenScript, sfMarker()}), // SKA1 PoS +5e17
			makeSSFeeTx(1, 1000000000000000000, []int64{1100000000000000000, 0},
				[][]byte{ssfeeStakegenScript, mfMarker()}), // SKA1 PoW +1e17
			makeSSFeeTx(2, 500000000000000000, []int64{900000000000000000, 0},
				[][]byte{ssfeeStakegenScript, sfMarker()}), // SKA2 PoS +4e17
		}
		got := blockSSFeeTotalsInternal(txs, ssfeeAll)
		if got[1].PoS.Cmp(big.NewInt(800000000000000000)) != 0 {
			t.Errorf("SKA1 PoS = %v, want 8e17", got[1].PoS)
		}
		if got[1].PoW.Cmp(big.NewInt(100000000000000000)) != 0 {
			t.Errorf("SKA1 PoW = %v, want 1e17", got[1].PoW)
		}
		if got[2].PoS.Cmp(big.NewInt(400000000000000000)) != 0 {
			t.Errorf("SKA2 PoS = %v, want 4e17", got[2].PoS)
		}
	})
}
