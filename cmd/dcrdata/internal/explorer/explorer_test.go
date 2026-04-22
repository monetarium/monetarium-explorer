package explorer

import (
	"context"
	"fmt"
	"testing"

	apitypes "github.com/monetarium/monetarium-explorer/api/types"
	"github.com/monetarium/monetarium-explorer/blockdata"
	"github.com/monetarium/monetarium-explorer/db/dbtypes"
	explorerTypes "github.com/monetarium/monetarium-explorer/explorer/types"
	"github.com/monetarium/monetarium-node/blockchain/stake"
	"github.com/monetarium/monetarium-node/chaincfg"
	"github.com/monetarium/monetarium-node/chaincfg/chainhash"
	chainjson "github.com/monetarium/monetarium-node/rpc/jsonrpc/types"
	"github.com/monetarium/monetarium-node/wire"
)

type mockDataSource struct {
	blocks  map[string]*explorerTypes.BlockInfo
	heights map[int64]string
	params  *chaincfg.Params
	height  int64
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
func (m *mockDataSource) TreasuryBalance(context.Context) (*dbtypes.TreasuryBalance, error) {
	return nil, nil
}
func (m *mockDataSource) TreasuryTxns(ctx context.Context, n, offset int64, txType stake.TxType) ([]*dbtypes.TreasuryTx, error) {
	return nil, nil
}
func (m *mockDataSource) AddressHistory(ctx context.Context, address string, N, offset int64, txnType dbtypes.AddrTxnViewType) ([]*dbtypes.AddressRow, *dbtypes.AddressBalance, error) {
	return nil, nil, nil
}
func (m *mockDataSource) AddressData(ctx context.Context, address string, N, offset int64, txnType dbtypes.AddrTxnViewType) (*dbtypes.AddressInfo, error) {
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
	return nil, nil, nil, 0, nil
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
	return nil
}
func (m *mockDataSource) VARCoinSupply(ctx context.Context) (*explorerTypes.VARCoinSupply, error) {
	return nil, nil
}
func (m *mockDataSource) SKACoinSupply(ctx context.Context) ([]*explorerTypes.SKACoinSupplyEntry, error) {
	return nil, nil
}

var mockGetBlockSKAFeesResult map[uint8]string

func (m *mockDataSource) GetBlockSKAFees(ctx context.Context, height int64) (map[uint8]string, error) {
	if mockGetBlockSKAFeesResult != nil {
		return mockGetBlockSKAFeesResult, nil
	}
	return nil, nil
}

func TestStore_PoWSKARewardsFallback(t *testing.T) {
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
				HomeInfo: &explorerTypes.HomeInfo{},
			},
			invs: &explorerTypes.MempoolInfo{
				MempoolShort: explorerTypes.MempoolShort{
					CoinStats: make(map[uint8]explorerTypes.MempoolCoinStats),
				},
			},
		}
		return exp, mockDS
	}

	t.Run("ImmediateSuccess", func(t *testing.T) {
		defer func() { mockGetBlockSKAFeesResult = nil }()
		mockGetBlockSKAFeesResult = nil
		exp, mockDS := setup()
		msgBlock := &wire.MsgBlock{Header: wire.BlockHeader{}}
		hash := msgBlock.BlockHash().String()
		height := int64(100)

		mockDS.height = height
		mockDS.heights[height] = hash
		mockDS.blocks[hash] = &explorerTypes.BlockInfo{
			BlockBasic: &explorerTypes.BlockBasic{Height: height, Hash: hash},
		}

		blockData := &blockdata.BlockData{
			Header: chainjson.GetBlockHeaderVerboseResult{Height: uint32(height)},
			ExtraInfo: apitypes.BlockExplorerExtraInfo{
				SKAPoWRewards: map[uint8]string{1: "100", 2: "200"},
				NextBlockSubsidy: &chainjson.GetBlockSubsidyResult{
					Developer: 100,
					PoS:       200,
					PoW:       300,
					Total:     600,
				},
			},
		}

		err := exp.Store(blockData, msgBlock)
		if err != nil {
			t.Fatalf("Store failed: %v", err)
		}

		exp.pageData.RLock()
		defer exp.pageData.RUnlock()
		if len(exp.pageData.HomeInfo.PoWSKARewards) != 2 {
			t.Errorf("Expected 2 rewards, got %d", len(exp.pageData.HomeInfo.PoWSKARewards))
		}
	})

	t.Run("FallbackSuccess", func(t *testing.T) {
		defer func() { mockGetBlockSKAFeesResult = nil }()
		mockGetBlockSKAFeesResult = map[uint8]string{1: "50"}
		exp, mockDS := setup()
		msgBlock := &wire.MsgBlock{Header: wire.BlockHeader{}}
		hash := msgBlock.BlockHash().String()
		height := int64(100)

		mockDS.height = height
		mockDS.heights[height] = hash
		mockDS.blocks[hash] = &explorerTypes.BlockInfo{
			BlockBasic: &explorerTypes.BlockBasic{Height: height, Hash: hash},
		}

		// Reward in a previous block (height 90)
		prevHeight := int64(90)
		prevHash := "hash_90"
		mockDS.heights[prevHeight] = prevHash
		mockDS.blocks[prevHash] = &explorerTypes.BlockInfo{
			BlockBasic: &explorerTypes.BlockBasic{Height: prevHeight, Hash: prevHash, Voters: 10},
			SKAPoWRewards: []explorerTypes.PoWSKAReward{
				{CoinType: 1, Amount: "50"},
			},
		}

		blockData := &blockdata.BlockData{
			Header: chainjson.GetBlockHeaderVerboseResult{Height: uint32(height)},
			ExtraInfo: apitypes.BlockExplorerExtraInfo{
				SKAPoWRewards: map[uint8]string{}, // Empty
				NextBlockSubsidy: &chainjson.GetBlockSubsidyResult{
					Developer: 100,
					PoS:       200,
					PoW:       300,
					Total:     600,
				},
			},
		}

		err := exp.Store(blockData, msgBlock)
		if err != nil {
			t.Fatalf("Store failed: %v", err)
		}

		exp.pageData.RLock()
		defer exp.pageData.RUnlock()
		if len(exp.pageData.HomeInfo.PoWSKARewards) != 1 {
			t.Errorf("Expected 1 reward from fallback, got %d", len(exp.pageData.HomeInfo.PoWSKARewards))
		} else if exp.pageData.HomeInfo.PoWSKARewards[0].Amount != "50" {
			t.Errorf("Expected reward amount 50, got %s", exp.pageData.HomeInfo.PoWSKARewards[0].Amount)
		}
	})

	t.Run("ExhaustiveSearch", func(t *testing.T) {
		defer func() { mockGetBlockSKAFeesResult = nil }()
		mockGetBlockSKAFeesResult = nil
		exp, mockDS := setup()
		msgBlock := &wire.MsgBlock{Header: wire.BlockHeader{}}
		hash := msgBlock.BlockHash().String()
		height := int64(100)

		mockDS.height = height
		mockDS.heights[height] = hash
		mockDS.blocks[hash] = &explorerTypes.BlockInfo{
			BlockBasic: &explorerTypes.BlockBasic{Height: height, Hash: hash},
		}

		// Reward too far back (more than 4320 blocks)
		farHeight := height - 4321
		if farHeight >= 0 {
			farHash := "hash_far"
			mockDS.heights[farHeight] = farHash
			mockDS.blocks[farHash] = &explorerTypes.BlockInfo{
				BlockBasic:    &explorerTypes.BlockBasic{Height: farHeight, Hash: farHash},
				SKAPoWRewards: []explorerTypes.PoWSKAReward{{CoinType: 1, Amount: "10"}},
			}
		}

		blockData := &blockdata.BlockData{
			Header: chainjson.GetBlockHeaderVerboseResult{Height: uint32(height)},
			ExtraInfo: apitypes.BlockExplorerExtraInfo{
				SKAPoWRewards: map[uint8]string{},
				NextBlockSubsidy: &chainjson.GetBlockSubsidyResult{
					Developer: 100,
					PoS:       200,
					PoW:       300,
					Total:     600,
				},
			},
		}

		err := exp.Store(blockData, msgBlock)
		if err != nil {
			t.Fatalf("Store failed: %v", err)
		}

		exp.pageData.RLock()
		defer exp.pageData.RUnlock()
		if exp.pageData.HomeInfo.PoWSKARewards != nil {
			t.Errorf("Expected PoWSKARewards to be nil after exhaustive search, got %v", exp.pageData.HomeInfo.PoWSKARewards)
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
