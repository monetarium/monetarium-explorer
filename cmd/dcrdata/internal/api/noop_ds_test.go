package api

import (
	"context"

	apitypes "github.com/monetarium/monetarium-explorer/api/types"
	"github.com/monetarium/monetarium-explorer/db/dbtypes"
	"github.com/monetarium/monetarium-node/chaincfg/chainhash"
	chainjson "github.com/monetarium/monetarium-node/rpc/jsonrpc/types"
	"github.com/monetarium/monetarium-node/wire"
)

// noopDS satisfies DataSource with zero-value returns. Embed and override only
// the methods needed by a specific test.
type noopDS struct{}

func (noopDS) GetHeight(_ context.Context) (int64, error)                         { return 0, nil }
func (noopDS) GetBestBlockHash(_ context.Context) (string, error)                 { return "", nil }
func (noopDS) GetBlockHash(_ context.Context, _ int64) (string, error)            { return "", nil }
func (noopDS) GetBlockHeight(_ context.Context, _ string) (int64, error)          { return 0, nil }
func (noopDS) GetBlockByHash(_ context.Context, _ string) (*wire.MsgBlock, error) { return nil, nil }
func (noopDS) SpendingTransaction(_ context.Context, _ string, _ uint32) (string, uint32, error) {
	return "", 0, nil
}
func (noopDS) SpendingTransactions(_ context.Context, _ string) ([]string, []uint32, []uint32, error) {
	return nil, nil, nil, nil
}
func (noopDS) AddressHistory(_ context.Context, _ string, _, _ int64, _ dbtypes.AddrTxnViewType) ([]*dbtypes.AddressRow, *dbtypes.AddressBalance, error) {
	return nil, nil, nil
}
func (noopDS) FillAddressTransactions(_ context.Context, _ *dbtypes.AddressInfo) error { return nil }
func (noopDS) AddressTransactionDetails(_ context.Context, _ string, _, _ int64, _ dbtypes.AddrTxnViewType) (*apitypes.Address, error) {
	return nil, nil
}
func (noopDS) AddressTotals(_ context.Context, _ string) (*apitypes.AddressTotals, error) {
	return nil, nil
}
func (noopDS) VotesInBlock(_ context.Context, _ string) (int16, error) { return 0, nil }
func (noopDS) TxHistoryData(_ context.Context, _ string, _ dbtypes.HistoryChart, _ dbtypes.TimeBasedGrouping) (*dbtypes.ChartsData, error) {
	return nil, nil
}
func (noopDS) TreasuryBalance(_ context.Context) (*dbtypes.TreasuryBalance, error) { return nil, nil }
func (noopDS) BinnedTreasuryIO(_ context.Context, _ dbtypes.TimeBasedGrouping) (*dbtypes.ChartsData, error) {
	return nil, nil
}
func (noopDS) TicketPoolVisualization(_ context.Context, _ dbtypes.TimeBasedGrouping) (*dbtypes.PoolTicketsData, *dbtypes.PoolTicketsData, *dbtypes.PoolTicketsData, int64, error) {
	return nil, nil, nil, 0, nil
}
func (noopDS) AgendaVotes(_ context.Context, _ string, _ int) (*dbtypes.AgendaVoteChoices, error) {
	return nil, nil
}
func (noopDS) AddressRowsCompact(_ context.Context, _ string) ([]*dbtypes.AddressRowCompact, error) {
	return nil, nil
}
func (noopDS) Height() int64                                     { return 0 }
func (noopDS) IsDCP0010Active(_ int64) bool                      { return false }
func (noopDS) IsDCP0011Active(_ int64) bool                      { return false }
func (noopDS) IsDCP0012Active(_ int64) bool                      { return false }
func (noopDS) AllAgendas() (map[string]dbtypes.MileStone, error) { return nil, nil }
func (noopDS) GetTicketInfo(_ context.Context, _ string) (*apitypes.TicketInfo, error) {
	return nil, nil
}
func (noopDS) PowerlessTickets(_ context.Context) (*apitypes.PowerlessTickets, error) {
	return nil, nil
}
func (noopDS) GetStakeInfoExtendedByHash(_ context.Context, _ string) *apitypes.StakeInfoExtended {
	return nil
}
func (noopDS) GetStakeInfoExtendedByHeight(_ context.Context, _ int) *apitypes.StakeInfoExtended {
	return nil
}
func (noopDS) GetPoolInfo(_ context.Context, _ int) *apitypes.TicketPoolInfo { return nil }
func (noopDS) GetPoolInfoRange(_ context.Context, _, _ int) []apitypes.TicketPoolInfo {
	return nil
}
func (noopDS) GetPoolValAndSizeRange(_ context.Context, _, _ int) ([]float64, []uint32) {
	return nil, nil
}
func (noopDS) GetPool(_ int64) ([]string, error)                        { return nil, nil }
func (noopDS) CurrentCoinSupply(_ context.Context) *apitypes.CoinSupply { return nil }
func (noopDS) GetHeader(_ int) *chainjson.GetBlockHeaderVerboseResult   { return nil }
func (noopDS) GetBlockHeaderByHash(_ context.Context, _ string) (*wire.BlockHeader, error) {
	return nil, nil
}
func (noopDS) GetBlockVerboseByHash(_ context.Context, _ string, _ bool) *chainjson.GetBlockVerboseResult {
	return nil
}
func (noopDS) GetAPITransaction(_ context.Context, _ *chainhash.Hash) *apitypes.Tx { return nil }
func (noopDS) GetTransactionHex(_ context.Context, _ *chainhash.Hash) string       { return "" }
func (noopDS) GetTrimmedTransaction(_ context.Context, _ *chainhash.Hash) *apitypes.TrimmedTx {
	return nil
}
func (noopDS) GetVoteInfo(_ context.Context, _ *chainhash.Hash) (*apitypes.VoteInfo, error) {
	return nil, nil
}
func (noopDS) GetVoteVersionInfo(_ context.Context, _ uint32) (*chainjson.GetVoteInfoResult, error) {
	return nil, nil
}
func (noopDS) GetStakeVersionsLatest(_ context.Context) (*chainjson.StakeVersions, error) {
	return nil, nil
}
func (noopDS) GetAllTxIn(_ context.Context, _ *chainhash.Hash) []*apitypes.TxIn   { return nil }
func (noopDS) GetAllTxOut(_ context.Context, _ *chainhash.Hash) []*apitypes.TxOut { return nil }
func (noopDS) GetTransactionsForBlockByHash(_ context.Context, _ string) *apitypes.BlockTransactions {
	return nil
}
func (noopDS) GetStakeDiffEstimates(_ context.Context) *apitypes.StakeDiff  { return nil }
func (noopDS) GetSummary(_ context.Context, _ int) *apitypes.BlockDataBasic { return nil }
func (noopDS) GetSummaryRange(_ context.Context, _, _ int) []*apitypes.BlockDataBasic {
	return nil
}
func (noopDS) GetSummaryRangeStepped(_ context.Context, _, _, _ int) []*apitypes.BlockDataBasic {
	return nil
}
func (noopDS) GetSummaryByHash(_ context.Context, _ string, _ bool) *apitypes.BlockDataBasic {
	return nil
}
func (noopDS) GetBestBlockSummary(_ context.Context) *apitypes.BlockDataBasic { return nil }
func (noopDS) GetBlockSize(_ context.Context, _ int) (int32, error)           { return 0, nil }
func (noopDS) GetBlockSizeRange(_ context.Context, _, _ int) ([]int32, error) { return nil, nil }
func (noopDS) GetSDiff(_ context.Context, _ int) float64                      { return 0 }
func (noopDS) GetSDiffRange(_ context.Context, _, _ int) []float64            { return nil }
func (noopDS) GetMempoolSSTxSummary() *apitypes.MempoolTicketFeeInfo          { return nil }
func (noopDS) GetMempoolSSTxFeeRates(_ int) *apitypes.MempoolTicketFees       { return nil }
func (noopDS) GetMempoolSSTxDetails(_ int) *apitypes.MempoolTicketDetails     { return nil }
func (noopDS) GetAddressTransactionsRawWithSkip(_ context.Context, _ string, _, _ int) []*apitypes.AddressTxRaw {
	return nil
}
func (noopDS) GetMempoolPriceCountTime() *apitypes.PriceCountTime { return nil }
