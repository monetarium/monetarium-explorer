// Copyright (c) 2019-2021, The Decred developers
// See LICENSE for details.

package mempool

import (
	"time"

	apitypes "github.com/monetarium/monetarium-explorer/api/types"
	"github.com/monetarium/monetarium-node/chaincfg/chainhash"
	chainjson "github.com/monetarium/monetarium-node/rpc/jsonrpc/types"
)

// CollectState tracks collection state between mempool data refreshes.
type CollectState struct {
	CurrentHeight               uint32
	NumTicketPurchasesInMempool uint32
	LastCollectTime             time.Time
}

// BlockID provides basic identifying information about a block.
type BlockID struct {
	Hash   chainhash.Hash
	Height int64
	Time   int64
}

// MinableFeeInfo describes the ticket fees
type MinableFeeInfo struct {
	// All fees in mempool
	allFees     []float64
	allFeeRates []float64
	// The index of the 20th largest fee, or largest if number in mempool < 20
	lowestMineableIdx int
	// The corresponding fee (i.e. all[lowestMineableIdx])
	lowestMineableFee float64
	// A window of fees about lowestMineableIdx
	targetFeeWindow []float64
}

// TicketsDetails localizes apitypes.TicketsDetails
type TicketsDetails apitypes.TicketsDetails

// Below is the implementation of sort.Interface
// { Len(), Swap(i, j int), Less(i, j int) bool }. This implementation sorts
// the structure in ascending order

// Len returns the length of TicketsDetails
func (tix TicketsDetails) Len() int {
	return len(tix)
}

// Swap swaps TicketsDetails elements at i and j
func (tix TicketsDetails) Swap(i, j int) {
	tix[i], tix[j] = tix[j], tix[i]
}

// ByFeeRate models TicketsDetails sorted by fee rates
type ByFeeRate struct {
	TicketsDetails
}

// Less compares fee rates by rate_i < rate_j
func (tix ByFeeRate) Less(i, j int) bool {
	return tix.TicketsDetails[i].FeeRate < tix.TicketsDetails[j].FeeRate
}

// ByAbsoluteFee models TicketDetails sorted by fee
type ByAbsoluteFee struct {
	TicketsDetails
}

// Less compares fee rates by fee_i < fee_j
func (tix ByAbsoluteFee) Less(i, j int) bool {
	return tix.TicketsDetails[i].Fee < tix.TicketsDetails[j].Fee
}

// StakeData models info about ticket purchases in mempool
type StakeData struct {
	LatestBlock       BlockID
	Time              time.Time
	NumTickets        uint32
	NumVotes          uint32
	Ticketfees        *chainjson.TicketFeeInfoResult
	MinableFees       *MinableFeeInfo
	AllTicketsDetails TicketsDetails
	StakeDiff         float64
}

// Height returns the best block height at the time the mempool data was
// gathered.
func (m *StakeData) Height() uint32 {
	return uint32(m.LatestBlock.Height)
}

// Hash returns the best block hash at the time the mempool data was gathered.
func (m *StakeData) Hash() string {
	return m.LatestBlock.Hash.String()
}
