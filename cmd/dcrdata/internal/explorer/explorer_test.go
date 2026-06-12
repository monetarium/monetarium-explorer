package explorer

import (
	"context"
	"errors"
	"fmt"
	"math/big"
	"testing"
	"time"

	"github.com/monetarium/monetarium-explorer/api/rewardtypes"
	apitypes "github.com/monetarium/monetarium-explorer/api/types"
	"github.com/monetarium/monetarium-explorer/blockdata"
	"github.com/monetarium/monetarium-explorer/db/dbtypes"
	explorerTypes "github.com/monetarium/monetarium-explorer/explorer/types"
	"github.com/monetarium/monetarium-node/chaincfg"
	"github.com/monetarium/monetarium-node/chaincfg/chainhash"
	chainjson "github.com/monetarium/monetarium-node/rpc/jsonrpc/types"
	"github.com/monetarium/monetarium-node/wire"
)

type mockDataSource struct {
	blocks     map[string]*explorerTypes.BlockInfo
	heights    map[int64]string
	params     *chaincfg.Params
	height     int64
	mempoolPCT *apitypes.PriceCountTime
	tpvCharts  [3]*dbtypes.PoolTicketsData
	tpvHeight  int64
	tpvErr     error
	summaries  []*apitypes.BlockDataBasic
}

func (m *mockDataSource) BlockHeight(ctx context.Context, hash string) (int64, error) { return 0, nil }
func (m *mockDataSource) Height() int64                                               { return m.height }
func (m *mockDataSource) HeightDB(context.Context) (int64, error)                     { return 0, nil }
func (m *mockDataSource) BlockHash(ctx context.Context, height int64) (string, error) {
	if h, ok := m.heights[height]; ok {
		return h, nil
	}
	return "", fmt.Errorf("not found")
}
func (m *mockDataSource) SpendingTransaction(ctx context.Context, fundingTx string, vout uint32) (string, uint32, error) {
	return "", 0, nil
}
func (m *mockDataSource) SpendingTransactions(ctx context.Context, fundingTxID string) ([]string, []uint32, []uint32, error) {
	return nil, nil, nil, nil
}
func (m *mockDataSource) PoolStatusForTicket(ctx context.Context, txid string) (dbtypes.TicketSpendType, dbtypes.TicketPoolStatus, error) {
	return 0, 0, nil
}
func (m *mockDataSource) AddressHistory(ctx context.Context, address string, N, offset int64, txnType dbtypes.AddrTxnViewType, coinType uint8) ([]*dbtypes.AddressRow, *dbtypes.AddressBalance, error) {
	return nil, nil, nil
}
func (m *mockDataSource) AddressData(ctx context.Context, address string, N, offset int64, txnType dbtypes.AddrTxnViewType, coinType uint8) (*dbtypes.AddressInfo, error) {
	return nil, nil
}
func (m *mockDataSource) DevBalance(ctx context.Context) (*dbtypes.AddressBalance, error) {
	return nil, nil
}
func (m *mockDataSource) FillAddressTransactions(ctx context.Context, addrInfo *dbtypes.AddressInfo) error {
	return nil
}
func (m *mockDataSource) BlockMissedVotes(ctx context.Context, blockHash string) ([]string, error) {
	return nil, nil
}
func (m *mockDataSource) TicketMiss(ctx context.Context, ticketHash string) (string, int64, error) {
	return "", 0, nil
}
func (m *mockDataSource) SideChainBlocks(context.Context) ([]*dbtypes.BlockStatus, error) {
	return nil, nil
}
func (m *mockDataSource) DisapprovedBlocks(context.Context) ([]*dbtypes.BlockStatus, error) {
	return nil, nil
}
func (m *mockDataSource) BlockStatus(ctx context.Context, hash string) (dbtypes.BlockStatus, error) {
	return dbtypes.BlockStatus{}, nil
}
func (m *mockDataSource) BlockStatuses(ctx context.Context, height int64) ([]*dbtypes.BlockStatus, error) {
	return nil, nil
}
func (m *mockDataSource) BlockFlags(ctx context.Context, hash string) (bool, bool, error) {
	return false, false, nil
}
func (m *mockDataSource) TicketPoolVisualization(ctx context.Context, interval dbtypes.TimeBasedGrouping) (*dbtypes.PoolTicketsData, *dbtypes.PoolTicketsData, *dbtypes.PoolTicketsData, int64, error) {
	return m.tpvCharts[0], m.tpvCharts[1], m.tpvCharts[2], m.tpvHeight, m.tpvErr
}
func (m *mockDataSource) GetMempoolPriceCountTime() *apitypes.PriceCountTime {
	return m.mempoolPCT
}
func (m *mockDataSource) TransactionBlocks(ctx context.Context, hash string) ([]*dbtypes.BlockStatus, []uint32, error) {
	return nil, nil, nil
}
func (m *mockDataSource) Transaction(ctx context.Context, txHash string) ([]*dbtypes.Tx, error) {
	return nil, nil
}
func (m *mockDataSource) VinsForTx(context.Context, *dbtypes.Tx) (vins []dbtypes.VinTxProperty, err error) {
	return nil, nil
}
func (m *mockDataSource) VoutsForTx(context.Context, *dbtypes.Tx) ([]dbtypes.Vout, error) {
	return nil, nil
}
func (m *mockDataSource) PosIntervals(ctx context.Context, limit, offset uint64) ([]*dbtypes.BlocksGroupedInfo, error) {
	return nil, nil
}
func (m *mockDataSource) TimeBasedIntervals(ctx context.Context, timeGrouping dbtypes.TimeBasedGrouping, limit, offset uint64) ([]*dbtypes.BlocksGroupedInfo, error) {
	return nil, nil
}
func (m *mockDataSource) TimeBasedIntervalsCount(ctx context.Context, timeGrouping dbtypes.TimeBasedGrouping) (uint64, error) {
	return 0, nil
}
func (m *mockDataSource) AgendasVotesSummary(ctx context.Context, agendaID string) (summary *dbtypes.AgendaSummary, err error) {
	return nil, nil
}
func (m *mockDataSource) BlockTimeByHeight(ctx context.Context, height int64) (int64, error) {
	return 0, nil
}
func (m *mockDataSource) GetChainParams() *chaincfg.Params { return m.params }
func (m *mockDataSource) GetExplorerBlock(ctx context.Context, hash string) *explorerTypes.BlockInfo {
	return m.blocks[hash]
}
func (m *mockDataSource) GetExplorerBlocks(ctx context.Context, start int, end int) []*explorerTypes.BlockBasic {
	return nil
}
func (m *mockDataSource) GetBlockHeight(ctx context.Context, hash string) (int64, error) {
	return 0, nil
}
func (m *mockDataSource) GetHeightByTimestamp(ctx context.Context, timestamp time.Time) (int64, error) {
	return 0, nil
}
func (m *mockDataSource) GetBlockHash(ctx context.Context, idx int64) (string, error) {
	if h, ok := m.heights[idx]; ok {
		return h, nil
	}
	return "", fmt.Errorf("not found")
}
func (m *mockDataSource) GetExplorerTx(ctx context.Context, txid string) *explorerTypes.TxInfo {
	return nil
}
func (m *mockDataSource) GetTip(context.Context) (*explorerTypes.WebBasicBlock, error) {
	return nil, nil
}
func (m *mockDataSource) DecodeRawTransaction(ctx context.Context, txhex string) (*chainjson.TxRawResult, error) {
	return nil, nil
}
func (m *mockDataSource) SendRawTransaction(ctx context.Context, txhex string) (string, error) {
	return "", nil
}
func (m *mockDataSource) GetTransactionByHash(ctx context.Context, txid string) (*wire.MsgTx, error) {
	return nil, nil
}
func (m *mockDataSource) GetHeight(context.Context) (int64, error)                          { return 0, nil }
func (m *mockDataSource) TxHeight(ctx context.Context, txid *chainhash.Hash) (height int64) { return 0 }
func (m *mockDataSource) DCP0010ActivationHeight() int64                                    { return 0 }
func (m *mockDataSource) DCP0011ActivationHeight() int64                                    { return 0 }
func (m *mockDataSource) DCP0012ActivationHeight() int64                                    { return 0 }
func (m *mockDataSource) BlockSubsidy(ctx context.Context, height int64, voters uint16) *chainjson.GetBlockSubsidyResult {
	return &chainjson.GetBlockSubsidyResult{
		Developer: 100,
		PoS:       200,
		PoW:       300,
		Total:     600,
	}
}
func (m *mockDataSource) GetExplorerFullBlocks(ctx context.Context, start int, end int) []*explorerTypes.BlockInfo {
	return nil
}
func (m *mockDataSource) CurrentDifficulty(context.Context) (float64, error)      { return 0, nil }
func (m *mockDataSource) Difficulty(ctx context.Context, timestamp int64) float64 { return 0 }
func (m *mockDataSource) GetSummaryRange(ctx context.Context, idx0, idx1 int) []*apitypes.BlockDataBasic {
	return m.summaries
}
func (m *mockDataSource) VARCoinSupply(ctx context.Context) (*explorerTypes.VARCoinSupply, error) {
	return nil, nil
}
func (m *mockDataSource) SKACoinSupply(ctx context.Context) ([]*explorerTypes.SKACoinSupplyEntry, error) {
	return nil, nil
}
func (m *mockDataSource) SKACoinEmissionHeights(ctx context.Context, coinTypes []uint8) (map[uint8]int64, error) {
	return nil, nil
}
func (m *mockDataSource) GetVoteTicketDataByBlock(ctx context.Context, blockHash string) ([]dbtypes.VoteTicketData, error) {
	return nil, nil
}

var mockGetBlockSKAFeesResult map[uint8]string

func (m *mockDataSource) GetBlockSKAFees(ctx context.Context, height int64) (map[uint8]string, error) {
	if mockGetBlockSKAFeesResult != nil {
		return mockGetBlockSKAFeesResult, nil
	}
	return nil, nil
}

func (m *mockDataSource) ActiveMiners(_ context.Context, _ int64) (int64, error) {
	return 0, nil
}

// TestStore_PoWSKARewardsFromMFMarker verifies that "PoW SKA Fee Reward" is
// derived from the authoritative "MF"-marked SSFee split
// (ExtraInfo.SSFeeTotalsByCoin[ct].PoW) per issue #273, and that the legacy
// SKAPoWRewards / GetBlockSKAFees heuristic fallback no longer feeds it.
func TestStore_PoWSKARewardsFromMFMarker(t *testing.T) {
	params := chaincfg.MainNetParams()

	setup := func() (*explorerUI, *mockDataSource) {
		mockDS := &mockDataSource{
			blocks:  make(map[string]*explorerTypes.BlockInfo),
			heights: make(map[int64]string),
			params:  params,
		}

		exp := &explorerUI{
			dataSource:  mockDS,
			ChainParams: params,
			wsHub:       NewWebsocketHub(),
			pageData: &pageData{
				HomeInfo: &explorerTypes.HomeInfo{
					Params: explorerTypes.ChainParams{
						BlockTime: 60,
					},
				},
			},
			invs: &explorerTypes.MempoolInfo{
				MempoolShort: explorerTypes.MempoolShort{
					CoinStats: make(map[uint8]explorerTypes.MempoolCoinStats),
				},
			},
		}
		return exp, mockDS
	}

	storeBlock := func(exp *explorerUI, mockDS *mockDataSource, ei apitypes.BlockExplorerExtraInfo) {
		t.Helper()
		msgBlock := &wire.MsgBlock{Header: wire.BlockHeader{}}
		hash := msgBlock.BlockHash().String()
		height := int64(100)
		mockDS.height = height
		mockDS.heights[height] = hash
		mockDS.blocks[hash] = &explorerTypes.BlockInfo{
			BlockBasic: &explorerTypes.BlockBasic{Height: height, Hash: hash},
		}
		ei.NextBlockSubsidy = &chainjson.GetBlockSubsidyResult{
			Developer: 100, PoS: 200, PoW: 300, Total: 600,
		}
		blockData := &blockdata.BlockData{
			Header:    chainjson.GetBlockHeaderVerboseResult{Height: uint32(height)},
			ExtraInfo: ei,
		}
		if err := exp.Store(blockData, msgBlock); err != nil {
			t.Fatalf("Store failed: %v", err)
		}
	}

	t.Run("MF marker on current block yields PoW rewards", func(t *testing.T) {
		exp, mockDS := setup()
		storeBlock(exp, mockDS, apitypes.BlockExplorerExtraInfo{
			SSFeeTotalsByCoin: map[uint8]rewardtypes.SSFeeSplit{
				1: {PoW: big.NewInt(550000000000000000)},
				2: {PoW: big.NewInt(300000000000000000)},
			},
		})

		exp.pageData.RLock()
		defer exp.pageData.RUnlock()
		got := exp.pageData.HomeInfo.PoWSKARewards
		if len(got) != 2 {
			t.Fatalf("expected 2 PoW rewards, got %d (%v)", len(got), got)
		}
		// Sorted by coin type; amounts are the exact MF atoms, not halved.
		if got[0].CoinType != 1 || got[0].Amount != "550000000000000000" {
			t.Errorf("SKA1 PoW = %+v, want amount 550000000000000000", got[0])
		}
		if got[1].CoinType != 2 || got[1].Amount != "300000000000000000" {
			t.Errorf("SKA2 PoW = %+v, want amount 300000000000000000", got[1])
		}
	})

	t.Run("SF-only (no MF) yields no PoW reward", func(t *testing.T) {
		exp, mockDS := setup()
		storeBlock(exp, mockDS, apitypes.BlockExplorerExtraInfo{
			// Staker fee only; the removed heuristic would have used these.
			SKAPoWRewards: map[uint8]string{1: "100"},
			SSFeeTotalsByCoin: map[uint8]rewardtypes.SSFeeSplit{
				1: {PoS: big.NewInt(440000000000000000)},
			},
		})

		exp.pageData.RLock()
		defer exp.pageData.RUnlock()
		if exp.pageData.HomeInfo.PoWSKARewards != nil {
			t.Errorf("expected no PoW reward without an MF marker, got %v",
				exp.pageData.HomeInfo.PoWSKARewards)
		}
	})

	t.Run("sum30 fallback yields per-coin BlockHeight for each SKA coin", func(t *testing.T) {
		exp, mockDS := setup()
		// Only SKA1 appears in the current block's MF SSFee.
		// SKA2 exists only in a recent summary (sum30).
		mockDS.summaries = []*apitypes.BlockDataBasic{
			{
				Height: 95,
				Hash:   "0000000000000000000000000000000000000000000000000000000000000095",
				SSFeeTotalsByCoin: map[uint8]rewardtypes.SSFeeSplit{
					2: {PoW: big.NewInt(300000000000000000)},
				},
			},
		}
		storeBlock(exp, mockDS, apitypes.BlockExplorerExtraInfo{
			SSFeeTotalsByCoin: map[uint8]rewardtypes.SSFeeSplit{
				1: {PoW: big.NewInt(550000000000000000)},
			},
		})

		exp.pageData.RLock()
		defer exp.pageData.RUnlock()
		got := exp.pageData.HomeInfo.PoWSKARewards
		if len(got) != 2 {
			t.Fatalf("expected 2 PoW rewards, got %d (%v)", len(got), got)
		}
		// Sorted by coin type; each coin must carry its own BlockHeight.
		if got[0].CoinType != 1 || got[0].Amount != "550000000000000000" || got[0].BlockHeight != 100 {
			t.Errorf("SKA1 = %+v, want CoinType=1 Amount=550000000000000000 BlockHeight=100", got[0])
		}
		if got[1].CoinType != 2 || got[1].Amount != "300000000000000000" || got[1].BlockHeight != 95 {
			t.Errorf("SKA2 = %+v, want CoinType=2 Amount=300000000000000000 BlockHeight=95", got[1])
		}
	})

	t.Run("legacy SKAPoWRewards alone no longer feeds PoW", func(t *testing.T) {
		exp, mockDS := setup()
		storeBlock(exp, mockDS, apitypes.BlockExplorerExtraInfo{
			SKAPoWRewards: map[uint8]string{1: "100", 2: "200"},
		})

		exp.pageData.RLock()
		defer exp.pageData.RUnlock()
		if exp.pageData.HomeInfo.PoWSKARewards != nil {
			t.Errorf("legacy SKAPoWRewards must not feed PoW (heuristic removed), got %v",
				exp.pageData.HomeInfo.PoWSKARewards)
		}
	})
}

func TestMainNetName(t *testing.T) {
	netName := netName(chaincfg.MainNetParams())
	if netName != "Mainnet" {
		t.Errorf(`Net name not "Mainnet": %s`, netName)
	}
}

func TestSimNetName(t *testing.T) {
	netName := netName(chaincfg.SimNetParams())
	if netName != "Simnet" {
		t.Errorf(`Net name not "Simnet": %s`, netName)
	}
}

func TestThreeSigFigs(t *testing.T) {
	cases := []struct {
		in   float64
		want string
	}{
		// ---- large numbers ----
		// >= 1e17  → "%dQ"   (integer quadrillion)
		{1e17, "100Q"},
		{2.5e17, "250Q"},

		// >= 1e16  → "%.1fQ" (one-decimal quadrillion)
		{1e16, "10.0Q"},
		{1.55e16, "15.5Q"},

		// >= 1e15  → "%.2fQ" (two-decimal quadrillion)
		{1e15, "1.00Q"},
		{1.235e15, "1.24Q"},

		// >= 1e14  → "%dT"   (integer trillion)
		{1e14, "100T"},
		{2.5e14, "250T"},
		// Regression: ~9e14 must render as "900T", not "900000B"
		// (magnitude of 899,999,999,986,870.46... SKA — what the user reported).
		{8.99999999986870e14, "900T"},

		// >= 1e13  → "%.1fT" (one-decimal trillion)
		{1e13, "10.0T"},
		{1.55e13, "15.5T"},

		// >= 1e12  → "%.2fT" (two-decimal trillion)
		{1e12, "1.00T"},
		{1.235e12, "1.24T"},

		// >= 1e11  → "%dB"   (rounds to nearest billion, no decimal)
		{1e11, "100B"},
		{2.5e11, "250B"},
		{1.999e11, "200B"},

		// >= 1e10  → "%.1fB"  (one decimal billion)
		{1e10, "10.0B"},
		{1.55e10, "15.5B"},
		{9.99e10, "99.9B"}, // stays in 1-decimal bracket, does not round up to next
		// >= 1e9   → "%.2fB"  (two decimal billion)
		{1e9, "1.00B"},
		{1.235e9, "1.24B"},
		{9.999e9, "10.00B"}, // stays in 2-decimal bracket, does not round up

		// >= 1e8   → "%dM"
		{1e8, "100M"},
		{4.5e8, "450M"},

		// >= 1e7   → "%.1fM"
		{1e7, "10.0M"},
		{1.55e7, "15.5M"},

		// >= 1e6   → "%.2fM"
		{1e6, "1.00M"},
		{1.235e6, "1.24M"},

		// >= 1e5   → "%dk"
		{1e5, "100k"},
		{4.5e5, "450k"},

		// >= 1e4   → "%.1fk"
		{1e4, "10.0k"},
		{1.55e4, "15.5k"},

		// >= 1e3   → "%.2fk"
		{1e3, "1.00k"},
		{1.235e3, "1.24k"},

		// ---- sub-thousand, >= 100 → "%d"
		{100, "100"},
		{456, "456"},
		{999, "999"},

		// ---- >= 10  → "%.1f"
		{10, "10.0"},
		{15.5, "15.5"},
		{99.9, "99.9"},

		// ---- >= 1   → "%.2f"
		{1, "1.00"},
		{1.23, "1.23"},
		{9.99, "9.99"},

		// ---- sub-1: VAR fees can be fractional coins (e.g. 0.001 VAR fee)
		// threeSigFigs handles these correctly down to ~0.00001.
		{0.5, "0.500"},
		{0.1, "0.100"},
		{0.01, "0.0100"},
		{0.001, "0.00100"},

		// ---- zero
		{0, "0"},
	}

	for _, c := range cases {
		got := threeSigFigs(c.in)
		if got != c.want {
			t.Errorf("threeSigFigs(%v) = %q, want %q", c.in, got, c.want)
		}
	}
}

// TestBuildTicketPoolChartsData_UsesDataSourceMempool guards the fix from
// issue #290: the WS "getticketpooldata" handler must delegate the
// mempool overlay to DataSource.GetMempoolPriceCountTime() so it matches
// REST /api/ticketpool/charts byte-for-byte, instead of re-deriving it
// from inv.Tickets[0].TotalOut.
func TestBuildTicketPoolChartsData_UsesDataSourceMempool(t *testing.T) {
	sentinel := &apitypes.PriceCountTime{
		Price: 42.5,
		Count: 7,
		Time:  dbtypes.NewTimeDef(time.Unix(1700000000, 0).UTC()),
	}
	timeChart := &dbtypes.PoolTicketsData{}
	priceChart := &dbtypes.PoolTicketsData{}
	outputsChart := &dbtypes.PoolTicketsData{}

	t.Run("success path returns Mempool from DataSource", func(t *testing.T) {
		exp := &explorerUI{dataSource: &mockDataSource{
			mempoolPCT: sentinel,
			tpvCharts:  [3]*dbtypes.PoolTicketsData{timeChart, priceChart, outputsChart},
			tpvHeight:  12345,
		}}

		data, errMsg := exp.buildTicketPoolChartsData(context.Background(), "all")
		if errMsg != "" {
			t.Fatalf("unexpected errMsg: %q", errMsg)
		}
		if data == nil {
			t.Fatal("data is nil")
		}
		if data.Mempool != sentinel {
			t.Errorf("Mempool = %+v, want pointer-equal to sentinel %+v", data.Mempool, sentinel)
		}
		if data.ChartHeight != 12345 {
			t.Errorf("ChartHeight = %d, want 12345", data.ChartHeight)
		}
		if data.TimeChart != timeChart || data.PriceChart != priceChart || data.OutputsChart != outputsChart {
			t.Errorf("chart pointers not propagated unchanged from DataSource")
		}
	})

	t.Run("unknown-interval error is surfaced verbatim", func(t *testing.T) {
		exp := &explorerUI{dataSource: &mockDataSource{
			tpvErr: errors.New("unknown interval: nope"),
		}}

		data, errMsg := exp.buildTicketPoolChartsData(context.Background(), "nope")
		if data != nil {
			t.Errorf("data = %+v, want nil on error", data)
		}
		if errMsg != "Error: unknown interval: nope" {
			t.Errorf("errMsg = %q, want %q", errMsg, "Error: unknown interval: nope")
		}
	})
}

// TestStore_PropagatesMiningFeeAtoms verifies that Store copies
// ExtraInfo.MiningFeeAtoms from blockData into HomeInfo. It does NOT
// test the mining fee computation itself (that happens in the collector,
// which calls computeMinerVARFeeAtoms). A full collector-path test
// requires the 5-vote subsidy mismatch to be resolved first.
func TestStore_PropagatesMiningFeeAtoms(t *testing.T) {
	params := chaincfg.MainNetParams()
	mockDS := &mockDataSource{
		blocks:  make(map[string]*explorerTypes.BlockInfo),
		heights: make(map[int64]string),
		params:  params,
	}

	exp := &explorerUI{
		dataSource:  mockDS,
		ChainParams: params,
		wsHub:       NewWebsocketHub(),
		pageData: &pageData{
			HomeInfo: &explorerTypes.HomeInfo{
				Params: explorerTypes.ChainParams{BlockTime: 60},
			},
		},
		invs: &explorerTypes.MempoolInfo{
			MempoolShort: explorerTypes.MempoolShort{
				CoinStats: make(map[uint8]explorerTypes.MempoolCoinStats),
			},
		},
	}

	// Empty block is fine — Store does not inspect msgBlock for fee data.
	msgBlock := &wire.MsgBlock{}
	hash := msgBlock.BlockHash().String()
	height := int64(4423)
	mockDS.height = height
	mockDS.heights[height] = hash
	mockDS.blocks[hash] = &explorerTypes.BlockInfo{
		BlockBasic: &explorerTypes.BlockBasic{Height: height, Hash: hash},
	}

	blockData := &blockdata.BlockData{
		Header: chainjson.GetBlockHeaderVerboseResult{Height: 4423},
		ExtraInfo: apitypes.BlockExplorerExtraInfo{
			NextBlockSubsidy: &chainjson.GetBlockSubsidyResult{
				Developer: 0, PoS: 0, PoW: 3_200_000_000, Total: 3_200_000_000,
			},
			MiningFeeAtoms: 26_135,
		},
	}

	if err := exp.Store(blockData, msgBlock); err != nil {
		t.Fatalf("Store failed: %v", err)
	}

	exp.pageData.RLock()
	defer exp.pageData.RUnlock()

	if exp.pageData.HomeInfo.MiningFeeAtoms != 26_135 {
		t.Errorf("MiningFeeAtoms = %d, want 26135", exp.pageData.HomeInfo.MiningFeeAtoms)
	}
	if exp.pageData.HomeInfo.NBlockSubsidy.PoW != 3_200_000_000 {
		t.Errorf("NBlockSubsidy.PoW = %d, want 3200000000", exp.pageData.HomeInfo.NBlockSubsidy.PoW)
	}
	if exp.pageData.HomeInfo.LBlockTotalAtoms != 3_200_026_135 {
		t.Errorf("LBlockTotalAtoms = %d, want 3200026135", exp.pageData.HomeInfo.LBlockTotalAtoms)
	}
}


