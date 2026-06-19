package types

import (
	"reflect"
	"testing"
	"time"

	"github.com/monetarium/monetarium-node/chaincfg"
	chainjson "github.com/monetarium/monetarium-node/rpc/jsonrpc/types"
)

func TestTimeDefMarshal(t *testing.T) {
	tref := time.Unix(1548363687, 0)
	trefJSON := `"` + tref.Format(timeDefFmtJS) + `"`

	timedef := &TimeDef{
		T: tref,
	}
	jsonTime, err := timedef.MarshalJSON()
	if err != nil {
		t.Errorf("MarshalJSON failed: %v", err)
	}

	if string(jsonTime) != trefJSON {
		t.Errorf("expected %s, got %s", trefJSON, string(jsonTime))
	}
}

func TestTimeDefUnmarshal(t *testing.T) {
	tref := time.Unix(1548363687, 0).UTC()
	trefJSON := tref.Format(timeDefFmtJS)

	timedef := new(TimeDef)
	err := timedef.UnmarshalJSON([]byte(trefJSON))
	if err != nil {
		t.Errorf("UnmarshalJSON failed: %v", err)
	}

	if timedef.T != tref {
		t.Errorf("expected %v, got %v", tref, timedef.T)
	}
}

func TestDeepCopys(t *testing.T) {
	tickets := []MempoolTx{
		{
			TxID:      "96e10d7ce108b1a357168b0a923d86d2744ba9777a2d81cbff71ffb982381c95",
			Version:   1,
			Fees:      0.0001,
			VinCount:  2,
			VoutCount: 5,
			Vin: []MempoolInput{
				{
					TxId:   "43f26841e744ce2f901e21400f275eda27ba2a3fa962110d52e7dd37f2193c78",
					Index:  0,
					Outdex: 0,
				},
				{
					TxId:   "43f26841e744ce2f901e21400f275eda27ba2a3fa962110d52e7dd37f2193c78",
					Index:  1,
					Outdex: 1,
				},
			},
			Hash:     "96e10d7ce108b1a357168b0a923d86d2744ba9777a2d81cbff71ffb982381c95",
			Size:     539,
			TotalOut: 106.39717461,
			Type:     "Ticket",
		},
		{
			TxID:      "8eb2f6c8f3a9cdc8d6de2ef3bfca9efcffed4484dd4fde2d01dc0fc0e415c75a",
			Version:   2,
			Fees:      0.0001,
			VinCount:  2,
			VoutCount: 5,
			Vin: []MempoolInput{
				{
					TxId:   "4e9221f790916b4d891b40ef82b8a6dc89f5c0719d5d5ddcf46ac3673d8446aa",
					Index:  0,
					Outdex: 0,
				},
				{
					TxId:   "4e9221f790916b4d891b40ef82b8a6dc89f5c0719d5d5ddcf46ac3673d8446aa",
					Index:  1,
					Outdex: 1,
				},
			},
			Hash:     "8eb2f6c8f3a9cdc8d6de2ef3bfca9efcffed4484dd4fde2d01dc0fc0e415c75a",
			Size:     538,
			TotalOut: 106.39717461,
			Type:     "Ticket",
		},
	}

	votes := []MempoolTx{
		{
			TxID:      "64ce0422cb6ba1aefa63c8df1d872250d181261ff3acd5a71bc1f521096207c9",
			Fees:      0,
			VinCount:  2,
			VoutCount: 3,
			Vin: []MempoolInput{
				{
					TxId:   "",
					Index:  0,
					Outdex: 0,
				},
				{
					TxId:   "7884ecd8fb5934e77708f82f0aa052ad86cccc5749602be14d93745d8272538e",
					Index:  1,
					Outdex: 0,
				},
			},
			Hash:     "64ce0422cb6ba1aefa63c8df1d872250d181261ff3acd5a71bc1f521096207c9",
			Size:     344,
			TotalOut: 102.86278351,
			Type:     "Vote",
		},
		{
			TxID:      "07aa38f10fe1a849a52b9d4812081854e4ac7268751a0ea661e8f499d7de91f1",
			Fees:      0,
			VinCount:  2,
			VoutCount: 3,
			Vin: []MempoolInput{
				{
					TxId:   "",
					Index:  0,
					Outdex: 0,
				},
				{
					TxId:   "99045541c481e7e694598a2d77967f5e4e053cee3265d77c5b49f1eb8b282176",
					Index:  1,
					Outdex: 0,
				},
			},
			Hash:     "07aa38f10fe1a849a52b9d4812081854e4ac7268751a0ea661e8f499d7de91f1",
			Size:     345,
			TotalOut: 105.29923146,
			Type:     "Vote",
		},
		{
			TxID:      "1df658e1b0de08112adcfb9b8b17dcc2b64f756b1e21f6b1f715fd2b86439955",
			Fees:      0,
			VinCount:  2,
			VoutCount: 3,
			Vin: []MempoolInput{
				{
					TxId:   "",
					Index:  0,
					Outdex: 0,
				},
				{
					TxId:   "28cc0b43bf79908115323f16dbd17d0e44a5366ca5d49e2d4f5a9c5f741e5699",
					Index:  1,
					Outdex: 0,
				},
			},
			Hash:     "1df658e1b0de08112adcfb9b8b17dcc2b64f756b1e21f6b1f715fd2b86439955",
			Size:     345,
			TotalOut: 111.28226529,
			Type:     "Vote",
		},
	}

	regular := []MempoolTx{
		{
			TxID:      "0572b2d121322d3a9b20fe5d5024c73d8bb817398948a167ddb668e52bbb21f6",
			Fees:      0.000585,
			VinCount:  3,
			VoutCount: 2,
			Vin: []MempoolInput{
				{
					TxId:   "4a9aaca49784586d3abc0dbd5d7d3dcdf70940c60bc5cbaa39379690d9ac5c6d",
					Index:  0,
					Outdex: 9,
				},
				{
					TxId:   "f621d45fb440307f151c1470619e37209aca7f8c12379e82f5c2ebcf882fb884",
					Index:  1,
					Outdex: 1,
				},
				{
					TxId:   "08b01afd1c252fbef8bbad933c1d7e3da1d3e3011ef3d4cdd532f5803ea173b9",
					Index:  2,
					Outdex: 0,
				},
			},
			Hash:     "0572b2d121322d3a9b20fe5d5024c73d8bb817398948a167ddb668e52bbb21f6",
			Size:     581,
			TotalOut: 139.11389736,
			Type:     "Regular",
		},
		{
			TxID:      "9e11deaae5ecd1d3288468a491f820b66adfb74be70eba582c0b13a25e76bb3b",
			Fees:      0.000585,
			VinCount:  3,
			VoutCount: 2,
			Vin: []MempoolInput{
				{
					TxId:   "bf9d371a9f3fd510ec5d6b485c0fd64ca1b6dac9c3b915973ba8fc86fc788e8c",
					Index:  0,
					Outdex: 1,
				},
				{
					TxId:   "a245d62d3916869f930afd80dce6f47c7291145c36fccae7ba73c0e462ff4cd5",
					Index:  1,
					Outdex: 1,
				},
				{
					TxId:   "b8274d92cac36a08cc28600fec66a09e9d429486506da1c8616c93544ce0f2ee",
					Index:  2,
					Outdex: 2,
				},
			},
			Hash:     "9e11deaae5ecd1d3288468a491f820b66adfb74be70eba582c0b13a25e76bb3b",
			Size:     580,
			TotalOut: 204.94920773,
			Type:     "Regular",
		},
	}

	allTxns := regular
	allTxns = append(allTxns, votes...)
	allTxns = append(allTxns, tickets...)

	allCopy := CopyMempoolTxSlice(allTxns)
	if !reflect.DeepEqual(allTxns, allCopy) {
		t.Errorf("MempoolTx slices not equal: %v\n\n%v\n", allTxns, allCopy)
	}

	latest := regular
	latest = append(latest, tickets...)
	latest = append(latest, votes[0])

	invRegular := make(map[string]struct{}, len(regular))
	for i := range regular {
		invRegular[regular[i].TxID] = struct{}{}
	}

	invStake := make(map[string]struct{}, len(votes)+len(tickets))
	for i := range votes {
		invStake[votes[i].TxID] = struct{}{}
	}
	for i := range tickets {
		invStake[tickets[i].TxID] = struct{}{}
	}

	mps := &MempoolShort{
		LastBlockHash:      "000000000000000043a1e65fe3309ab5b2a0f4fb3e46036bbee2be6294790c98",
		LastBlockHeight:    310278,
		LastBlockTime:      1547677417,
		FormattedBlockTime: (TimeDef{T: time.Unix(1547677417, 0)}).String(),
		Time:               1547677417 + 1e5,
		TotalOut:           1292.76211530,
		TotalSize:          2479,
		NumTickets:         2,
		NumVotes:           3,
		NumRegular:         2,
		NumRevokes:         0,
		NumAll:             7,
		LikelyMineable: LikelyMineable{
			Total:         1292.76211530,
			Size:          2479,
			FormattedSize: "134134 B",
			RegularTotal:  200.52,
			TicketTotal:   100.86,
			VoteTotal:     300.45,
			RevokeTotal:   0,
			Count:         7,
		},
		LatestTransactions: latest,
		FormattedTotalSize: "134134 B",
		TicketIndexes: BlockValidatorIndex{
			"00000000000000003b6e0e24c75575911edabbbae181fc6e8e686c6aadcc2ce2": TicketIndex{
				"28cc0b43bf79908115323f16dbd17d0e44a5366ca5d49e2d4f5a9c5f741e5699": 0,
				"0969ba6af7da6b63b122e0c9d57e743397ca0bc0ad39ca1927422db0e70ec19b": 1,
				"99045541c481e7e694598a2d77967f5e4e053cee3265d77c5b49f1eb8b282176": 2,
				"a5f35e94af7945f06adba39598faa4c65d9063fc1c4e7d502eb349c924364a10": 3,
				"7884ecd8fb5934e77708f82f0aa052ad86cccc5749602be14d93745d8272538e": 4,
			},
		},
		VotingInfo: VotingInfo{
			TicketsVoted:     3,
			MaxVotesPerBlock: 5,
			VotedTickets: map[string]bool{
				"7884ecd8fb5934e77708f82f0aa052ad86cccc5749602be14d93745d8272538e": true,
				"28cc0b43bf79908115323f16dbd17d0e44a5366ca5d49e2d4f5a9c5f741e5699": true,
				"99045541c481e7e694598a2d77967f5e4e053cee3265d77c5b49f1eb8b282176": false,
			},
			VoteTallys: map[string]*VoteTally{
				"de563e0f0ee0f4717c553ce456fa5ff37c784e3f52059f2e3e64ddfbcf2aaffb": {
					TicketsPerBlock: 5,
					Marks:           []bool{true, true, true, true, true},
				},
			},
		},
		InvRegular: invRegular,
		InvStake:   invStake,
	}

	mps2 := mps.DeepCopy()

	if !reflect.DeepEqual(*mps, *mps2) {
		t.Errorf("MempoolShort structs not equal: %v\n\n%v\n", *mps, *mps2)
	}

	mpi := &MempoolInfo{
		MempoolShort: *mps,
		Transactions: regular,
		Tickets:      tickets,
		Votes:        votes,
		Revocations:  nil,
	}

	mpi2 := mpi.DeepCopy()

	if !reflect.DeepEqual(mpi.MempoolShort, mpi2.MempoolShort) {
		t.Errorf("MempoolShort structs not equal: %v\n\n%v\n", *mps, *mps2)
	}
	if !reflect.DeepEqual(mpi.Transactions, mpi2.Transactions) {
		t.Errorf("Transactions slices not equal: %v\n\n%v\n", *mps, *mps2)
	}
	if !reflect.DeepEqual(mpi.Tickets, mpi2.Tickets) {
		t.Errorf("Tickets slices not equal: %v\n\n%v\n", *mps, *mps2)
	}
	if !reflect.DeepEqual(mpi.Votes, mpi2.Votes) {
		t.Errorf("Votes slices not equal: %v\n\n%v\n", *mps, *mps2)
	}
	if !reflect.DeepEqual(mpi.Revocations, mpi2.Revocations) {
		t.Errorf("Revocations slices not equal: %v\n\n%v\n", *mps, *mps2)
	}
}

func TestFlattenCoinRows(t *testing.T) {
	tests := []struct {
		name                 string
		coinRows             []CoinRowData
		voters               uint16
		freshStake           uint8
		revocations          uint32
		wantVARAmount        string
		wantVARTxCount       int
		wantSKAAmount        string
		wantSKASubRowsLen    int
		wantSKAActiveSubRows int
	}{
		{
			name:                 "VAR only",
			coinRows:             []CoinRowData{{CoinType: 0, Symbol: "VAR", TxCount: 5, Amount: "100000000", Size: 200}},
			wantVARAmount:        "100000000",
			wantVARTxCount:       5,
			wantSKAAmount:        "",
			wantSKASubRowsLen:    0,
			wantSKAActiveSubRows: 0,
		},
		{
			name: "VAR + single SKA with txs",
			coinRows: []CoinRowData{
				{CoinType: 0, Symbol: "VAR", TxCount: 3, Amount: "100000000", Size: 200},
				{CoinType: 1, Symbol: "SKA1", TxCount: 1, Amount: "1000000000000000000", Size: 100},
			},
			wantVARAmount:        "100000000",
			wantVARTxCount:       3,
			wantSKAAmount:        "1000000000000000000",
			wantSKASubRowsLen:    1,
			wantSKAActiveSubRows: 1,
		},
		{
			name: "VAR + two SKA — neither has txs",
			coinRows: []CoinRowData{
				{CoinType: 0, Symbol: "VAR", TxCount: 2, Amount: "200000000", Size: 200},
				{CoinType: 1, Symbol: "SKA1", TxCount: 0, Amount: "0", Size: 0},
				{CoinType: 2, Symbol: "SKA2", TxCount: 0, Amount: "0", Size: 0},
			},
			wantVARAmount:        "200000000",
			wantVARTxCount:       2,
			wantSKAAmount:        "0",
			wantSKASubRowsLen:    2,
			wantSKAActiveSubRows: 0,
		},
		{
			name: "VAR + two SKA — only SKA1 has txs",
			coinRows: []CoinRowData{
				{CoinType: 0, Symbol: "VAR", TxCount: 2, Amount: "200000000", Size: 200},
				{CoinType: 1, Symbol: "SKA1", TxCount: 1, Amount: "500000000000000000", Size: 100},
				{CoinType: 2, Symbol: "SKA2", TxCount: 0, Amount: "0", Size: 0},
			},
			wantVARAmount:        "200000000",
			wantVARTxCount:       2,
			wantSKAAmount:        "500000000000000000",
			wantSKASubRowsLen:    2,
			wantSKAActiveSubRows: 1,
		},
		{
			name: "VAR + two SKA — both have txs",
			coinRows: []CoinRowData{
				{CoinType: 0, Symbol: "VAR", TxCount: 2, Amount: "200000000", Size: 200},
				{CoinType: 1, Symbol: "SKA1", TxCount: 1, Amount: "500000000000000000", Size: 100},
				{CoinType: 2, Symbol: "SKA2", TxCount: 2, Amount: "750000000000000000", Size: 150},
			},
			wantVARAmount:        "200000000",
			wantVARTxCount:       2,
			wantSKAAmount:        "500000000000000000",
			wantSKASubRowsLen:    2,
			wantSKAActiveSubRows: 2,
		},
		{
			name: "three SKA, no VAR — all have txs",
			coinRows: []CoinRowData{
				{CoinType: 1, Symbol: "SKA1", TxCount: 1, Amount: "1", Size: 1},
				{CoinType: 2, Symbol: "SKA2", TxCount: 1, Amount: "2", Size: 1},
				{CoinType: 3, Symbol: "SKA3", TxCount: 1, Amount: "3", Size: 1},
			},
			wantVARAmount:        "",
			wantVARTxCount:       0,
			wantSKAAmount:        "1",
			wantSKASubRowsLen:    3,
			wantSKAActiveSubRows: 3,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			b := &BlockBasic{
				CoinRows:    tt.coinRows,
				Voters:      tt.voters,
				FreshStake:  tt.freshStake,
				Revocations: tt.revocations,
			}
			b.FlattenCoinRows()
			if b.VARAmount != tt.wantVARAmount {
				t.Errorf("VARAmount: got %q, want %q", b.VARAmount, tt.wantVARAmount)
			}
			if b.VARTxCount != tt.wantVARTxCount {
				t.Errorf("VARTxCount: got %d, want %d", b.VARTxCount, tt.wantVARTxCount)
			}
			if b.SKAAmount != tt.wantSKAAmount {
				t.Errorf("SKAAmount: got %q, want %q", b.SKAAmount, tt.wantSKAAmount)
			}
			if len(b.SKASubRows) != tt.wantSKASubRowsLen {
				t.Errorf("SKASubRows length: got %d, want %d", len(b.SKASubRows), tt.wantSKASubRowsLen)
			}
			if b.SKAActiveSubRows != tt.wantSKAActiveSubRows {
				t.Errorf("SKAActiveSubRows: got %d, want %d", b.SKAActiveSubRows, tt.wantSKAActiveSubRows)
			}
		})
	}
}

// TestFlattenCoinRows_Idempotent verifies that calling FlattenCoinRows more
// than once on the same BlockBasic does not double SKASubRows or
// SKAActiveSubRows.
func TestFlattenCoinRows_Idempotent(t *testing.T) {
	b := &BlockBasic{
		Voters:     1,
		FreshStake: 0,
		CoinRows: []CoinRowData{
			{CoinType: 0, Symbol: "VAR", TxCount: 3, Amount: "100000000", Size: 200},
			{CoinType: 1, Symbol: "SKA1", TxCount: 1, Amount: "500000000000000000", Size: 100},
			{CoinType: 2, Symbol: "SKA2", TxCount: 0, Amount: "0", Size: 0},
		},
	}
	b.FlattenCoinRows()
	b.FlattenCoinRows()
	if len(b.SKASubRows) != 2 {
		t.Errorf("SKASubRows length after 2 calls: got %d, want 2", len(b.SKASubRows))
	}
	if b.SKAActiveSubRows != 1 {
		t.Errorf("SKAActiveSubRows after 2 calls: got %d, want 1", b.SKAActiveSubRows)
	}
	if b.VARTxCount != 2 {
		t.Errorf("VARTxCount after 2 calls: got %d, want 2", b.VARTxCount)
	}
	if b.SKAAmount != "500000000000000000" {
		t.Errorf("SKAAmount after 2 calls: got %q, want %q", b.SKAAmount, "500000000000000000")
	}
}

func TestAddressPrefixes(t *testing.T) {
	cases := []struct {
		name   string
		params *chaincfg.Params
		want   map[string]string // AddrPrefix.Name -> AddrPrefix.Prefix
	}{
		{
			name:   "mainnet",
			params: chaincfg.MainNetParams(),
			want: map[string]string{
				"PubKeyAddrID":     "Mk",
				"PubKeyHashAddrID": "Ms",
				"PKHEdwardsAddrID": "Me",
				"PKHSchnorrAddrID": "MS",
				"ScriptHashAddrID": "Mc",
				"PrivateKeyID":     "Pm",
				"HDPrivateKeyID":   "dprv",
				"HDPublicKeyID":    "dpub",
			},
		},
		{
			name:   "testnet",
			params: chaincfg.TestNet3Params(),
			want: map[string]string{
				"PubKeyAddrID":     "Tk",
				"PubKeyHashAddrID": "Ts",
				"PKHEdwardsAddrID": "Te",
				"PKHSchnorrAddrID": "TS",
				"ScriptHashAddrID": "Tc",
				"PrivateKeyID":     "Pt",
				"HDPrivateKeyID":   "tprv",
				"HDPublicKeyID":    "tpub",
			},
		},
		{
			name:   "simnet",
			params: chaincfg.SimNetParams(),
			want: map[string]string{
				"PubKeyAddrID":     "Sk",
				"PubKeyHashAddrID": "Ss",
				"PKHEdwardsAddrID": "Se",
				"PKHSchnorrAddrID": "SS",
				"ScriptHashAddrID": "Sc",
				"PrivateKeyID":     "Ps",
				"HDPrivateKeyID":   "sprv",
				"HDPublicKeyID":    "spub",
			},
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := AddressPrefixes(tc.params)
			if len(got) != len(tc.want) {
				t.Fatalf("len(AddressPrefixes)=%d, want %d", len(got), len(tc.want))
			}
			for _, ap := range got {
				want, ok := tc.want[ap.Name]
				if !ok {
					t.Errorf("unexpected entry %q", ap.Name)
					continue
				}
				if ap.Prefix != want {
					t.Errorf("%s: prefix=%q, want %q", ap.Name, ap.Prefix, want)
				}
				if ap.Description == "" {
					t.Errorf("%s: empty description", ap.Name)
				}
			}
		})
	}

	// Unknown / custom network must never produce an empty table. We use a
	// shallow clone of mainnet with a renamed Name to exercise the fallback.
	t.Run("unknown-net-fallback", func(t *testing.T) {
		clone := *chaincfg.MainNetParams()
		clone.Name = "custom-devnet-xyz"
		got := AddressPrefixes(&clone)
		if len(got) == 0 {
			t.Fatal("AddressPrefixes returned empty slice for unrecognised net")
		}
		for _, ap := range got {
			if ap.Prefix == "" {
				t.Errorf("%s: empty prefix on unrecognised net", ap.Name)
			}
		}
	})
}

// mkVin builds a Vin whose embedded chainjson.Vin carries the given AmountIn
// (in coins), the value the tx page displays in the "Input Consumed" column.
func mkVin(amountIn float64) Vin {
	return Vin{Vin: &chainjson.Vin{AmountIn: amountIn}}
}

// mkStakebaseVin builds a vote's stakebase input: a non-empty Stakebase marks it
// as newly minted stake reward (IsStakeBase() == true) that carries the subsidy
// as a positive AmountIn but which FeeReward must exclude from consumed inputs.
func mkStakebaseVin(amountIn float64) Vin {
	return Vin{Vin: &chainjson.Vin{AmountIn: amountIn, Stakebase: "01"}}
}

func TestFeeReward(t *testing.T) {
	tests := []struct {
		name string
		vin  []Vin
		vout []Vout
		want float64
	}{
		{
			name: "coinbase zero-value input, sum of outputs",
			vin:  []Vin{mkVin(0)},
			vout: []Vout{{Amount: 10}, {Amount: 2.5}},
			want: 12.5,
		},
		{
			name: "input shows subsidy, fee-only remainder",
			vin:  []Vin{mkVin(8)},
			vout: []Vout{{Amount: 8}, {Amount: 0.5}},
			want: 0.5,
		},
		{
			name: "N/A input (AmountIn < 0) excluded from input sum",
			vin:  []Vin{mkVin(-1)},
			vout: []Vout{{Amount: 3}},
			want: 3,
		},
		{
			name: "multiple inputs and outputs",
			vin:  []Vin{mkVin(1), mkVin(2.5), mkVin(-1)},
			vout: []Vout{{Amount: 5}, {Amount: 0.5}, {Amount: 1}},
			want: 3, // (5+0.5+1) - (1+2.5)
		},
		{
			// Realistic coinbase shape: a single input carries the full block
			// subsidy, outputs split that subsidy across payees plus the
			// collected fees, and FeeReward nets out to the fee remainder.
			name: "subsidy split across outputs minus single subsidy input",
			vin:  []Vin{mkVin(900)},
			vout: []Vout{{Amount: 600}, {Amount: 300}, {Amount: 0.5}},
			want: 0.5, // (600+300+0.5) - 900
		},
		{
			// Vote (SSGen) shape from a real tx: the stakebase carries the
			// stake subsidy as a positive AmountIn but is "created", not
			// consumed, so FeeReward excludes it. The ticket input is consumed
			// and the single stakegen output returns ticket + reward; the two
			// zero-value outputs are the OP_RETURN block reference and vote
			// bits. The net reward equals the stakebase subsidy.
			name: "vote: stakebase subsidy excluded, reward = outputs minus ticket input",
			vin:  []Vin{mkStakebaseVin(3.5), mkVin(1000)},
			vout: []Vout{{Amount: 0}, {Amount: 0}, {Amount: 1003.5}},
			want: 3.5, // 1003.5 - 1000 (stakebase 3.5 excluded as created reward)
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			tx := &TxInfo{Vin: tt.vin, Vout: tt.vout}
			if got := tx.FeeReward(); got != tt.want {
				t.Errorf("FeeReward() = %v, want %v", got, tt.want)
			}
		})
	}
}
