// Copyright (c) 2024, The Monetarium developers
// Use of this source code is governed by an ISC
// license that can be found in the LICENSE file.

package txhelpers

import (
	"math"
	"math/big"
	"strconv"
	"testing"

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
		// 1 SKA coin per 1 VAR coin: skaAtoms=1e18, varAtoms=1e8 → ratio=1.0
		{"1 SKA per 1 VAR", new(big.Int).Exp(big.NewInt(10), big.NewInt(18), nil), 1e8, "1.000000000000000000"},
		// 0.5 SKA per 1 VAR: skaAtoms=5e17, varAtoms=1e8
		{"0.5 SKA per 1 VAR", new(big.Int).SetInt64(5e17), 1e8, "0.500000000000000000"},
		// 2 SKA per 1 VAR: skaAtoms=2e18, varAtoms=1e8
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
			{SSFeeTotalsByCoin: map[uint8]string{1: "100"}},
			{SSFeeTotalsByCoin: map[uint8]string{1: "200"}},
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
			{SSFeeTotalsByCoin: map[uint8]string{1: "100", 2: "200"}},
			{SSFeeTotalsByCoin: map[uint8]string{2: "300", 3: "400"}},
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
			{SSFeeTotalsByCoin: map[uint8]string{}},
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
	// helper: parse atom string back to big.Int for comparison
	mustInt := func(s string) *big.Int {
		v, ok := new(big.Int).SetString(s, 10)
		if !ok {
			t.Fatalf("mustInt: cannot parse %q", s)
		}
		return v
	}

	// rewardPerTicket expressed as SKA coins (not atoms) — matches how
	// explorer.go builds it: totalReward/1e18/TicketsPerBlock.
	oneReward := big.NewFloat(1.0) // 1 SKA coin per ticket

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
			{TicketPrice: "100000000", VoteHeight: 50, PurchaseHeight: 100}, // age <= 0
		}
		got := CalculateAverageTicketAPY(data, oneReward, big.NewFloat(52560))
		if got != "0" {
			t.Errorf("got %q, want \"0\"", got)
		}
	})

	t.Run("result is a valid atom string (parseable as big.Int)", func(t *testing.T) {
		data := []VoteTicketData{
			// ticket price 100 VAR in atoms, held for 144 blocks
			{TicketPrice: "10000000000", VoteHeight: 244, PurchaseHeight: 100},
		}
		got := CalculateAverageTicketAPY(data, oneReward, big.NewFloat(52560))
		if got == "0" || got == "0.000000000000000000" {
			t.Fatalf("expected non-zero result, got %q", got)
		}
		// Must be parseable as a plain integer (atom string, no decimal point)
		v := mustInt(got)
		if v.Sign() <= 0 {
			t.Errorf("expected positive atom value, got %s", got)
		}
	})

	t.Run("decimal ticket price accepted", func(t *testing.T) {
		// Same ticket expressed as a decimal coin string instead of atoms
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
		// A reward so small that avgAPY * 1e18 < 1 atom → should return "0".
		data := []VoteTicketData{
			// ticket price 1e15 VAR atoms (~10 million VAR), age 1e9 blocks
			// APY ≈ 1e-18 * 52560 / 1e9 ≈ 5e-14, * 1e18 ≈ 0.05 → still > 0
			// Use an astronomically large age to force the product below 1 atom.
			{TicketPrice: "100000000000000000000000", VoteHeight: 1_000_000_000, PurchaseHeight: 0},
		}
		tinyReward := new(big.Float).SetFloat64(1e-30) // effectively zero SKA
		got := CalculateAverageTicketAPY(data, tinyReward, big.NewFloat(52560))
		if got != "0" {
			t.Errorf("expected \"0\" for near-zero reward, got %q", got)
		}
	})

	t.Run("average across multiple tickets", func(t *testing.T) {
		// Two tickets with the same price but different ages → average APY
		// should be between the two individual APYs.
		data := []VoteTicketData{
			{TicketPrice: "10000000000", VoteHeight: 200, PurchaseHeight: 100}, // age 100
			{TicketPrice: "10000000000", VoteHeight: 400, PurchaseHeight: 100}, // age 300
		}
		single100 := mustInt(CalculateAverageTicketAPY([]VoteTicketData{data[0]}, oneReward, big.NewFloat(52560)))
		single300 := mustInt(CalculateAverageTicketAPY([]VoteTicketData{data[1]}, oneReward, big.NewFloat(52560)))
		avg := mustInt(CalculateAverageTicketAPY(data, oneReward, big.NewFloat(52560)))

		// avg must be strictly between single300 and single100
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
		// REAL DATA from Block 36354
		// FIXED implementation: feeVAR = totalVARInputs - totalVARReward
		// This equals +3.19483536 VAR (positive because inputs > outputs)
		// ComputeVoteVARReward should now calculate the correct positive fee.
		// Fee per vote = 3.19483536 / 5 = 0.638967072 VAR
		latestVarFee := 3.19483536
		voters := int64(5)
		subsidy := 16.0
		voteData := []VoteTicketData{}

		res := ComputeVoteVARReward(latestVarFee, voteData, params, voters, subsidy)

		// The CORRECT fee per vote for this block is approximately 0.638967072 VAR.
		// We expect the fee to be non-zero. Current implementation caps at 0, so this should fail.
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
		got := BlockSSFeeTotals(nil, nil)
		if got != nil {
			t.Errorf("expected nil, got %v", got)
		}
	})

	t.Run("SSGen block with fees", func(t *testing.T) {
		// Mock a block with one SSGen transaction
		// VAR Output: 16.023 VAR
		// VAR Input: 16 VAR
		// Fee: 0.023 VAR
		ssGenTxs := []TxFeeData{
			{
				TotalVAROutputs: 1602300000,
				TotalInputs:     1600000000,
				IsSSGen:         true,
				TxType:          int(stake.TxTypeSSGen),
			},
		}
		sTxs := []*wire.MsgTx{} // No SSTX for this case

		got := BlockSSFeeTotals(ssGenTxs, sTxs)
		if got == nil {
			t.Fatal("expected non-nil result")
		}

		varFee, ok := got[uint8(cointype.CoinTypeVAR)]
		if !ok {
			t.Fatal("expected VAR fee to be present")
		}

		want := "2300000"
		if varFee != want {
			t.Errorf("got %q, want %q", varFee, want)
		}
	})

	t.Run("Realistic Block 36354", func(t *testing.T) {
		// Block 36354 Data:
		// Voters: 5, Block PoS Subsidy: 16 VAR
		// Expected Subsidy per vote: 16 / 5 = 3.2 VAR

		// We use exact atom values to avoid floating point precision issues.
		ssGenTxsData := []struct {
			id              string
			totalVAROutputs int64
			totalInputs     int64
		}{
			{"14e5e8...", 32343931486, 32343931486},
			{"3fc72a...", 33432143993, 33432143993},
			{"08e899...", 34347582202, 34347582202},
			{"faaaf0...", 34347582202, 34347582202},
			{"635a47...", 34432652413, 34432652413},
			{"a833ab...", 34243875060, 34564004176}, // Out: 342.43875060, In: 3.2 + 342.44004176 = 345.64004176
			{"87579e...", 6773796, 6128216},         // Out: 0.06773796, In: 0.06128216
		}

		var ssGenTxs []TxFeeData
		for _, data := range ssGenTxsData {
			ssGenTxs = append(ssGenTxs, TxFeeData{
				TotalVAROutputs: data.totalVAROutputs,
				TotalInputs:     data.totalInputs,
				IsSSGen:         true,
				TxType:          int(stake.TxTypeSSGen),
			})
		}

		// Add some SSTX transactions to make it realistic (should be ignored by BlockSSFeeTotals VAR logic)
		sTxs := []*wire.MsgTx{
			{
				TxOut: []*wire.TxOut{
					{
						CoinType: cointype.CoinTypeVAR,
						Value:    100 * 1e8,
						PkScript: []byte{0x01},
					},
				},
			},
		}

		got := BlockSSFeeTotals(ssGenTxs, sTxs)
		if got == nil {
			t.Fatal("expected non-nil result")
		}

		varFee, ok := got[uint8(cointype.CoinTypeVAR)]
		if !ok {
			t.Fatal("expected VAR fee to be present")
		}

		// Calculation with new formula (Outputs - Inputs):
		// Tx1-5: 0
		// Tx6: 34243875060 - 34564004176 = -320129116 (consolidation cost)
		// Tx7: 6773796 - 6128216 = 645580 (fee earned)
		// Total = -320129116 + 645580 = -319483536

		want := "-319483536"
		if varFee != want {
			t.Errorf("got %q, want %q", varFee, want)
		}
	})
}

// ---------------------------------------------------------------------------
// Full Pipeline Integration Test
// ---------------------------------------------------------------------------

// TestFullPipelineSSGenReward tests the complete data flow from a block containing
// SSGen transactions to the final VoteVARReward calculation.
// This test verifies that the entire pipeline correctly computes fees.
func TestFullPipelineSSGenReward(t *testing.T) {
	params := &chaincfg.Params{
		TargetTimePerBlock: 15 * 60 * 1e9,
		CoinbaseMaturity:   100,
	}

	// Construct a minimal MsgBlock that mimics Block 36354 structure:
	// - 1 coinbase transaction (regular tx)
	// - 5 SSGen transactions (stake txs) where Inputs == Outputs (pure reward distribution)
	// - 1 SSGen transaction where Inputs > Outputs (consolidation)
	// - 1 SSGen transaction where Inputs < Outputs (fee generation)
	//
	// Total VAR Inputs = 16 + consolidation + fee generation
	// Total VAR Outputs = reward distribution
	// Expected Fee = Inputs - Outputs = positive value

	// Create SSGen transactions (simplified for test)
	// Using real atom values from Block 36354
	ssGenTxs := []TxFeeData{
		// Tx1-5: Inputs == Outputs (pure reward, no net fee)
		{TotalVAROutputs: 32343931486, TotalInputs: 32343931486, IsSSGen: true, TxType: int(stake.TxTypeSSGen)}, // 323.43931486 VAR
		{TotalVAROutputs: 33432143993, TotalInputs: 33432143993, IsSSGen: true, TxType: int(stake.TxTypeSSGen)}, // 334.32143993 VAR
		{TotalVAROutputs: 34347582202, TotalInputs: 34347582202, IsSSGen: true, TxType: int(stake.TxTypeSSGen)}, // 343.47582202 VAR
		{TotalVAROutputs: 34347582202, TotalInputs: 34347582202, IsSSGen: true, TxType: int(stake.TxTypeSSGen)}, // 343.47582202 VAR
		{TotalVAROutputs: 34432652413, TotalInputs: 34432652413, IsSSGen: true, TxType: int(stake.TxTypeSSGen)}, // 344.32652413 VAR
		// Tx6: Inputs > Outputs (consolidation, negative contribution)
		{TotalVAROutputs: 34243875060, TotalInputs: 34564004176, IsSSGen: true, TxType: int(stake.TxTypeSSGen)}, // In: 345.64004176, Out: 342.43875060
		// Tx7: Inputs < Outputs (fee generation, positive contribution)
		{TotalVAROutputs: 6773796, TotalInputs: 6128216, IsSSGen: true, TxType: int(stake.TxTypeSSGen)}, // In: 0.06128216, Out: 0.06773796
	}

	// Run BlockSSFeeTotals
	sTxs := []*wire.MsgTx{} // No SSTx in this simplified test
	ssFeeTotals := BlockSSFeeTotals(ssGenTxs, sTxs)

	if ssFeeTotals == nil {
		t.Fatal("BlockSSFeeTotals returned nil")
	}

	varFeeStr, ok := ssFeeTotals[uint8(cointype.CoinTypeVAR)]
	if !ok {
		t.Fatal("VAR fee not found in SSFeeTotals")
	}

	varFee, err := strconv.ParseInt(varFeeStr, 10, 64)
	if err != nil {
		t.Fatalf("failed to parse VAR fee: %v", err)
	}

	// Expected: -319483536 atoms (new formula: Outputs - Inputs)
	// Block 36354 had more consolidation cost than fee, so net is negative
	// Negative fees get capped to 0 in ComputeVoteVARReward
	expectedFee := int64(-319483536)
	if varFee != expectedFee {
		t.Errorf("BlockSSFeeTotals: got %d, want %d", varFee, expectedFee)
	}

	// Now test the full pipeline: ComputeVoteVARReward
	latestVarFee := float64(varFee) / 1e8 // Convert atoms to VAR
	voters := int64(5)
	subsidy := 16.0 // Total PoS subsidy for block

	voteData := []VoteTicketData{}
	result := ComputeVoteVARReward(latestVarFee, voteData, params, voters, subsidy)

	// Negative fee gets capped to 0
	expectedFeePerVote := 0.0
	if math.Abs(result.Fee-expectedFeePerVote) > 0.0001 {
		t.Errorf("ComputeVoteVARReward Fee: got %.8f, want %.8f", result.Fee, expectedFeePerVote)
	}

	// Expected total reward per vote: Subsidy + Fee = 3.2 + 0 = 3.2 (fee is capped to 0)
	expectedTotalPerVote := 3.2
	if math.Abs(result.PerBlock-expectedTotalPerVote) > 0.0001 {
		t.Errorf("ComputeVoteVARReward PerBlock: got %.8f, want %.8f", result.PerBlock, expectedTotalPerVote)
	}

	t.Logf("Full Pipeline Result: Subsidy=%.8f, Fee=%.8f, Total=%.8f", result.Subsidy, result.Fee, result.PerBlock)
}

// ---------------------------------------------------------------------------
// Negative Fee Scenario Tests
// ---------------------------------------------------------------------------

// TestComputeVoteVARReward_NegativeFee verifies that negative fees are capped to 0
// and logged as an error. This happens when net transaction fees are negative
// (consolidation inputs > outputs).
func TestComputeVoteVARReward_NegativeFee(t *testing.T) {
	params := &chaincfg.Params{
		TargetTimePerBlock: 15 * 60 * 1e9,
		CoinbaseMaturity:   100,
	}

	// Block 36540 scenario: net fee is negative (-614520 atoms)
	// because one SSGen transaction had more consolidation inputs than outputs
	latestVarFee := -0.00614520 // -614520 atoms = -0.00614520 VAR
	voters := int64(5)
	subsidy := 16.0
	voteData := []VoteTicketData{}

	result := ComputeVoteVARReward(latestVarFee, voteData, params, voters, subsidy)

	// Negative fees should be capped to 0 (no fee reward this block)
	if result.Fee != 0 {
		t.Errorf("Expected Fee=0 for negative input, got %.8f", result.Fee)
	}
}

// ---------------------------------------------------------------------------
// SSRtx (Stake Reward Transaction) Tests
// ---------------------------------------------------------------------------

// TestBlockSSFeeTotals_WithSSRtx verifies that SSRtx transactions are included
// in the fee calculation. SSRtx (type=7) is the return of ticket principal
// when a ticket misses its vote, and can generate positive net fees.
func TestBlockSSFeeTotals_WithSSRtx(t *testing.T) {
	t.Run("SSRtx block with positive net", func(t *testing.T) {
		// Block 36588 SSRtx: Input=0, Output=0.00942284 VAR
		// Net = Outputs - Inputs = 942284 - 0 = +942284 atoms
		ssGenTxs := []TxFeeData{
			{
				TotalVAROutputs: 942284,
				TotalInputs:     0,
				IsSSGen:         false,
				TxType:          int(stake.TxTypeSSRtx), // 3
			},
		}
		sTxs := []*wire.MsgTx{}

		got := BlockSSFeeTotals(ssGenTxs, sTxs)
		if got == nil {
			t.Fatal("expected non-nil result")
		}

		varFee, ok := got[uint8(cointype.CoinTypeVAR)]
		if !ok {
			t.Fatal("expected VAR fee to be present")
		}

		// Net = Outputs - Inputs = 942284 - 0 = 942284
		want := "942284"
		if varFee != want {
			t.Errorf("got %q, want %q", varFee, want)
		}
	})

	t.Run("SSGen and SSRtx combined", func(t *testing.T) {
		// Block 515d6948... scenario:
		// - 5 SSGen transactions all with net = 0
		// - 1 SSRtx with net = +407785 atoms (0.00407785 VAR)
		ssGenTxs := []TxFeeData{
			// SSGen transactions (all net = 0)
			{TotalVAROutputs: 33128317493, TotalInputs: 33128317493, IsSSGen: true, TxType: int(stake.TxTypeSSGen)},
			{TotalVAROutputs: 33432143993, TotalInputs: 33432143993, IsSSGen: true, TxType: int(stake.TxTypeSSGen)},
			{TotalVAROutputs: 34262720389, TotalInputs: 34262720389, IsSSGen: true, TxType: int(stake.TxTypeSSGen)},
			{TotalVAROutputs: 34563875060, TotalInputs: 34563875060, IsSSGen: true, TxType: int(stake.TxTypeSSGen)},
			{TotalVAROutputs: 34563875060, TotalInputs: 34563875060, IsSSGen: true, TxType: int(stake.TxTypeSSGen)},
			// SSRtx (positive net)
			{TotalVAROutputs: 2705062, TotalInputs: 2297277, IsSSGen: false, TxType: int(stake.TxTypeSSRtx)},
		}
		sTxs := []*wire.MsgTx{}

		got := BlockSSFeeTotals(ssGenTxs, sTxs)
		if got == nil {
			t.Fatal("expected non-nil result")
		}

		varFee, ok := got[uint8(cointype.CoinTypeVAR)]
		if !ok {
			t.Fatal("expected VAR fee to be present")
		}

		// Total net = SSGen (0) + SSRtx (2705062 - 2297277) = 407785
		want := "407785"
		if varFee != want {
			t.Errorf("got %q, want %q", varFee, want)
		}
	})

	t.Run("SSRtx negative net (ticket price returned)", func(t *testing.T) {
		// If SSRtx input > output (e.g., ticket revoked), net is negative
		// Net = Outputs - Inputs = 0 - 100000000 = -100000000
		ssGenTxs := []TxFeeData{
			{
				TotalVAROutputs: 0,
				TotalInputs:     100000000,
				IsSSGen:         false,
				TxType:          int(stake.TxTypeSSRtx), // 3
			},
		}
		sTxs := []*wire.MsgTx{}

		got := BlockSSFeeTotals(ssGenTxs, sTxs)
		if got == nil {
			t.Fatal("expected non-nil result")
		}

		varFee, ok := got[uint8(cointype.CoinTypeVAR)]
		if !ok {
			t.Fatal("expected VAR fee to be present")
		}

		// Net = Outputs - Inputs = 0 - 100000000 = -100000000
		want := "-100000000"
		if varFee != want {
			t.Errorf("got %q, want %q", varFee, want)
		}
	})
}

// TestFullPipelineWithSSRtx tests the complete pipeline with both SSGen and SSRtx.
func TestFullPipelineWithSSRtx(t *testing.T) {
	params := &chaincfg.Params{
		TargetTimePerBlock: 15 * 60 * 1e9,
		CoinbaseMaturity:   100,
	}

	// Block 36588 scenario:
	// - 5 SSGen transactions (all net = 0)
	// - 1 SSRtx with net = +942284 atoms (0.00942284 VAR)
	// Total fee = 942284 atoms = 0.00942284 VAR
	// Fee per vote = 0.00942284 / 5 = 0.001884568 VAR
	ssGenTxs := []TxFeeData{
		// 5 SSGen transactions with net = 0
		{TotalVAROutputs: 33159868797, TotalInputs: 33159868797, IsSSGen: true, TxType: int(stake.TxTypeSSGen)},
		{TotalVAROutputs: 34028720786, TotalInputs: 34028720786, IsSSGen: true, TxType: int(stake.TxTypeSSGen)},
		{TotalVAROutputs: 34262720389, TotalInputs: 34262720389, IsSSGen: true, TxType: int(stake.TxTypeSSGen)},
		{TotalVAROutputs: 34432652413, TotalInputs: 34432652413, IsSSGen: true, TxType: int(stake.TxTypeSSGen)},
		{TotalVAROutputs: 34563875060, TotalInputs: 34563875060, IsSSGen: true, TxType: int(stake.TxTypeSSGen)},
		// 1 SSRtx with positive net
		{TotalVAROutputs: 942284, TotalInputs: 0, IsSSGen: false, TxType: int(stake.TxTypeSSRtx)},
	}

	sTxs := []*wire.MsgTx{}
	ssFeeTotals := BlockSSFeeTotals(ssGenTxs, sTxs)

	if ssFeeTotals == nil {
		t.Fatal("BlockSSFeeTotals returned nil")
	}

	varFeeStr, ok := ssFeeTotals[uint8(cointype.CoinTypeVAR)]
	if !ok {
		t.Fatal("VAR fee not found in SSFeeTotals")
	}

	varFee, err := strconv.ParseInt(varFeeStr, 10, 64)
	if err != nil {
		t.Fatalf("failed to parse VAR fee: %v", err)
	}

	// Expected: 942284 atoms (from SSRtx net)
	expectedFee := int64(942284)
	if varFee != expectedFee {
		t.Errorf("BlockSSFeeTotals: got %d, want %d", varFee, expectedFee)
	}

	// Now test ComputeVoteVARReward
	latestVarFee := float64(varFee) / 1e8
	voters := int64(5)
	subsidy := 16.0

	voteData := []VoteTicketData{}
	result := ComputeVoteVARReward(latestVarFee, voteData, params, voters, subsidy)

	// Expected fee per vote: 942284 / 5 / 1e8 = 0.001884568 VAR
	expectedFeePerVote := 0.001884568
	if math.Abs(result.Fee-expectedFeePerVote) > 0.0001 {
		t.Errorf("ComputeVoteVARReward Fee: got %.8f, want %.8f", result.Fee, expectedFeePerVote)
	}

	// Expected total per vote: Subsidy + Fee = 3.2 + 0.001884568 = 3.201884568
	expectedTotalPerVote := 3.201884568
	if math.Abs(result.PerBlock-expectedTotalPerVote) > 0.0001 {
		t.Errorf("ComputeVoteVARReward PerBlock: got %.8f, want %.8f", result.PerBlock, expectedTotalPerVote)
	}

	t.Logf("Full Pipeline with SSRtx Result: Subsidy=%.8f, Fee=%.8f, Total=%.8f", result.Subsidy, result.Fee, result.PerBlock)
}

// ---------------------------------------------------------------------------
// Type=7 (Misclassified SSRtx / SSFee) Tests
// ---------------------------------------------------------------------------

// TestBlockSSFeeTotals_WithType7 verifies that type=7 (misclassified SSRtx)
// transactions are included in the fee calculation.
// These are ticket return transactions that stake.DetermineTxType classifies as SSFee (type=7).
func TestBlockSSFeeTotals_WithType7(t *testing.T) {
	t.Run("Block 36600 type=7 transaction", func(t *testing.T) {
		// Block 36600 transaction 231f35c3dc31...:
		// Input: 0.0098299 VAR (982990 atoms)
		// Output: 0.01387618 VAR (1387618 atoms)
		// Net = Outputs - Inputs = 1387618 - 982990 = 404628 atoms (positive!)
		ssGenTxs := []TxFeeData{
			// 5 SSGen transactions (all net = 0)
			{TotalVAROutputs: 33470355201, TotalInputs: 33470355201, IsSSGen: true, TxType: int(stake.TxTypeSSGen)},
			{TotalVAROutputs: 33470355201, TotalInputs: 33470355201, IsSSGen: true, TxType: int(stake.TxTypeSSGen)},
			{TotalVAROutputs: 33559617174, TotalInputs: 33559617174, IsSSGen: true, TxType: int(stake.TxTypeSSGen)},
			{TotalVAROutputs: 33559617174, TotalInputs: 33559617174, IsSSGen: true, TxType: int(stake.TxTypeSSGen)},
			{TotalVAROutputs: 34590261953, TotalInputs: 34590261953, IsSSGen: true, TxType: int(stake.TxTypeSSGen)},
			// 1 type=7 transaction (misclassified SSRtx) with positive net
			{TotalVAROutputs: 1387618, TotalInputs: 982990, IsSSGen: false, TxType: int(stake.TxTypeSSFee)},
		}
		sTxs := []*wire.MsgTx{}

		got := BlockSSFeeTotals(ssGenTxs, sTxs)
		if got == nil {
			t.Fatal("expected non-nil result")
		}

		varFee, ok := got[uint8(cointype.CoinTypeVAR)]
		if !ok {
			t.Fatal("expected VAR fee to be present")
		}

		// Total net = 5 × 0 + 404628 = 404628
		want := "404628"
		if varFee != want {
			t.Errorf("got %q, want %q", varFee, want)
		}
	})

	t.Run("type=7 with negative net", func(t *testing.T) {
		// If type=7 input > output, net is negative
		ssGenTxs := []TxFeeData{
			{
				TotalVAROutputs: 50000000,
				TotalInputs:     100000000,
				IsSSGen:         false,
				TxType:          7, // type=7 (SSFee/misclassified SSRtx)
			},
		}
		sTxs := []*wire.MsgTx{}

		got := BlockSSFeeTotals(ssGenTxs, sTxs)
		if got == nil {
			t.Fatal("expected non-nil result")
		}

		varFee, ok := got[uint8(cointype.CoinTypeVAR)]
		if !ok {
			t.Fatal("expected VAR fee to be present")
		}

		// Net = Outputs - Inputs = 50000000 - 100000000 = -50000000
		want := "-50000000"
		if varFee != want {
			t.Errorf("got %q, want %q", varFee, want)
		}
	})
}

// TestFullPipelineWithType7 tests the complete pipeline with type=7 transactions.
func TestFullPipelineWithType7(t *testing.T) {
	params := &chaincfg.Params{
		TargetTimePerBlock: 15 * 60 * 1e9,
		CoinbaseMaturity:   100,
	}

	// Block 36600 scenario:
	// - 5 SSGen transactions (all net = 0)
	// - 1 type=7 transaction with net = +404628 atoms (0.00404628 VAR)
	// Total fee = 404628 atoms = 0.00404628 VAR
	// Fee per vote = 0.00404628 / 5 = 0.000809256 VAR
	ssGenTxs := []TxFeeData{
		{TotalVAROutputs: 33470355201, TotalInputs: 33470355201, IsSSGen: true, TxType: int(stake.TxTypeSSGen)},
		{TotalVAROutputs: 33470355201, TotalInputs: 33470355201, IsSSGen: true, TxType: int(stake.TxTypeSSGen)},
		{TotalVAROutputs: 33559617174, TotalInputs: 33559617174, IsSSGen: true, TxType: int(stake.TxTypeSSGen)},
		{TotalVAROutputs: 33559617174, TotalInputs: 33559617174, IsSSGen: true, TxType: int(stake.TxTypeSSGen)},
		{TotalVAROutputs: 34590261953, TotalInputs: 34590261953, IsSSGen: true, TxType: int(stake.TxTypeSSGen)},
		// type=7 with positive net
		{TotalVAROutputs: 1387618, TotalInputs: 982990, IsSSGen: false, TxType: int(stake.TxTypeSSFee)},
	}

	sTxs := []*wire.MsgTx{}
	ssFeeTotals := BlockSSFeeTotals(ssGenTxs, sTxs)

	if ssFeeTotals == nil {
		t.Fatal("BlockSSFeeTotals returned nil")
	}

	varFeeStr, ok := ssFeeTotals[uint8(cointype.CoinTypeVAR)]
	if !ok {
		t.Fatal("VAR fee not found in SSFeeTotals")
	}

	varFee, err := strconv.ParseInt(varFeeStr, 10, 64)
	if err != nil {
		t.Fatalf("failed to parse VAR fee: %v", err)
	}

	// Expected: 404628 atoms (from type=7 net)
	expectedFee := int64(404628)
	if varFee != expectedFee {
		t.Errorf("BlockSSFeeTotals: got %d, want %d", varFee, expectedFee)
	}

	// Now test ComputeVoteVARReward
	latestVarFee := float64(varFee) / 1e8
	voters := int64(5)
	subsidy := 16.0

	voteData := []VoteTicketData{}
	result := ComputeVoteVARReward(latestVarFee, voteData, params, voters, subsidy)

	// Expected fee per vote: 404628 / 5 / 1e8 = 0.000809256 VAR
	expectedFeePerVote := 0.000809256
	if math.Abs(result.Fee-expectedFeePerVote) > 0.0001 {
		t.Errorf("ComputeVoteVARReward Fee: got %.8f, want %.8f", result.Fee, expectedFeePerVote)
	}

	// Expected total per vote: Subsidy + Fee = 3.2 + 0.000809256 = 3.200809256
	expectedTotalPerVote := 3.200809256
	if math.Abs(result.PerBlock-expectedTotalPerVote) > 0.0001 {
		t.Errorf("ComputeVoteVARReward PerBlock: got %.8f, want %.8f", result.PerBlock, expectedTotalPerVote)
	}

	t.Logf("Full Pipeline with Type7 Result: Subsidy=%.8f, Fee=%.8f, Total=%.8f", result.Subsidy, result.Fee, result.PerBlock)
}
