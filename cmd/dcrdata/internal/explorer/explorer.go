// Copyright (c) 2018-2024, The Decred developers
// Copyright (c) 2017, The dcrdata developers
// See LICENSE for details.

// Package explorer handles the block explorer subsystem for generating the
// explorer pages.
package explorer

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"fmt"
	"math"
	"math/big"
	"net/http"
	"os"
	"os/signal"
	"reflect"
	"sort"
	"sync"
	"sync/atomic"
	"time"

	"github.com/monetarium/monetarium-node/blockchain/stake"
	"github.com/monetarium/monetarium-node/chaincfg"
	"github.com/monetarium/monetarium-node/chaincfg/chainhash"
	"github.com/monetarium/monetarium-node/dcrutil"
	chainjson "github.com/monetarium/monetarium-node/rpc/jsonrpc/types"
	"github.com/monetarium/monetarium-node/wire"

	apitypes "github.com/monetarium/monetarium-explorer/api/types"
	"github.com/monetarium/monetarium-explorer/blockdata"
	"github.com/monetarium/monetarium-explorer/db/dbtypes"
	"github.com/monetarium/monetarium-explorer/exchanges"
	"github.com/monetarium/monetarium-explorer/explorer/types"
	"github.com/monetarium/monetarium-explorer/gov/agendas"
	pitypes "github.com/monetarium/monetarium-explorer/gov/politeia/types"
	"github.com/monetarium/monetarium-explorer/mempool"
	pstypes "github.com/monetarium/monetarium-explorer/pubsub/types"
	"github.com/monetarium/monetarium-explorer/txhelpers"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/rs/cors"
)

const (
	// maxExplorerRows and minExplorerRows are the limits on the number of
	// blocks/time-window rows that may be shown on the explorer pages.
	maxExplorerRows = 400
	minExplorerRows = 10

	// syncStatusInterval is the frequency with startup synchronization progress
	// signals are sent to websocket clients.
	syncStatusInterval = 2 * time.Second

	// defaultAddressRows is the default number of rows to be shown on the
	// address page table.
	defaultAddressRows int64 = 20

	// MaxAddressRows is an upper limit on the number of rows that may be shown
	// on the address page table.
	MaxAddressRows int64 = 160

	MaxTreasuryRows int64 = 200

	testnetNetName = "Testnet"
)

// explorerDataSource implements extra data retrieval functions that require a
// faster solution than RPC, or additional functionality.
type explorerDataSource interface {
	BlockHeight(ctx context.Context, hash string) (int64, error)
	Height() int64
	HeightDB(context.Context) (int64, error)
	BlockHash(ctx context.Context, height int64) (string, error)
	SpendingTransaction(ctx context.Context, fundingTx string, vout uint32) (string, uint32, error)
	SpendingTransactions(ctx context.Context, fundingTxID string) ([]string, []uint32, []uint32, error)
	PoolStatusForTicket(ctx context.Context, txid string) (dbtypes.TicketSpendType, dbtypes.TicketPoolStatus, error)
	TreasuryBalance(context.Context) (*dbtypes.TreasuryBalance, error)
	TreasuryTxns(ctx context.Context, n, offset int64, txType stake.TxType) ([]*dbtypes.TreasuryTx, error)
	AddressHistory(ctx context.Context, address string, N, offset int64, txnType dbtypes.AddrTxnViewType) ([]*dbtypes.AddressRow, *dbtypes.AddressBalance, error)
	AddressData(ctx context.Context, address string, N, offset int64, txnType dbtypes.AddrTxnViewType) (*dbtypes.AddressInfo, error)
	DevBalance(ctx context.Context) (*dbtypes.AddressBalance, error)
	FillAddressTransactions(ctx context.Context, addrInfo *dbtypes.AddressInfo) error
	BlockMissedVotes(ctx context.Context, blockHash string) ([]string, error)
	TicketMiss(ctx context.Context, ticketHash string) (string, int64, error)
	SideChainBlocks(context.Context) ([]*dbtypes.BlockStatus, error)
	DisapprovedBlocks(context.Context) ([]*dbtypes.BlockStatus, error)
	BlockStatus(ctx context.Context, hash string) (dbtypes.BlockStatus, error)
	BlockStatuses(ctx context.Context, height int64) ([]*dbtypes.BlockStatus, error)
	BlockFlags(ctx context.Context, hash string) (bool, bool, error)
	TicketPoolVisualization(ctx context.Context, interval dbtypes.TimeBasedGrouping) (*dbtypes.PoolTicketsData, *dbtypes.PoolTicketsData, *dbtypes.PoolTicketsData, int64, error)
	TransactionBlocks(ctx context.Context, hash string) ([]*dbtypes.BlockStatus, []uint32, error)
	Transaction(ctx context.Context, txHash string) ([]*dbtypes.Tx, error)
	VinsForTx(context.Context, *dbtypes.Tx) (vins []dbtypes.VinTxProperty, err error)
	VoutsForTx(context.Context, *dbtypes.Tx) ([]dbtypes.Vout, error)
	PosIntervals(ctx context.Context, limit, offset uint64) ([]*dbtypes.BlocksGroupedInfo, error)
	TimeBasedIntervals(ctx context.Context, timeGrouping dbtypes.TimeBasedGrouping, limit, offset uint64) ([]*dbtypes.BlocksGroupedInfo, error)
	AgendasVotesSummary(ctx context.Context, agendaID string) (summary *dbtypes.AgendaSummary, err error)
	BlockTimeByHeight(ctx context.Context, height int64) (int64, error)
	GetChainParams() *chaincfg.Params
	GetExplorerBlock(ctx context.Context, hash string) *types.BlockInfo
	GetExplorerBlocks(ctx context.Context, start int, end int) []*types.BlockBasic
	GetBlockHeight(ctx context.Context, hash string) (int64, error)
	GetBlockHash(ctx context.Context, idx int64) (string, error)
	GetExplorerTx(ctx context.Context, txid string) *types.TxInfo
	GetTip(context.Context) (*types.WebBasicBlock, error)
	DecodeRawTransaction(ctx context.Context, txhex string) (*chainjson.TxRawResult, error)
	SendRawTransaction(ctx context.Context, txhex string) (string, error)
	GetTransactionByHash(ctx context.Context, txid string) (*wire.MsgTx, error)
	GetHeight(context.Context) (int64, error)
	TxHeight(ctx context.Context, txid *chainhash.Hash) (height int64)
	DCP0010ActivationHeight() int64
	DCP0011ActivationHeight() int64
	DCP0012ActivationHeight() int64
	BlockSubsidy(ctx context.Context, height int64, voters uint16) *chainjson.GetBlockSubsidyResult
	GetExplorerFullBlocks(ctx context.Context, start int, end int) []*types.BlockInfo
	CurrentDifficulty(context.Context) (float64, error)
	Difficulty(ctx context.Context, timestamp int64) float64
	GetSummaryRange(ctx context.Context, idx0, idx1 int) []*apitypes.BlockDataBasic
	VARCoinSupply(ctx context.Context) (*types.VARCoinSupply, error)
	SKACoinSupply(ctx context.Context) ([]*types.SKACoinSupplyEntry, error)
	GetBlockSKAFees(ctx context.Context, height int64) (map[uint8]string, error)
}

type PoliteiaBackend interface {
	ProposalsLastSync() int64
	ProposalsSync() error
	ProposalsAll(offset, rowsCount int, filterByVoteStatus ...int) ([]*pitypes.ProposalRecord, int, error)
	ProposalByToken(token string) (*pitypes.ProposalRecord, error)
}

// agendaBackend implements methods that manage agendas db data.
type agendaBackend interface {
	AgendaInfo(agendaID string) (*agendas.AgendaTagged, error)
	AllAgendas() (agendas []*agendas.AgendaTagged, err error)
	UpdateAgendas() error
}

// ChartDataSource provides data from the charts cache.
type ChartDataSource interface {
	AnonymitySet() uint64
}

// links to be passed with common page data.
type links struct {
	CoinbaseComment string
	POSExplanation  string
	APIDocs         string
	InsightAPIDocs  string
	Github          string
	License         string
	NetParams       string
	DownloadLink    string
	// Testnet and below are set via dcrdata config.
	Testnet       string
	Mainnet       string
	TestnetSearch string
	MainnetSearch string
	OnionURL      string
}

var explorerLinks = &links{
	CoinbaseComment: "https://github.com/decred/dcrd/blob/2a18beb4d56fe59d614a7309308d84891a0cba96/chaincfg/genesis.go#L17-L53",
	POSExplanation:  "https://docs.decred.org/proof-of-stake/overview/",
	APIDocs:         "https://github.com/decred/dcrdata#apis",
	InsightAPIDocs:  "https://github.com/decred/dcrdata/blob/master/docs/Insight_API_documentation.md",
	Github:          "https://github.com/monetarium/monetarium-explorer",
	License:         "https://github.com/monetarium/monetarium-explorer/blob/main/LICENSE",
	NetParams:       "https://github.com/decred/dcrd/blob/master/chaincfg/params.go",
	DownloadLink:    "https://decred.org/wallets/",
}

// TicketStatusText generates the text to display on the explorer's transaction
// page for the "POOL STATUS" field.
func TicketStatusText(s dbtypes.TicketSpendType, p dbtypes.TicketPoolStatus) string {
	switch p {
	case dbtypes.PoolStatusLive:
		return "In Live Ticket Pool"
	case dbtypes.PoolStatusVoted:
		return "Voted"
	case dbtypes.PoolStatusExpired:
		switch s {
		case dbtypes.TicketUnspent:
			return "Expired, Unrevoked"
		case dbtypes.TicketRevoked:
			return "Expired, Revoked"
		default:
			return "invalid ticket state"
		}
	case dbtypes.PoolStatusMissed:
		switch s {
		case dbtypes.TicketUnspent:
			return "Missed, Unrevoked"
		case dbtypes.TicketRevoked:
			return "Missed, Revoked"
		default:
			return "invalid ticket state"
		}
	default:
		return "Immature"
	}
}

type pageData struct {
	sync.RWMutex
	BlockInfo      *types.BlockInfo
	BlockchainInfo *chainjson.GetBlockChainInfoResult
	HomeInfo       *types.HomeInfo
	eTag           string
	lastModified   time.Time
}

type explorerUI struct {
	Mux              *chi.Mux
	dataSource       explorerDataSource
	chartSource      ChartDataSource
	agendasSource    agendaBackend
	voteTracker      *agendas.VoteTracker
	proposals        PoliteiaBackend
	dbsSyncing       atomic.Value
	devPrefetch      bool
	templates        templates
	wsHub            *WebsocketHub
	pageData         *pageData
	ChainParams      *chaincfg.Params
	Version          string
	NetName          string
	MeanVotingBlocks int64
	xcBot            *exchanges.ExchangeBot
	xcDone           chan struct{}
	// displaySyncStatusPage indicates if the sync status page is the only web
	// page that should be accessible during DB synchronization.
	displaySyncStatusPage atomic.Value
	politeiaURL           string

	invsMtx  sync.RWMutex
	invs     *types.MempoolInfo
	premine  int64
	manifest map[string]string
}

// AreDBsSyncing is a thread-safe way to fetch the boolean in dbsSyncing.
func (exp *explorerUI) AreDBsSyncing() bool {
	syncing, ok := exp.dbsSyncing.Load().(bool)
	return ok && syncing
}

// SetDBsSyncing is a thread-safe way to update dbsSyncing.
func (exp *explorerUI) SetDBsSyncing(syncing bool) {
	exp.dbsSyncing.Store(syncing)
	exp.wsHub.SetDBsSyncing(syncing)
}

func (exp *explorerUI) reloadTemplates() error {
	return exp.templates.reloadTemplates()
}

// See reloadsig*.go for an exported method
func (exp *explorerUI) reloadTemplatesSig(sig os.Signal) {
	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, sig)

	go func() {
		for {
			sigr := <-sigChan
			log.Infof("Received %s", sig)
			if sigr == sig {
				if err := exp.reloadTemplates(); err != nil {
					log.Error(err)
					continue
				}
				log.Infof("Explorer UI html templates reparsed.")
			}
		}
	}()
}

// StopWebsocketHub stops the websocket hub
func (exp *explorerUI) StopWebsocketHub() {
	if exp == nil {
		return
	}
	log.Info("Stopping websocket hub.")
	exp.wsHub.Stop()
	close(exp.xcDone)
}

// ExplorerConfig is the configuration settings for explorerUI.
type ExplorerConfig struct {
	DataSource        explorerDataSource
	ChartSource       ChartDataSource
	UseRealIP         bool
	AppVersion        string
	DevPrefetch       bool
	Viewsfolder       string
	XcBot             *exchanges.ExchangeBot
	AgendasSource     agendaBackend
	Tracker           *agendas.VoteTracker
	Proposals         PoliteiaBackend
	PoliteiaURL       string
	MainnetLink       string
	TestnetLink       string
	OnionAddress      string
	ReloadHTML        bool
	AssetManifestPath string
}

// New returns an initialized instance of explorerUI
func New(cfg *ExplorerConfig) *explorerUI {
	exp := new(explorerUI)
	exp.Mux = chi.NewRouter()
	exp.dataSource = cfg.DataSource
	exp.chartSource = cfg.ChartSource
	// Allocate Mempool fields.
	exp.invs = new(types.MempoolInfo)
	exp.Version = cfg.AppVersion
	exp.devPrefetch = cfg.DevPrefetch
	exp.xcBot = cfg.XcBot
	exp.xcDone = make(chan struct{})
	exp.agendasSource = cfg.AgendasSource
	exp.voteTracker = cfg.Tracker
	exp.proposals = cfg.Proposals
	exp.politeiaURL = cfg.PoliteiaURL
	explorerLinks.Mainnet = cfg.MainnetLink
	explorerLinks.Testnet = cfg.TestnetLink
	explorerLinks.MainnetSearch = cfg.MainnetLink + "search?search="
	explorerLinks.TestnetSearch = cfg.TestnetLink + "search?search="

	if cfg.OnionAddress != "" {
		explorerLinks.OnionURL = fmt.Sprintf("http://%s/", cfg.OnionAddress)
	}

	// explorerDataSource is an interface that could have a value of pointer type.
	if exp.dataSource == nil || reflect.ValueOf(exp.dataSource).IsNil() {
		log.Errorf("An explorerDataSource (PostgreSQL backend) is required.")
		return nil
	}

	if cfg.UseRealIP {
		exp.Mux.Use(middleware.RealIP)
	}

	params := exp.dataSource.GetChainParams()
	exp.ChainParams = params
	exp.NetName = netName(exp.ChainParams)
	exp.MeanVotingBlocks = txhelpers.CalcMeanVotingBlocks(params)
	exp.premine = params.BlockOneSubsidy()

	// Development subsidy address of the current network
	devSubsidyAddress, err := dbtypes.DevSubsidyAddress(params)
	if err != nil {
		log.Warnf("explorer.New: %v", err)
	}
	log.Debugf("Organization address: %s", devSubsidyAddress)

	exp.pageData = &pageData{
		BlockInfo: new(types.BlockInfo),
		HomeInfo: &types.HomeInfo{
			Params: types.ChainParams{
				WindowSize:       exp.ChainParams.StakeDiffWindowSize,
				RewardWindowSize: exp.ChainParams.SubsidyReductionInterval,
				BlockTime:        exp.ChainParams.TargetTimePerBlock.Nanoseconds(),
				MeanVotingBlocks: exp.MeanVotingBlocks,
			},
			PoolInfo: types.TicketPoolInfo{
				Target: uint32(exp.ChainParams.TicketPoolSize) * uint32(exp.ChainParams.TicketsPerBlock),
			},
		},
	}
	exp.resetETagAndLastModified()

	log.Infof("Mean Voting Blocks calculated: %d", exp.pageData.HomeInfo.Params.MeanVotingBlocks)

	// Load webpack manifest for cache-busted asset URLs.
	if cfg.AssetManifestPath != "" {
		if manifestData, err := os.ReadFile(cfg.AssetManifestPath); err != nil {
			log.Warnf("Could not read asset manifest: %v", err)
		} else if err = json.Unmarshal(manifestData, &exp.manifest); err != nil {
			log.Warnf("Could not parse asset manifest: %v", err)
		} else {
			log.Infof("Loaded asset manifest with %d entries", len(exp.manifest))
		}
	}

	funcMap := makeTemplateFuncMap(exp.ChainParams)
	funcMap["asset"] = func(name string) string {
		if hashed, ok := exp.manifest[name]; ok {
			return hashed
		}
		return "/dist/" + name
	}

	commonTemplates := []string{"extras", "home_latest_blocks", "home_mempool", "home_voting", "home_mining", "home_supply"}
	exp.templates = newTemplates(cfg.Viewsfolder, cfg.ReloadHTML, commonTemplates, funcMap)

	tmpls := []string{"home", "blocks", "mempool", "block", "tx", "address",
		"rawtx", "status", "parameters", "agenda", "agendas", "charts",
		"sidechains", "disapproved", "ticketpool", "visualblocks",
		"windows", "timelisting", "addresstable", "proposals", "proposal",
		"market", "insight_root", "attackcost", "treasury", "treasurytable", "verify_message"}

	for _, name := range tmpls {
		if err := exp.templates.addTemplate(name); err != nil {
			log.Errorf("Unable to create new html template: %v", err)
			return nil
		}
	}

	exp.addRoutes()

	exp.wsHub = NewWebsocketHub()

	go exp.wsHub.run()

	go exp.watchExchanges()

	return exp
}

// Height returns the height of the current block data.
func (exp *explorerUI) Height() int64 {
	exp.pageData.RLock()
	defer exp.pageData.RUnlock()

	if exp.pageData.BlockInfo.BlockBasic == nil {
		// If exp.pageData.BlockInfo.BlockBasic has not yet been set return:
		return -1
	}

	return exp.pageData.BlockInfo.Height
}

// LastBlock returns the last block hash, height and time.
func (exp *explorerUI) LastBlock() (lastBlockHash string, lastBlock int64, lastBlockTime int64) {
	exp.pageData.RLock()
	defer exp.pageData.RUnlock()

	if exp.pageData.BlockInfo.BlockBasic == nil {
		// If exp.pageData.BlockInfo.BlockBasic has not yet been set return:
		lastBlock, lastBlockTime = -1, -1
		return
	}

	lastBlock = exp.pageData.BlockInfo.Height
	lastBlockTime = exp.pageData.BlockInfo.BlockTime.UNIX()
	lastBlockHash = exp.pageData.BlockInfo.Hash
	return
}

// MempoolInventory safely retrieves the current mempool inventory.
func (exp *explorerUI) MempoolInventory() *types.MempoolInfo {
	exp.invsMtx.RLock()
	defer exp.invsMtx.RUnlock()
	return exp.invs
}

// MempoolID safely fetches the current mempool inventory ID.
func (exp *explorerUI) MempoolID() uint64 {
	exp.invsMtx.RLock()
	defer exp.invsMtx.RUnlock()
	return exp.invs.ID()
}

// MempoolSignal returns the mempool signal channel, which is to be used by the
// mempool package's MempoolMonitor as a send-only channel.
func (exp *explorerUI) MempoolSignal() chan<- pstypes.HubMessage {
	return exp.wsHub.HubRelay
}

// StoreMPData stores mempool data. It is advisable to pass a copy of the
// []types.MempoolTx so that it may be modified (e.g. sorted) without affecting
// other MempoolDataSavers.
func (exp *explorerUI) StoreMPData(_ *mempool.StakeData, _ []types.MempoolTx, inv *types.MempoolInfo) {
	exp.pageData.RLock()
	blockchainInfo := exp.pageData.BlockchainInfo
	// Derive the full set of issued SKA coin types from the cached supply data
	// so that coins with no current mempool activity still get a zero-fill entry.
	var issuedSKA []uint8
	for _, entry := range exp.pageData.HomeInfo.SKACoinSupply {
		issuedSKA = append(issuedSKA, entry.CoinType)
	}
	exp.pageData.RUnlock()

	maxBlockSize := 393216.0
	if blockchainInfo != nil && blockchainInfo.MaxBlockSize > 0 {
		maxBlockSize = float64(blockchainInfo.MaxBlockSize)
	}
	fills, totalFillRatio, activeSKACount := computeCoinFills(inv.CoinStats, maxBlockSize, issuedSKA)
	inv.CoinFills = fills
	inv.MempoolShort.CoinFills = fills
	inv.MempoolShort.TotalFillRatio = totalFillRatio
	inv.MempoolShort.ActiveSKACount = activeSKACount

	// Get exclusive access to the Mempool field.
	exp.invsMtx.Lock()
	exp.invs = inv
	exp.invsMtx.Unlock()

	exp.resetETagAndLastModified()

	log.Debugf("Updated mempool details for the explorerUI.")
}

// Store implements BlockDataSaver.
func (exp *explorerUI) Store(blockData *blockdata.BlockData, msgBlock *wire.MsgBlock) error {
	ctx := context.TODO()

	// Retrieve block data for the passed block hash.
	newBlockData := exp.dataSource.GetExplorerBlock(ctx, msgBlock.BlockHash().String())

	// Use the latest block's blocktime to get the last 24hr timestamp.
	day := 24 * time.Hour
	targetTimePerBlock := float64(exp.ChainParams.TargetTimePerBlock)

	// Hashrate change over last day
	timestamp := newBlockData.BlockTime.T.Add(-day).Unix()
	last24hrDifficulty := exp.dataSource.Difficulty(ctx, timestamp)
	last24HrHashRate := dbtypes.CalculateHashRate(last24hrDifficulty, targetTimePerBlock)

	// Hashrate change over last month
	timestamp = newBlockData.BlockTime.T.Add(-30 * day).Unix()
	lastMonthDifficulty := exp.dataSource.Difficulty(ctx, timestamp)
	lastMonthHashRate := dbtypes.CalculateHashRate(lastMonthDifficulty, targetTimePerBlock)

	difficulty := blockData.Header.Difficulty
	hashrate := dbtypes.CalculateHashRate(difficulty, targetTimePerBlock)

	// If BlockData contains non-nil PoolInfo, compute actual percentage of DCR
	// supply staked.
	stakePerc := 45.0
	if blockData.PoolInfo != nil {
		stakePerc = blockData.PoolInfo.Value / dcrutil.Amount(blockData.ExtraInfo.CoinSupply).ToCoin()
	}

	// Update pageData with block data and chain (home) info.
	p := exp.pageData
	p.Lock()

	// Store current block and blockchain data.
	p.BlockInfo = newBlockData
	p.BlockchainInfo = blockData.BlockchainInfo

	// Update HomeInfo.
	p.HomeInfo.HashRate = hashrate
	p.HomeInfo.HashRateChangeDay = 100 * (hashrate - last24HrHashRate) / last24HrHashRate
	p.HomeInfo.HashRateChangeMonth = 100 * (hashrate - lastMonthHashRate) / lastMonthHashRate
	p.HomeInfo.CoinSupply = blockData.ExtraInfo.CoinSupply
	p.HomeInfo.StakeDiff = blockData.CurrentStakeDiff.CurrentStakeDifficulty
	p.HomeInfo.NextExpectedStakeDiff = blockData.EstStakeDiff.Expected
	p.HomeInfo.NextExpectedBoundsMin = blockData.EstStakeDiff.Min
	p.HomeInfo.NextExpectedBoundsMax = blockData.EstStakeDiff.Max
	p.HomeInfo.IdxBlockInWindow = blockData.IdxBlockInWindow
	p.HomeInfo.IdxInRewardWindow = int(newBlockData.Height%exp.ChainParams.SubsidyReductionInterval) + 1
	p.HomeInfo.Difficulty = difficulty
	p.HomeInfo.NBlockSubsidy.Dev = blockData.ExtraInfo.NextBlockSubsidy.Developer
	p.HomeInfo.NBlockSubsidy.PoS = blockData.ExtraInfo.NextBlockSubsidy.PoS
	p.HomeInfo.NBlockSubsidy.PoW = blockData.ExtraInfo.NextBlockSubsidy.PoW
	p.HomeInfo.NBlockSubsidy.Total = blockData.ExtraInfo.NextBlockSubsidy.Total

	// New Supply section data
	varSupply, err := exp.dataSource.VARCoinSupply(ctx)
	if err != nil {
		log.Errorf("Store: VARCoinSupply failed: %v", err)
	} else {
		p.HomeInfo.VARCoinSupply = varSupply
	}
	skaSupply, err := exp.dataSource.SKACoinSupply(ctx)
	if err != nil {
		log.Errorf("Store: SKACoinSupply failed: %v", err)
	} else {
		// Convert []*types.SKACoinSupplyEntry to []types.SKACoinSupplyEntry
		entries := make([]types.SKACoinSupplyEntry, len(skaSupply))
		for i, e := range skaSupply {
			entries[i] = *e
		}
		p.HomeInfo.SKACoinSupply = entries
	}

	// Recompute fill bars using the freshly updated issued set so that any
	// newly issued SKA coin (e.g. via coinbase) gets a zero-fill indicator
	// broadcast to connected clients even before its first mempool transaction.
	{
		var issuedSKA []uint8
		for _, entry := range p.HomeInfo.SKACoinSupply {
			issuedSKA = append(issuedSKA, entry.CoinType)
		}
		maxBlockSize := 393216.0
		if p.BlockchainInfo != nil && p.BlockchainInfo.MaxBlockSize > 0 {
			maxBlockSize = float64(p.BlockchainInfo.MaxBlockSize)
		}
		exp.invsMtx.Lock()
		fills, totalFillRatio, activeSKACount := computeCoinFills(exp.invs.CoinStats, maxBlockSize, issuedSKA)
		exp.invs.CoinFills = fills
		exp.invs.MempoolShort.CoinFills = fills
		exp.invs.MempoolShort.TotalFillRatio = totalFillRatio
		exp.invs.MempoolShort.ActiveSKACount = activeSKACount
		exp.invsMtx.Unlock()
	}

	// If BlockData contains non-nil PoolInfo, copy values.
	p.HomeInfo.PoolInfo = types.TicketPoolInfo{}
	if blockData.PoolInfo != nil {
		tpTarget := uint32(exp.ChainParams.TicketPoolSize) * uint32(exp.ChainParams.TicketsPerBlock)
		p.HomeInfo.PoolInfo = types.TicketPoolInfo{
			Size:          blockData.PoolInfo.Size,
			Value:         blockData.PoolInfo.Value,
			ValAvg:        blockData.PoolInfo.ValAvg,
			Percentage:    stakePerc * 100,
			PercentTarget: 100 * float64(blockData.PoolInfo.Size) / float64(tpTarget),
			Target:        tpTarget,
		}
	}

	posSubsPerVote := dcrutil.Amount(blockData.ExtraInfo.NextBlockSubsidy.PoS).ToCoin() /
		float64(exp.ChainParams.TicketsPerBlock)
	ticketRewardPct := 100 * posSubsPerVote / blockData.CurrentStakeDiff.CurrentStakeDifficulty
	p.HomeInfo.TicketReward = ticketRewardPct
	p.HomeInfo.VoteVARReward = types.VoteVARReward{
		PerBlock:  posSubsPerVote,
		Per30Days: ticketRewardPct,
		// PerYear (ASR) is computed asynchronously below; set placeholder here.
		PerYear: p.HomeInfo.ASR,
	}

	// The actual reward of a ticket needs to also take into consideration the
	// ticket maturity (time from ticket purchase until its eligible to vote)
	// and coinbase maturity (time after vote until funds distributed to ticket
	// holder are available to use).
	avgSSTxToSSGenMaturity := exp.MeanVotingBlocks +
		int64(exp.ChainParams.TicketMaturity) +
		int64(exp.ChainParams.CoinbaseMaturity)
	p.HomeInfo.RewardPeriod = fmt.Sprintf("%.2f days", float64(avgSSTxToSSGenMaturity)*
		exp.ChainParams.TargetTimePerBlock.Hours()/24)

	// Compute per-SKA vote rewards. Averages are always computed from
	// historical summaries so they survive SKA-free blocks. PerBlock is
	// retrieved from the latest block that contains SKA fee data.
	blocksIn30Days := int(30 * 24 * time.Hour / exp.ChainParams.TargetTimePerBlock)
	tip := int(exp.dataSource.Height())
	start30 := tip - blocksIn30Days
	if start30 < 0 {
		start30 = 0
	}
	startYear := tip - blocksIn30Days*12
	if startYear < 0 {
		startYear = 0
	}
	sum30 := exp.dataSource.GetSummaryRange(ctx, start30, tip)
	sumYear := exp.dataSource.GetSummaryRange(ctx, startYear, tip)
	toSummaries := func(blocks []*apitypes.BlockDataBasic) []txhelpers.SSFeeSummary {
		s := make([]txhelpers.SSFeeSummary, len(blocks))
		for i, b := range blocks {
			s[i] = txhelpers.SSFeeSummary{SSFeeTotalsByCoin: b.SSFeeTotalsByCoin, StakeDiff: b.StakeDiff}
		}
		return s
	}

	coinTypes := txhelpers.SSFeeCoinTypes(toSummaries(sumYear))
	for ct := range blockData.ExtraInfo.SSFeeTotalsByCoin {
		coinTypes[ct] = struct{}{}
	}

	// Find the latest block with SKA fee data for PerBlock calculation.
	var latestSkaBlock *apitypes.BlockDataBasic
	var latestSkaVoters int64
	var voteRewardsBlockHeight int64

	if len(blockData.ExtraInfo.SSFeeTotalsByCoin) > 0 {
		// Use current block data directly to avoid redundant DB query
		voteRewardsBlockHeight = int64(blockData.Header.Height)
		latestSkaVoters = int64(blockData.Header.Voters)
		latestSkaBlock = &apitypes.BlockDataBasic{
			SSFeeTotalsByCoin: blockData.ExtraInfo.SSFeeTotalsByCoin,
		}
	} else {
		// Fallback: Search backwards through historical summaries
		for i := len(sum30) - 1; i >= 0; i-- {
			if len(sum30[i].SSFeeTotalsByCoin) > 0 {
				latestSkaBlock = sum30[i]
				voteRewardsBlockHeight = int64(sum30[i].Height)
				// Get full block info to retrieve the voters count for this specific block
				if bInfo := exp.dataSource.GetExplorerBlock(ctx, latestSkaBlock.Hash); bInfo != nil {
					latestSkaVoters = int64(bInfo.BlockBasic.Voters)
				}
				break
			}
		}
	}

	if len(coinTypes) > 0 {
		sum30S := toSummaries(sum30)
		sumYearS := toSummaries(sumYear)
		rewards := make([]types.SKAVoteReward, 0, len(coinTypes))
		for ct := range coinTypes {
			var perBlock string
			if latestSkaBlock != nil {
				if totalStr, ok := latestSkaBlock.SSFeeTotalsByCoin[ct]; ok {
					if total, parsed := new(big.Int).SetString(totalStr, 10); parsed && latestSkaVoters > 0 {
						perVote := new(big.Int).Div(total, big.NewInt(latestSkaVoters))
						perBlock = txhelpers.FormatSKAAtoms(perVote)
					}
				}
			}
			rewards = append(rewards, types.SKAVoteReward{
				CoinType:    ct,
				Symbol:      fmt.Sprintf("SKA%d", ct),
				PerBlock:    perBlock,
				Per30Days:   txhelpers.AvgSSFeeRate(sum30S, ct, exp.ChainParams.TicketsPerBlock),
				PerYear:     txhelpers.AvgSSFeeRate(sumYearS, ct, exp.ChainParams.TicketsPerBlock),
				BlockHeight: voteRewardsBlockHeight,
			})
		}
		sort.Slice(rewards, func(i, j int) bool { return rewards[i].CoinType < rewards[j].CoinType })
		p.HomeInfo.SKAVoteRewards = rewards
	} else {
		p.HomeInfo.SKAVoteRewards = nil
	}

	// PoW SKA rewards: prioritize rewards from the current block (miner-centric),
	// then fallback to previous blocks if current block is empty.
	var powRewardsBlockHeight int64
	if len(newBlockData.SKAPoWRewards) > 0 {
		powRewardsBlockHeight = newBlockData.Height
		for i := range newBlockData.SKAPoWRewards {
			newBlockData.SKAPoWRewards[i].BlockHeight = powRewardsBlockHeight
		}
		p.HomeInfo.PoWSKARewards = newBlockData.SKAPoWRewards
	} else {
		var powRewardsMap map[uint8]string
		if len(blockData.ExtraInfo.SKAPoWRewards) > 0 {
			powRewardsBlockHeight = newBlockData.Height
			powRewardsMap = blockData.ExtraInfo.SKAPoWRewards
		} else {
			// Fallback: Search backwards from the current block height.
			// Use RPC to compute SKA fees from block transaction data.
			// NOTE: This loop makes up to 4320 RPC calls. Consider caching SKA fees
			// in the DB to avoid repeated RPC overhead in production.
			currentHeight := newBlockData.Height
			for h := currentHeight - 1; h >= currentHeight-4320 && h >= 0; h-- {
				skaFees, err := exp.dataSource.GetBlockSKAFees(ctx, h)
				if err != nil {
					continue
				}
				if len(skaFees) > 0 {
					powRewardsBlockHeight = h
					powRewardsMap = skaFees
					break
				}
			}
		}

		if len(powRewardsMap) > 0 {
			powRewards := make([]types.PoWSKAReward, 0, len(powRewardsMap))
			for ct, amountStr := range powRewardsMap {
				powRewards = append(powRewards, types.PoWSKAReward{
					CoinType:    ct,
					Symbol:      fmt.Sprintf("SKA%d", ct),
					Amount:      amountStr,
					BlockHeight: powRewardsBlockHeight,
				})
			}
			sort.Slice(powRewards, func(i, j int) bool { return powRewards[i].CoinType < powRewards[j].CoinType })
			p.HomeInfo.PoWSKARewards = powRewards
		} else {
			p.HomeInfo.PoWSKARewards = nil
		}
	}

	// If exchange monitoring is enabled, set the exchange rate.
	if exp.xcBot != nil {
		exchangeConversion := exp.xcBot.Conversion(1.0)
		if exchangeConversion != nil {
			conversion := types.Conversion(*exchangeConversion)
			p.HomeInfo.ExchangeRate = &conversion
		} else {
			log.Errorf("No rate conversion available yet.")
		}
	}

	p.Unlock()

	// Signal to the websocket hub that a new block was received, but do not
	// block Store(), and do not hang forever in a goroutine waiting to send.
	go func() {
		select {
		case exp.wsHub.HubRelay <- pstypes.HubMessage{Signal: sigNewBlock}:
		case <-time.After(time.Second * 10):
			log.Errorf("sigNewBlock send failed: Timeout waiting for WebsocketHub.")
		}
	}()

	// Broadcast updated fill bars so clients learn about newly issued coins
	// (e.g. via coinbase) even before any mempool transactions for them arrive.
	go func() {
		select {
		case exp.wsHub.HubRelay <- pstypes.HubMessage{Signal: sigMempoolUpdate}:
		case <-time.After(time.Second * 10):
			log.Errorf("sigMempoolUpdate send failed: Timeout waiting for WebsocketHub.")
		}
	}()

	log.Debugf("Got new block %d for the explorer.", newBlockData.Height)

	// Do not run remaining updates when blockchain sync is running.
	if exp.AreDBsSyncing() {
		return nil
	}

	// Simulate the annual staking rate.
	go func(height int64, sdiff float64, supply int64) {
		ASR, _ := exp.simulateASR(ctx, 1000, false, stakePerc,
			dcrutil.Amount(supply).ToCoin(),
			float64(height), sdiff)
		p.Lock()
		p.HomeInfo.ASR = ASR
		p.HomeInfo.VoteVARReward.PerYear = ASR
		p.Unlock()
	}(newBlockData.Height, blockData.CurrentStakeDiff.CurrentStakeDifficulty,
		blockData.ExtraInfo.CoinSupply) // eval args now instead of in closure

	// Trigger a vote info refresh.
	if exp.voteTracker != nil {
		go exp.voteTracker.Refresh()
	}

	// Update proposals data every 5 blocks
	if (newBlockData.Height%5 == 0) && exp.proposals != nil {
		// Update the proposal DB. This is run asynchronously since it involves
		// a query to Politeia (a remote system) and we do not want to block
		// execution.
		go func() {
			err := exp.proposals.ProposalsSync()
			if err != nil {
				log.Errorf("(PoliteiaBackend).ProposalsSync: %v", err)
			}
		}()
	}

	// Update consensus agendas data every 5 blocks.
	if newBlockData.Height%5 == 0 && exp.agendasSource != nil {
		go func() {
			err := exp.agendasSource.UpdateAgendas()
			if err != nil {
				log.Errorf("(agendaBackend).UpdateAgendas: %v", err)
			}
		}()
	}

	exp.resetETagAndLastModified()

	return nil
}

// ChartsUpdated should be called when a chart update completes.
func (exp *explorerUI) ChartsUpdated() {
	anonSet := exp.chartSource.AnonymitySet()
	exp.pageData.Lock()
	if exp.pageData.HomeInfo.CoinSupply > 0 {
		exp.pageData.HomeInfo.MixedPercent = float64(anonSet) / float64(exp.pageData.HomeInfo.CoinSupply) * 100
	}
	exp.pageData.Unlock()
}

// resetETagAndLastModified resets the eTag and last modified time to new
// values and is protected by the exp.pageData mutex.
func (exp *explorerUI) resetETagAndLastModified() {
	exp.pageData.Lock()
	exp.pageData.eTag = generateRandomString()
	exp.pageData.lastModified = time.Now()
	exp.pageData.Unlock()
}

func (exp *explorerUI) eTagAndLastModified() (eTag string, lastModified time.Time) {
	exp.pageData.RLock()
	defer exp.pageData.RUnlock()
	return exp.pageData.eTag, exp.pageData.lastModified
}

type loggerFunc func(string, ...interface{})

func (lw loggerFunc) Printf(str string, args ...interface{}) {
	lw(str, args...)
}

func (exp *explorerUI) addRoutes() {
	exp.Mux.Use(middleware.Logger)
	exp.Mux.Use(middleware.Recoverer)
	corsMW := cors.Default()
	corsMW.Log = loggerFunc(log.Tracef)
	exp.Mux.Use(corsMW.Handler)

	redirect := func(url string) http.HandlerFunc {
		return func(w http.ResponseWriter, r *http.Request) {
			x := chi.URLParam(r, "x")
			if x != "" {
				x = "/" + x
			}
			http.Redirect(w, r, "/"+url+x, http.StatusPermanentRedirect)
		}
	}
	exp.Mux.Get("/", redirect("blocks"))

	exp.Mux.Get("/block/{x}", redirect("block"))

	exp.Mux.Get("/tx/{x}", redirect("tx"))

	exp.Mux.Get("/address/{x}", redirect("address"))

	exp.Mux.Get("/decodetx", redirect("decodetx"))
}

// Simulate ticket purchase and re-investment over a full year for a given
// starting amount of DCR and calculation parameters.  Generate a TEXT table of
// the simulation results that can optionally be used for future expansion of
// dcrdata functionality.
func (exp *explorerUI) simulateASR(ctx context.Context, StartingDCRBalance float64, IntegerTicketQty bool,
	CurrentStakePercent float64, ActualCoinbase float64, CurrentBlockNum float64,
	ActualTicketPrice float64) (ASR float64, ReturnTable string) {

	// Calculations are only useful on mainnet.  Short circuit calculations if
	// on any other version of chain params.
	if exp.ChainParams.Name != "mainnet" {
		return 0, ""
	}

	BlocksPerDay := 86400 / exp.ChainParams.TargetTimePerBlock.Seconds()
	BlocksPerYear := 365 * BlocksPerDay
	TicketsPurchased := float64(0)

	votesPerBlock := exp.ChainParams.VotesPerBlock()

	StakeRewardAtBlock := func(blocknum float64) float64 {
		Subsidy := exp.dataSource.BlockSubsidy(ctx, int64(blocknum), votesPerBlock)
		return dcrutil.Amount(Subsidy.PoS / int64(votesPerBlock)).ToCoin()
	}

	MaxCoinSupplyAtBlock := func(blocknum float64) float64 {
		// 4th order poly best fit curve to Decred mainnet emissions plot.
		// Curve fit was done with 0 Y intercept and Pre-Mine added after.

		return (-9e-19*math.Pow(blocknum, 4) +
			7e-12*math.Pow(blocknum, 3) -
			2e-05*math.Pow(blocknum, 2) +
			29.757*blocknum + 76963 +
			1680000) // Premine 1.68M
	}

	CoinAdjustmentFactor := ActualCoinbase / MaxCoinSupplyAtBlock(CurrentBlockNum)

	TheoreticalTicketPrice := func(blocknum float64) float64 {
		ProjectedCoinsCirculating := MaxCoinSupplyAtBlock(blocknum) * CoinAdjustmentFactor * CurrentStakePercent
		TicketPoolSize := (float64(exp.MeanVotingBlocks) + float64(exp.ChainParams.TicketMaturity) +
			float64(exp.ChainParams.CoinbaseMaturity)) * float64(exp.ChainParams.TicketsPerBlock)
		return ProjectedCoinsCirculating / TicketPoolSize
	}
	TicketAdjustmentFactor := ActualTicketPrice / TheoreticalTicketPrice(CurrentBlockNum)

	// Prepare for simulation
	simblock := CurrentBlockNum
	TicketPrice := ActualTicketPrice
	DCRBalance := StartingDCRBalance

	ReturnTable += "\n\nBLOCKNUM        DCR  TICKETS TKT_PRICE TKT_REWRD  ACTION\n"
	ReturnTable += fmt.Sprintf("%8d  %9.2f %8.1f %9.2f %9.2f    INIT\n",
		int64(simblock), DCRBalance, TicketsPurchased,
		TicketPrice, StakeRewardAtBlock(simblock))

	for simblock < (BlocksPerYear + CurrentBlockNum) {
		// Simulate a Purchase on simblock
		TicketPrice = TheoreticalTicketPrice(simblock) * TicketAdjustmentFactor

		if IntegerTicketQty {
			// Use this to simulate integer qtys of tickets up to max funds
			TicketsPurchased = math.Floor(DCRBalance / TicketPrice)
		} else {
			// Use this to simulate ALL funds used to buy tickets - even fractional tickets
			// which is actually not possible
			TicketsPurchased = (DCRBalance / TicketPrice)
		}

		DCRBalance -= (TicketPrice * TicketsPurchased)
		ReturnTable += fmt.Sprintf("%8d  %9.2f %8.1f %9.2f %9.2f     BUY\n",
			int64(simblock), DCRBalance, TicketsPurchased,
			TicketPrice, StakeRewardAtBlock(simblock))

		// Move forward to average vote
		simblock += (float64(exp.ChainParams.TicketMaturity) + float64(exp.MeanVotingBlocks))
		ReturnTable += fmt.Sprintf("%8d  %9.2f %8.1f %9.2f %9.2f    VOTE\n",
			int64(simblock), DCRBalance, TicketsPurchased,
			(TheoreticalTicketPrice(simblock) * TicketAdjustmentFactor), StakeRewardAtBlock(simblock))

		// Simulate return of funds
		DCRBalance += (TicketPrice * TicketsPurchased)

		// Simulate reward
		DCRBalance += (StakeRewardAtBlock(simblock) * TicketsPurchased)
		TicketsPurchased = 0

		// Move forward to coinbase maturity
		simblock += float64(exp.ChainParams.CoinbaseMaturity)

		ReturnTable += fmt.Sprintf("%8d  %9.2f %8.1f %9.2f %9.2f  REWARD\n",
			int64(simblock), DCRBalance, TicketsPurchased,
			(TheoreticalTicketPrice(simblock) * TicketAdjustmentFactor), StakeRewardAtBlock(simblock))

		// Need to receive funds before we can use them again so add 1 block
		simblock++
	}

	// Scale down to exactly 365 days
	SimulationReward := ((DCRBalance - StartingDCRBalance) / StartingDCRBalance) * 100
	ASR = (BlocksPerYear / (simblock - CurrentBlockNum)) * SimulationReward
	ReturnTable += fmt.Sprintf("ASR over 365 Days is %.2f.\n", ASR)
	return
}

func (exp *explorerUI) watchExchanges() {
	if exp.xcBot == nil {
		return
	}
	xcChans := exp.xcBot.UpdateChannels()

	sendXcUpdate := func(isFiat bool, token, pair string, updater *exchanges.ExchangeState) {
		xcState := exp.xcBot.State()
		update := &WebsocketExchangeUpdate{
			Updater: WebsocketMiniExchange{
				Token:        token,
				CurrencyPair: pair,
				Price:        updater.Price,
				Volume:       updater.Volume,
				Change:       updater.Change,
			},
			IsFiatIndex: isFiat,
			Index:       exp.xcBot.Index,
			Price:       xcState.Price,
			Volume:      xcState.Volume,
			Indices:     make(map[string]float64),
		}

		// Other DCR pairs should also provide an index price for the quote
		// asset.
		update.Indices[string(exchanges.BTCIndex)] = xcState.BtcPrice
		update.Indices[string(exchanges.USDTIndex)] = indexPrice(exchanges.USDTIndex, xcState.FiatIndices)

		select {
		case exp.wsHub.xcChan <- update:
		default:
			log.Warnf("Failed to send WebsocketExchangeUpdate on WebsocketHub channel")
		}
	}

	for {
		select {
		case update := <-xcChans.Exchange:
			sendXcUpdate(false, update.Token, string(update.CurrencyPair), update.State)
		case update := <-xcChans.Index:
			currencyIndices, found := exp.xcBot.State().FiatIndices[update.Token]
			if !found {
				log.Error("Index state not found when preparing websocket update")
				continue
			}

			indexState, found := currencyIndices[update.CurrencyPair]
			if !found {
				log.Errorf("Index state not found for %s when preparing websocket update", update.CurrencyPair)
				continue
			}

			sendXcUpdate(true, update.Token, string(update.CurrencyPair), indexState)

		case <-xcChans.Quit:
			log.Warnf("ExchangeBot has quit.")
			return
		case <-exp.xcDone:
			return
		}
	}
}

func (exp *explorerUI) getExchangeState() *exchanges.ExchangeBotState {
	if exp.xcBot == nil || exp.xcBot.IsFailed() {
		return nil
	}
	return exp.xcBot.State()
}

// mempoolTime is the TimeDef that the transaction was received in DCRData, or
// else a zero-valued TimeDef if no transaction is found.
func (exp *explorerUI) mempoolTime(txid string) types.TimeDef {
	exp.invsMtx.RLock()
	defer exp.invsMtx.RUnlock()
	tx, found := exp.invs.Tx(txid)
	if !found {
		return types.NewTimeDefFromUNIX(0)
	}
	return types.NewTimeDefFromUNIX(tx.Time)
}

// indexPrice is calculates the aggregate index price across all exchanges.
func indexPrice(index exchanges.CurrencyPair, indices map[string]map[exchanges.CurrencyPair]*exchanges.ExchangeState) float64 {
	var price, nSources float64
	for _, currecncyIndices := range indices {
		for pair, state := range currecncyIndices {
			if pair == index {
				price += state.Price
				nSources++
			}
		}
	}
	if nSources == 0 {
		return 0
	}
	return price / nSources
}

const letters = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
const nLetters = len(letters)

// generateRandomString creates a random alphanumeric string of length 16.
func generateRandomString() string {
	bytes := make([]byte, 16)
	for i := range bytes {
		num, _ := rand.Int(rand.Reader, big.NewInt(int64(nLetters)))
		bytes[i] = letters[num.Int64()]
	}
	return string(bytes)
}

// tcBytes is the maximum block size in bytes used as Total Capacity for all
// fill-bar ratio computations. VAR is guaranteed 10% of TC; all active SKA
// types share the remaining 90% equally.
const tcBytes = 393216.0

// computeCoinFills derives per-coin fill bar data from the mempool CoinStats
// map. VAR is always first in the returned slice; SKA types follow in ascending
// coin-type order. When stats is empty or nil a single VAR entry with all
// ratios at 0.0 and status "ok" is returned.
// issuedSKA is the set of all SKA coin types that have ever been issued on-chain
// (from SKACoinSupply). Coin types present in issuedSKA but absent from stats
// are included as zero-fill entries so their indicators are always visible.
//
//nolint:unparam // maxBlockSize comes from the node at runtime; test uses 100.0 for easy math.
func computeCoinFills(stats map[uint8]types.MempoolCoinStats, maxBlockSize float64, issuedSKA []uint8) ([]types.CoinFillData, float64, int) {
	varQuota := maxBlockSize * 0.10
	skaPool := maxBlockSize * 0.90

	// Collect and sort SKA coin-type keys for deterministic output order.
	// Seed from both the live mempool stats and the full issued set so that
	// coins with no current mempool activity still get a zero-fill entry.
	skaKeySet := make(map[int]struct{})
	for ct := range stats {
		if ct != 0 {
			skaKeySet[int(ct)] = struct{}{}
		}
	}
	for _, ct := range issuedSKA {
		skaKeySet[int(ct)] = struct{}{}
	}
	var skaKeys []int
	var totalSKASize float64
	for k := range skaKeySet {
		skaKeys = append(skaKeys, k)
		totalSKASize += float64(stats[uint8(k)].Size)
	}
	sort.Ints(skaKeys)
	numSKA := len(skaKeys)

	varSize := float64(0)
	if s, ok := stats[0]; ok {
		varSize = float64(s.Size)
	}
	totalUsed := varSize + totalSKASize
	totalFillRatio := totalUsed / maxBlockSize

	fillStatus := func(size, quota float64) string {
		switch {
		case size <= quota:
			return "ok"
		case totalUsed <= maxBlockSize:
			return "borrowing"
		default:
			return "full"
		}
	}

	extraOrOverflow := func(size, quota float64, status string) (extra, overflow float64) {
		if status == "borrowing" {
			extra = math.Min((size-quota)/maxBlockSize, 1.0)
		} else if status == "full" {
			overflow = math.Min((size-quota)/maxBlockSize, 1.0)
		}
		return
	}

	varStatus := fillStatus(varSize, varQuota)
	varExtra, varOverflow := extraOrOverflow(varSize, varQuota, varStatus)

	fills := make([]types.CoinFillData, 0, 1+numSKA)
	fills = append(fills, types.CoinFillData{
		Symbol:            "VAR",
		GQFillRatio:       math.Min(varSize/varQuota, 1.0),
		ExtraFillRatio:    varExtra,
		OverflowFillRatio: varOverflow,
		GQPositionRatio:   0.10,
		Status:            varStatus,
	})

	if numSKA == 0 {
		return fills, totalFillRatio, 0
	}

	perSKAQuota := skaPool / float64(numSKA)
	gqPos := 0.90 / float64(numSKA)

	for _, ct := range skaKeys {
		s := stats[uint8(ct)]
		size := float64(s.Size)
		status := fillStatus(size, perSKAQuota)
		extra, overflow := extraOrOverflow(size, perSKAQuota, status)
		fills = append(fills, types.CoinFillData{
			Symbol:            fmt.Sprintf("SKA%d", ct),
			GQFillRatio:       math.Min(size/perSKAQuota, 1.0),
			ExtraFillRatio:    extra,
			OverflowFillRatio: overflow,
			GQPositionRatio:   gqPos,
			Status:            status,
		})
	}
	return fills, totalFillRatio, numSKA
}
