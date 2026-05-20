// Copyright (c) 2018-2021, The Decred developers
// Copyright (c) 2017, The dcrdata developers
// See LICENSE for details.

package types

import (
	"encoding/json"
	"fmt"
	"math"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/dustin/go-humanize"
	"github.com/monetarium/monetarium-explorer/db/dbtypes"
	"github.com/monetarium/monetarium-explorer/txhelpers"
	"github.com/monetarium/monetarium-node/blockchain/stake"
	"github.com/monetarium/monetarium-node/chaincfg"
	"github.com/monetarium/monetarium-node/dcrutil"
	chainjson "github.com/monetarium/monetarium-node/rpc/jsonrpc/types"
	"github.com/monetarium/monetarium-node/wire"
)

// Types of votes
const (
	VoteReject  = -1
	VoteAffirm  = 1
	VoteMissing = 0
)

// TimeDef is time.Time wrapper that formats time by default as a string without
// a timezone. The time Stringer interface formats the time into a string with a
// timezone.
type TimeDef struct {
	T time.Time
}

const (
	timeDefFmtHuman        = "2006-01-02 15:04:05 (MST)"
	timeDefFmtDateTimeNoTZ = "2006-01-02 15:04:05"
	timeDefFmtJS           = time.RFC3339
)

// String formats the time in a human-friendly layout. This ends up on the
// explorer web pages.
func (t TimeDef) String() string {
	return t.T.Format(timeDefFmtHuman)
}

// RFC3339 formats the time in a machine-friendly layout.
func (t TimeDef) RFC3339() string {
	return t.T.Format(timeDefFmtJS)
}

// UNIX returns the UNIX epoch time stamp.
func (t TimeDef) UNIX() int64 {
	return t.T.Unix()
}

func (t TimeDef) Format(layout string) string {
	return t.T.Format(layout)
}

// MarshalJSON implements json.Marshaler.
func (t *TimeDef) MarshalJSON() ([]byte, error) {
	return json.Marshal(t.RFC3339())
}

// UnmarshalJSON implements json.Unmarshaler.
func (t *TimeDef) UnmarshalJSON(data []byte) error {
	if t == nil {
		return fmt.Errorf("TimeDef: UnmarshalJSON on nil pointer")
	}
	tStr := string(data)
	tStr = strings.Trim(tStr, `"`)
	T, err := time.Parse(timeDefFmtJS, tStr)
	if err != nil {
		return err
	}
	t.T = T
	return nil
}

// PrettyMDY formats the time down to day only, using 3 day month, unpadded day,
// comma, and 4 digit year.
func (t *TimeDef) PrettyMDY() string {
	return t.T.Format("Jan 2, 2006")
}

// HMSTZ is the hour:minute:second with 3-digit timezone code.
func (t *TimeDef) HMSTZ() string {
	return t.T.Format("15:04:05 MST")
}

// DatetimeWithoutTZ formats the time in a human-friendly layout, without
// time zone.
func (t *TimeDef) DatetimeWithoutTZ() string {
	return t.T.Format(timeDefFmtDateTimeNoTZ)
}

// NewTimeDef constructs a TimeDef from the given time.Time. It presets the
// timezone for formatting to UTC.
func NewTimeDef(t time.Time) TimeDef {
	return TimeDef{
		T: t.UTC(),
	}
}

// NewTimeDefFromUNIX constructs a TimeDef from the given UNIX epoch time stamp
// in seconds. It presets the timezone for formatting to UTC.
func NewTimeDefFromUNIX(t int64) TimeDef {
	return NewTimeDef(time.Unix(t, 0))
}

// BlockBasic models data for the explorer's explorer page
type BlockBasic struct {
	Height         int64   `json:"height"`
	Hash           string  `json:"hash"`
	Version        int32   `json:"version"`
	Size           int32   `json:"size"`
	Valid          bool    `json:"valid"`
	MainChain      bool    `json:"mainchain"`
	Voters         uint16  `json:"votes"`
	Transactions   int     `json:"tx"`
	IndexVal       int64   `json:"windowIndex"`
	FreshStake     uint8   `json:"tickets"`
	Revocations    uint32  `json:"revocations"`
	TxCount        uint32  `json:"tx_count"`
	BlockTime      TimeDef `json:"time"`
	FormattedBytes string  `json:"formatted_bytes"`
	Total          float64 `json:"total"`
	// CoinRows holds per-coin row data for the expandable blocks table.
	// Populated when available; nil means VAR-only (use Total).
	CoinRows []CoinRowData `json:"coin_rows,omitempty"`
	// Flattened fields derived from CoinRows for template rendering.
	VARAmount  string
	VARTxCount int
	VARSize    string
	// SKAAmount holds the raw atom amount of the first SKA row in CoinRows.
	// Templates render the aggregate SKA cell via formatSKAAmountCell, which
	// uses SKAAmount only when len(SKASubRows) == 1.
	SKAAmount  string
	SKASubRows []SKASubRow
}

// FlattenCoinRows populates the template-facing flattened fields (VARAmount,
// VARTxCount, VARSize, SKAAmount, SKASubRows) from CoinRows. Call this after
// setting CoinRows.
func (b *BlockBasic) FlattenCoinRows() {
	for _, row := range b.CoinRows {
		if row.CoinType == 0 {
			b.VARAmount = row.Amount
			// Subtract votes, tickets, and revocations to get regular VAR txs.
			b.VARTxCount = row.TxCount - int(b.Voters) - int(b.FreshStake) - int(b.Revocations)
			if b.VARTxCount < 0 {
				b.VARTxCount = 0
			}
			b.VARSize = humanize.Bytes(uint64(row.Size))
		} else {
			b.SKASubRows = append(b.SKASubRows, SKASubRow{
				TokenType: row.Symbol,
				TxCount:   row.TxCount,
				Amount:    row.Amount,
				Size:      humanize.Bytes(uint64(row.Size)),
			})
			if b.SKAAmount == "" {
				b.SKAAmount = row.Amount
			}
		}
	}
}

// CoinTypeSymbol returns the display symbol for a coin type.
func CoinTypeSymbol(coinType uint8) string {
	if coinType == 0 {
		return "VAR"
	}
	return fmt.Sprintf("SKA%d", coinType)
}

// CoinTypeFromSymbol converts a display symbol back to coin type.
// Returns (0, false) for invalid symbols.
func CoinTypeFromSymbol(symbol string) (uint8, bool) {
	if symbol == "VAR" {
		return 0, true
	}
	if len(symbol) > 3 && symbol[:3] == "SKA" {
		n, err := strconv.Atoi(symbol[3:])
		if err == nil && n >= 1 && n <= 255 {
			return uint8(n), true
		}
	}
	return 0, false
}

// TotalSentByCoinFromMap converts a coin amount map to an ordered slice.
// VAR (0) is first, then SKA types in ascending order, zero-value SKA omitted.
func TotalSentByCoinFromMap(coinAmounts map[uint8]string, issuedSKA []uint8) []CoinAmount {
	if len(coinAmounts) == 0 {
		return nil
	}

	var result []CoinAmount

	// Add VAR first if present
	if amt, ok := coinAmounts[0]; ok {
		result = append(result, CoinAmount{CoinType: 0, Symbol: "VAR", Amount: amt})
	}

	// Collect and sort SKA types
	var skaTypes []uint8
	if len(issuedSKA) > 0 {
		skaTypes = make([]uint8, 0, len(issuedSKA))
		skaTypes = append(skaTypes, issuedSKA...)
	} else {
		// If no issuedSKA provided, derive from map keys
		for ct := range coinAmounts {
			if ct != 0 {
				skaTypes = append(skaTypes, ct)
			}
		}
	}
	sort.Slice(skaTypes, func(i, j int) bool { return skaTypes[i] < skaTypes[j] })

	// Add SKA types in sorted order, omitting zero values
	for _, ct := range skaTypes {
		if amt, ok := coinAmounts[ct]; ok && amt != "0" && amt != "" {
			result = append(result, CoinAmount{CoinType: ct, Symbol: CoinTypeSymbol(ct), Amount: amt})
		}
	}

	return result
}

// RegularCoinCountsFromCoinRows computes regular transaction counts per coin type.
// Regular = Total TxCount - Votes - Tickets - Revocations
func RegularCoinCountsFromCoinRows(rows []CoinRowData, voters uint16, freshStake uint8, revocations uint32) []CoinCount {
	if len(rows) == 0 {
		return nil
	}

	// Build map for quick lookup
	rowMap := make(map[uint8]CoinRowData)
	for _, r := range rows {
		rowMap[r.CoinType] = r
	}

	// Get sorted coin types present in rows
	var coinTypes []uint8
	for ct := range rowMap {
		coinTypes = append(coinTypes, ct)
	}
	sort.Slice(coinTypes, func(i, j int) bool { return coinTypes[i] < coinTypes[j] })

	var result []CoinCount

	for _, ct := range coinTypes {
		row := rowMap[ct]
		var regular int
		if ct == 0 {
			// VAR regular txs = total - votes - tickets - revocations
			regular = row.TxCount - int(voters) - int(freshStake) - int(revocations)
			if regular < 0 {
				regular = 0
			}
		} else {
			// SKA txs are not reduced by votes/tickets/revocations
			regular = row.TxCount
		}
		// Skip zero-count SKA entries
		if ct != 0 && regular == 0 {
			continue
		}
		result = append(result, CoinCount{CoinType: ct, Symbol: CoinTypeSymbol(ct), Count: regular})
	}

	return result
}

// FeesByCoinFromAmounts creates an ordered fee slice from a map of coin type -> fee atoms.
// VAR (0) fees come from MiningFee (sum of all VAR tx fees in the block).
// SKA fees come from SSFeeTotalsByCoin (total SKA atoms distributed via TxTypeSSFee per coin type,
// i.e., fees collected from SKA outputs being spent in the block).
// VAR (0) is first, then SKA types in ascending order, zero-value SKA omitted.
func FeesByCoinFromAmounts(feeAmounts map[uint8]string) []CoinAmount {
	if len(feeAmounts) == 0 {
		return nil
	}

	var result []CoinAmount

	// Add VAR first if present and non-zero
	if amt, ok := feeAmounts[0]; ok && amt != "0" && amt != "" {
		result = append(result, CoinAmount{CoinType: 0, Symbol: "VAR", Amount: amt})
	}

	// Collect and sort SKA types
	var skaTypes []uint8
	for ct := range feeAmounts {
		if ct != 0 {
			skaTypes = append(skaTypes, ct)
		}
	}
	sort.Slice(skaTypes, func(i, j int) bool { return skaTypes[i] < skaTypes[j] })

	// Add SKA types in sorted order, omitting zero values
	for _, ct := range skaTypes {
		if amt, ok := feeAmounts[ct]; ok && amt != "0" && amt != "" {
			result = append(result, CoinAmount{CoinType: ct, Symbol: CoinTypeSymbol(ct), Amount: amt})
		}
	}

	return result
}

// WebBasicBlock is used for quick DB data without rpc calls
type WebBasicBlock struct {
	Height      uint32   `json:"height"`
	Size        uint32   `json:"size"`
	Hash        string   `json:"hash"`
	Difficulty  float64  `json:"diff"`
	StakeDiff   float64  `json:"sdiff"`
	Time        int64    `json:"time"`
	NumTx       uint32   `json:"txlength"`
	PoolSize    uint32   `json:"poolsize"`
	PoolValue   float64  `json:"poolvalue"`
	PoolValAvg  float64  `json:"poolvalavg"`
	PoolWinners []string `json:"winners"`
}

// TxBasic models data for transactions on the block page
type TxBasic struct {
	TxID          string
	Type          string
	Version       int32
	FormattedSize string
	Total         float64        // Deprecated: use TotalRaw
	TotalRaw      string         // Atom string
	Fee           dcrutil.Amount // Deprecated: use FeeRaw
	FeeRaw        string         // Atom string
	FeeRate       dcrutil.Amount
	FeeRateRaw    string
	Size          int32
	*VoteInfo
	Coinbase     bool
	Treasurybase bool
	MixCount     uint32
	MixDenom     int64
	CoinType     uint8
	SKASent      map[uint8]string // Deprecated: use TotalRaw + CoinType
}

// TrimmedTxInfo for use with /visualblocks
type TrimmedTxInfo struct {
	*TxBasic
	Fees         float64
	VinCount     int
	VoutCount    int
	VoteValid    bool
	Voted        bool
	CoinType     uint8  // 0=VAR, 1-255=SKAn for stake fees; for revocations, set when processing
	TicketStatus string // Pool status for revocations: "voted", "missed", "expired"
}

// TxInfo models data needed for display on the tx page
type TxInfo struct {
	*TxBasic
	SpendingTxns     []TxInID
	Vin              []Vin
	Vout             []Vout
	BlockHeight      int64
	BlockIndex       uint32
	BlockHash        string
	BlockMiningFee   int64
	Confirmations    int64
	Time             TimeDef
	Mature           string
	VoteFundsLocked  string
	Maturity         int64   // Total number of blocks before mature
	MaturityTimeTill float64 // Time in hours until mature
	TSpendMeta       *dbtypes.TreasurySpendMetaData
	TicketInfo
}

// These are the text representations of the various special transaction types.
// These strings should match the strings returned by txhelpers.TxTypeToString.
const (
	TicketTypeStr   = "Ticket"
	VoteTypeStr     = "Vote"
	RevTypeStr      = "Revocation"
	CoinbaseTypeStr = "Coinbase"
	// What actually happens is treasuryadd burns coins and credits the treasury
	// account. treasuryspend creates coins and debits the treasury account.
	// treasurybase is analogous to a coinbase in that it credits the treasury
	// without spending/burning any coins (aka creates them out of thin air,
	// just like coinbases do).
	TreasurybaseTypeStr  = "Treasurybase"
	TreasuryAddTypeStr   = "Treasury Add"
	TreasurySpendTypeStr = "Treasury Spend"
)

// IsTicket checks whether this transaction is a ticket.
func (t *TxInfo) IsTicket() bool {
	return t.Type == TicketTypeStr
}

// IsVote checks whether this transaction is a vote.
func (t *TxInfo) IsVote() bool {
	return t.Type == VoteTypeStr
}

// IsTreasurySpend checks whether this transaction is a tspend.
func (t *TxInfo) IsTreasurySpend() bool {
	return t.Type == TreasurySpendTypeStr
}

// IsTreasurybase checks whether this transaction is a treasurybase.
func (t *TxInfo) IsTreasurybase() bool {
	return t.Type == TreasurybaseTypeStr
}

// IsTreasuryAdd checks whether this transaction is a tadd.
func (t *TxInfo) IsTreasuryAdd() bool {
	return t.Type == TreasuryAddTypeStr
}

// IsRevocation checks whether this transaction is a revocation.
func (t *TxInfo) IsRevocation() bool {
	return t.Type == RevTypeStr
}

// IsLiveTicket verifies the conditions: 1. is a ticket, 2. is mature,
// 3. hasn't voted, 4. isn't  expired.
func (t *TxInfo) IsLiveTicket() bool {
	return t.Type == TicketTypeStr && t.Mature == "True" && t.SpendStatus != "Voted" &&
		t.PoolStatus == "live" && t.TicketLiveBlocks < t.TicketExpiry
}

// IsExpiredTicket verifies the conditions: 1. is a ticket, 2. is mature,
// 3. hasn't voted, 4. is past expiration.
func (t *TxInfo) IsExpiredTicket() bool {
	return t.Type == TicketTypeStr && t.Mature == "True" && t.SpendStatus != "Voted" &&
		t.PoolStatus == "live" && t.TicketLiveBlocks >= t.TicketExpiry
}

// IsImmatureTicket verifies the conditions: 1. is a ticket, 2. is not mature.
func (t *TxInfo) IsImmatureTicket() bool {
	return t.Type == TicketTypeStr && t.Mature == "False"
}

// IsImmatureVote verifies the conditions: 1. is a vote, 2. is not mature.
func (t *TxInfo) IsImmatureVote() bool {
	return t.Type == VoteTypeStr && t.Mature == "False"
}

// IsImmatureCoinbase verifies the conditions: 1. is coinbase, 2. is not mature.
func (t *TxInfo) IsImmatureCoinbase() bool {
	return t.Type == CoinbaseTypeStr && t.Mature == "False"
}

// IsImmatureRevocation verifies the conditions: 1. is a revocation, 2. is not
// mature.
func (t *TxInfo) IsImmatureRevocation() bool {
	return t.Type == RevTypeStr && t.Mature == "False"
}

// IsImmature indicates if the transaction is immature
func (t *TxInfo) IsImmature() bool {
	return t.Mature == "False"
}

// BlocksToTicketMaturity will return 0 if this isn't an immature ticket.
func (t *TxInfo) BlocksToTicketMaturity() (blocks int64) {
	if t.Type != TicketTypeStr {
		return
	}
	if t.Mature == "True" {
		return
	}
	return t.TicketInfo.TicketMaturity + 1 - t.Confirmations
}

// TicketInfo is used to represent data shown for a sstx transaction.
type TicketInfo struct {
	TicketMaturity       int64
	TimeTillMaturity     float64 // Time before a particular ticket reaches maturity, in hours
	PoolStatus           string
	SpendStatus          string
	LotteryBlock         string  // If the ticket was chosen to vote, it was chosen to vote in this block.
	TicketPoolSize       int64   // Total number of ticket in the pool
	TicketExpiry         int64   // Total number of blocks before a ticket expires
	TicketExpiryDaysLeft float64 // Approximate days left before the given ticket expires
	TicketLiveBlocks     int64   // Total number of confirms after maturity and up until the point the ticket votes or expires
	BestLuck             int64   // Best possible Luck for voting
	AvgLuck              int64   // Average Luck for voting
	VoteLuck             float64 // Actual Luck for voting on a ticket
	LuckStatus           string  // Short description based on the VoteLuck
	Probability          float64 // Probability of success before ticket expires
}

// TxInID models the identity of a spending transaction input
type TxInID struct {
	Hash  string
	Index uint32
}

// TSpendVote describes how a SSGen transaction decided on a tspend.
type TSpendVote struct {
	TSpend string `json:"tspend"`
	Choice string `json:"choice"`
}

// VoteInfo models data about a SSGen transaction (vote)
type VoteInfo struct {
	Validation         BlockValidation         `json:"block_validation"`
	Version            uint32                  `json:"vote_version"`
	Bits               uint16                  `json:"vote_bits"`
	Choices            []*txhelpers.VoteChoice `json:"vote_choices"`
	TicketSpent        string                  `json:"ticket_spent"`
	MempoolTicketIndex int                     `json:"mempool_ticket_index"`
	ForLastBlock       bool                    `json:"last_block"`
	TSpends            []*TSpendVote           `json:"tspend_votes,omitempty"`
}

func (vi *VoteInfo) DeepCopy() *VoteInfo {
	if vi == nil {
		return nil
	}
	out := *vi
	out.Choices = make([]*txhelpers.VoteChoice, len(vi.Choices))
	copy(out.Choices, vi.Choices)
	return &out
}

// ConvertTSpendVotes converts into the api's TSpendVote format.
func ConvertTSpendVotes(tspendChoices []*txhelpers.TSpendVote) []*TSpendVote {
	choiceStr := func(choice uint8) string {
		switch stake.TreasuryVoteT(choice) {
		case stake.TreasuryVoteYes:
			return "yes"
		case stake.TreasuryVoteNo:
			return "no"
		default:
			return "invalid"
		}
	}
	tspendVotes := make([]*TSpendVote, len(tspendChoices))
	for i := range tspendChoices {
		tspendVotes[i] = &TSpendVote{
			TSpend: tspendChoices[i].TSpend.String(),
			Choice: choiceStr(tspendChoices[i].Choice),
		}
	}
	return tspendVotes
}

// BlockValidation models data about a vote's decision on a block
type BlockValidation struct {
	Hash     string `json:"hash"`
	Height   int64  `json:"height"`
	Validity bool   `json:"validity"`
}

// SetTicketIndex assigns the VoteInfo an index based on the block that the vote
// is (in)validating and the spent ticket hash. The ticketSpendInds tracks
// known combinations of target block and spent ticket hash. This index is used
// for sorting in views and counting total unique votes for a block.
func (vi *VoteInfo) SetTicketIndex(ticketSpendInds BlockValidatorIndex) {
	// One-based indexing
	startInd := 1
	// Reference the sub-index for the block being (in)validated by this vote.
	if idxs, ok := ticketSpendInds[vi.Validation.Hash]; ok {
		// If this ticket has been seen before voting on this block, set the
		// known index. Otherwise, assign the next index in the series.
		if idx, ok := idxs[vi.TicketSpent]; ok {
			vi.MempoolTicketIndex = idx
		} else {
			idx := len(idxs) + startInd
			idxs[vi.TicketSpent] = idx
			vi.MempoolTicketIndex = idx
		}
	} else {
		// First vote encountered for this block. Create new ticket sub-index.
		ticketSpendInds[vi.Validation.Hash] = TicketIndex{
			vi.TicketSpent: startInd,
		}
		vi.MempoolTicketIndex = startInd
	}
}

// VotesOnBlock indicates if the vote is voting on the validity of block
// specified by the given hash.
func (vi *VoteInfo) VotesOnBlock(blockHash string) bool {
	return vi.Validation.ForBlock(blockHash)
}

// ForBlock indicates if the validation choice is for the specified block.
func (v *BlockValidation) ForBlock(blockHash string) bool {
	return blockHash != "" && blockHash == v.Hash
}

// Vin models basic data about a tx input for display
type Vin struct {
	*chainjson.Vin
	Addresses       []string
	FormattedAmount string
	ValueRaw        string // Atom string
	Index           uint32
	DisplayText     string
	TextIsHash      bool
	Link            string
	CoinType        uint8
	SKAValue        string
}

// Vout models basic data about a tx output for display
type Vout struct {
	Addresses       []string
	Amount          float64 // Deprecated: use SKAValue or ValueRaw
	ValueRaw        string  // Atom string
	FormattedAmount string
	Type            string
	Spent           bool
	OP_RETURN       string
	OP_TADD         bool
	Index           uint32
	Version         uint16
	CoinType        uint8
	SKAValue        string
}

// CoinRowData holds per-coin summary data for the expandable blocks table.
type CoinRowData struct {
	CoinType uint8  `json:"coin_type"`
	Symbol   string `json:"symbol"`
	TxCount  int    `json:"tx_count"`
	Amount   string `json:"amount"`
	Size     uint32 `json:"size"`
}

// SKASubRow holds per-SKA-type data for the accordion sub-rows in the block table.
type SKASubRow struct {
	TokenType string
	TxCount   int
	Amount    string
	Size      string
}

// VARCoinSupply holds VAR circulating supply and target cap.
type VARCoinSupply struct {
	Circulating string `json:"circulating"` // 15+18 decimal string (from RPC)
	Target      string `json:"target"`      // from chain params.MaxSupply (exact value)
}

// SKACoinSupplyEntry holds per-SKA-type supply data.
type SKACoinSupplyEntry struct {
	CoinType      uint8  `json:"coin_type"`      // SKAn identifier (1, 2, ...)
	InCirculation string `json:"in_circulation"` // big.Int atom string
	TotalIssued   string `json:"total_issued"`   // big.Int atom string
	TotalBurned   string `json:"total_burned"`   // big.Int atom string (placeholder: "0")
}

// CoinFillData holds per-coin mempool fill bar data.
type CoinFillData struct {
	Symbol            string  `json:"symbol"`
	GQFillRatio       float64 `json:"gq_fill_ratio"`       // 0.0–1.0, fraction of coin's Guaranteed Quota consumed
	ExtraFillRatio    float64 `json:"extra_fill_ratio"`    // 0.0–1.0, fraction of TC consumed beyond quota (borrowing only)
	OverflowFillRatio float64 `json:"overflow_fill_ratio"` // 0.0–1.0, fraction of TC that cannot fit (full only)
	GQPositionRatio   float64 `json:"gq_position_ratio"`   // 0.0–1.0, quota boundary position as fraction of TC
	Status            string  `json:"status"`              // "ok", "borrowing", "full"
	// PctOfTC is the displayed percentage label for the bar, expressed as
	// percent of the max block size. NOT clamped: a coin whose mempool
	// transactions exceed the block size renders e.g. 115.0%. Equals
	// (GQFillRatio*GQPositionRatio + ExtraFillRatio + OverflowFillRatio) * 100.
	PctOfTC float64 `json:"pct_of_tc"`
	// IsOverflow is true when the coin's actual usage exceeds total block
	// capacity (i.e. the unclamped sum above is > 1.0). Drives the hatch
	// overlay on the fill bar, mirroring TotalFillRatio's overflow indicator.
	IsOverflow bool `json:"is_overflow"`
}

// MempoolCoinStats holds per-coin mempool transaction count, size, and amount.
// Per-type *Amount fields use atom-string semantics matching Amount: VAR is an
// int64-derived decimal string, SKA is a big.Int decimal string. For SKA coins
// only RegularAmount is ever non-zero (SKA cannot be ticket/vote/revoke).
type MempoolCoinStats struct {
	TxCount       int    `json:"tx_count"`
	Size          int32  `json:"size"`
	Amount        string `json:"amount"` // VAR: int64 atom string; SKA: big.Int atom string
	RegularCount  int    `json:"regular_count"`
	RegularAmount string `json:"regular_amount"`
	TicketCount   int    `json:"ticket_count"`
	TicketAmount  string `json:"ticket_amount"`
	VoteCount     int    `json:"vote_count"`
	VoteAmount    string `json:"vote_amount"`
	RevokeCount   int    `json:"revoke_count"`
	RevokeAmount  string `json:"revoke_amount"`
}

// TrimmedBlockInfo models data needed to display block info on the new home page
type TrimmedBlockInfo struct {
	Time              TimeDef
	Height            int64
	Total             float64
	Fees              float64
	Subsidy           *chainjson.GetBlockSubsidyResult
	Votes             []*TrimmedTxInfo
	Tickets           []*TrimmedTxInfo
	Revocations       []*TrimmedTxInfo
	Transactions      []*TrimmedTxInfo
	CoinRows          []CoinRowData
	Size              int32          `json:"size"`
	FormattedBytes    string         `json:"formatted_bytes"`
	CoinFills         []CoinFillData `json:"coin_fills,omitempty"`
	ActiveSKACount    int            `json:"active_ska_count"`
	RegularCoinCounts []CoinCount    `json:"regular_coin_counts,omitempty"`
	MaxBlockSize      float64        `json:"max_block_size"`
}

// BlockInfo models data for display on the block page
type BlockInfo struct {
	*BlockBasic
	Confirmations         int64
	PoWHash               string
	StakeRoot             string
	MerkleRoot            string
	TxAvailable           bool
	Tx                    []*TrimmedTxInfo
	Treasury              []*TrimmedTxInfo
	Tickets               []*TrimmedTxInfo
	Revs                  []*TrimmedTxInfo
	Votes                 []*TrimmedTxInfo
	StakeFees             []*TrimmedTxInfo
	Misses                []string
	Nonce                 uint32
	VoteBits              uint16
	FinalState            string
	PoolSize              uint32
	Bits                  string
	SBits                 float64
	Difficulty            float64
	ExtraData             string
	StakeVersion          uint32
	PreviousHash          string
	NextHash              string
	TotalSent             float64
	MiningFee             float64
	StakeValidationHeight int64
	Subsidy               *chainjson.GetBlockSubsidyResult
	SKAPoWRewards         []PoWSKAReward `json:"pow_ska_rewards,omitempty"`
	// CoinAmounts holds per-coin totals (VAR key=0, SKAn key=n) as decimal atom strings.
	CoinAmounts map[uint8]string `json:"coin_amounts,omitempty"`
	// TotalSentByCoin is an ordered slice of total sent amounts per coin type,
	// for template rendering. VAR (0) first, then SKA types in ascending order,
	// with zero-value SKA entries omitted.
	TotalSentByCoin []CoinAmount `json:"-"`
	// RegularCoinCounts is an ordered slice of regular transaction counts per coin type,
	// for template rendering. Same ordering as TotalSentByCoin.
	RegularCoinCounts []CoinCount `json:"regular_coin_counts"`
	// FeesByCoin is an ordered slice of fees per coin type, for template rendering.
	// VAR fees are total transaction fees in the block; SKA fees are SSFee distribution amounts
	// (total SKA atoms distributed via TxTypeSSFee per coin type, i.e., fees collected from SKA outputs).
	// Same ordering as TotalSentByCoin.
	FeesByCoin     []CoinAmount   `json:"-"`
	CoinFills      []CoinFillData `json:"coin_fills,omitempty"`
	ActiveSKACount int            `json:"active_ska_count"`
	MaxBlockSize   float64        `json:"max_block_size"`
}

// CoinAmount represents an amount for a specific coin type.
type CoinAmount struct {
	CoinType uint8  `json:"coin_type"`        // 0=VAR, 1-255=SKAn
	Symbol   string `json:"symbol,omitempty"` // Display label: "VAR", "SKA1", etc. (optional, for templates)
	Amount   string `json:"amount"`           // big.Int atom string (18 decimal places for SKA)
}

// CoinCount represents a transaction count for a specific coin type.
type CoinCount struct {
	CoinType uint8  `json:"coin_type"`        // 0=VAR, 1-255=SKAn
	Symbol   string `json:"symbol,omitempty"` // Display label (optional)
	Count    int    `json:"count"`
}

// Conversion is a representation of some amount of DCR in another index.
type Conversion struct {
	Value float64 `json:"value"`
	Index string  `json:"index"`
}

// SKAVoteReward holds per-SKA-type staker reward rates expressed as SKA atoms per VAR atom.
type SKAVoteReward struct {
	CoinType    uint8  `json:"coin_type"`
	Symbol      string `json:"symbol"`
	PerBlock    string `json:"per_block"` // SKA/VAR ratio for last block, big.Int atom string (18dp)
	PerYear     string `json:"per_year"`  // annualised average, big.Int atom string (18dp)
	BlockHeight int64  `json:"block_height,omitempty"`
}

// VoteVARReward holds the VAR staker reward rate expressed as VAR earned per
// VAR staked (i.e. reward/ticketPrice) for last block, 30-day, and yearly.
type VoteVARReward struct {
	PerBlock float64 `json:"per_block"` // VAR/VAR for the last block
	Subsidy  float64 `json:"subsidy"`   // subsidy portion per vote
	Fee      float64 `json:"fee"`       // fee portion per vote
	ROI      float64 `json:"roi"`       // extrapolated annual ROI %
}

// PoWSKAReward holds the PoW mining reward for a single SKA coin type.
type PoWSKAReward struct {
	CoinType    uint8  `json:"coin_type"`
	Symbol      string `json:"symbol"`
	Amount      string `json:"amount"`
	BlockHeight int64  `json:"block_height,omitempty"`
}

// HomeInfo represents data used for the home page
type HomeInfo struct {
	CoinSupply            int64                `json:"coin_supply"`
	StakeDiff             float64              `json:"sdiff"`
	NextExpectedStakeDiff float64              `json:"next_expected_sdiff"`
	NextExpectedBoundsMin float64              `json:"next_expected_min"`
	NextExpectedBoundsMax float64              `json:"next_expected_max"`
	IdxBlockInWindow      int                  `json:"window_idx"`
	IdxInRewardWindow     int                  `json:"reward_idx"`
	Difficulty            float64              `json:"difficulty"`
	RewardPeriod          string               `json:"reward_period"`
	NBlockSubsidy         BlockSubsidy         `json:"subsidy"`
	MiningFeeAtoms        int64                `json:"mining_fee_atoms"`
	LBlockTotal           float64              `json:"lblock_total"`
	LBlockTotalAtoms      int64                `json:"lblock_total_atoms"`
	Params                ChainParams          `json:"params"`
	PoolInfo              TicketPoolInfo       `json:"pool_info"`
	TotalLockedVAR        float64              `json:"total_locked_var"`
	HashRate              float64              `json:"hash_rate"`
	HashRateChangeDay     float64              `json:"hash_rate_change_day"`
	HashRateChangeMonth   float64              `json:"hash_rate_change_month"`
	ExchangeRate          *Conversion          `json:"exchange_rate,omitempty"`
	VoteVARReward         VoteVARReward        `json:"vote_var_reward"`
	SKAVoteRewards        []SKAVoteReward      `json:"ska_vote_rewards,omitempty"`
	PoWSKARewards         []PoWSKAReward       `json:"pow_ska_rewards,omitempty"`
	VARCoinSupply         *VARCoinSupply       `json:"var_coin_supply,omitempty"`
	SKACoinSupply         []SKACoinSupplyEntry `json:"ska_coin_supply,omitempty"`
}

// BlockSubsidy is an implementation of chainjson.GetBlockSubsidyResult
type BlockSubsidy struct {
	Total int64 `json:"total"`
	PoW   int64 `json:"pow"`
	PoS   int64 `json:"pos"`
	Dev   int64 `json:"dev"`
}

// TrimmedMempoolInfo is mempool data for the home page.
type TrimmedMempoolInfo struct {
	Transactions   []*TrimmedTxInfo
	Tickets        []*TrimmedTxInfo
	Votes          []*TrimmedTxInfo
	Revocations    []*TrimmedTxInfo
	TSpends        []*TrimmedTxInfo
	TAdds          []*TrimmedTxInfo
	Subsidy        BlockSubsidy
	Total          float64
	Time           int64
	Fees           float64
	CoinFills      []CoinFillData             `json:"coin_fills,omitempty"`
	TotalFillRatio float64                    `json:"total_fill_ratio"`
	ActiveSKACount int                        `json:"active_ska_count"`
	CoinStats      map[uint8]MempoolCoinStats `json:"coin_stats,omitempty"`
	MaxBlockSize   float64                    `json:"max_block_size"`
	TotalSize      int32                      `json:"total_size"`
}

// MempoolInfo models data to update mempool info on the home page.
type MempoolInfo struct {
	sync.RWMutex
	MempoolShort
	Transactions []MempoolTx `json:"tx"`
	Tickets      []MempoolTx `json:"tickets"`
	Votes        []MempoolTx `json:"votes"`
	Revocations  []MempoolTx `json:"revs"`
	TSpends      []MempoolTx `json:"tspends"`
	TAdds        []MempoolTx `json:"tadds"`
	Ident        uint64      `json:"id"`
	// CoinFills holds per-coin mempool fill bar data for the homepage.
	CoinFills []CoinFillData `json:"coin_fills,omitempty"`
}

// DeepCopy makes a deep copy of MempoolInfo, where all the slice and map data
// are copied over.
func (mpi *MempoolInfo) DeepCopy() *MempoolInfo {
	if mpi == nil {
		return nil
	}

	mpi.RLock()
	defer mpi.RUnlock()

	out := new(MempoolInfo)
	out.Transactions = CopyMempoolTxSlice(mpi.Transactions)
	out.Tickets = CopyMempoolTxSlice(mpi.Tickets)
	out.Votes = CopyMempoolTxSlice(mpi.Votes)
	out.Revocations = CopyMempoolTxSlice(mpi.Revocations)
	out.TSpends = CopyMempoolTxSlice(mpi.TSpends)
	out.TAdds = CopyMempoolTxSlice(mpi.TAdds)

	mps := mpi.MempoolShort.DeepCopy()
	out.MempoolShort = *mps

	return out
}

// Trim converts the MempoolInfo to TrimmedMempoolInfo.
func (mpi *MempoolInfo) Trim(maxBlockSize float64) *TrimmedMempoolInfo {
	mpi.RLock()
	defer mpi.RUnlock()

	mempoolRegularTxs := TrimMempoolTxs(mpi.Transactions)
	mempoolVotes := TrimMempoolTxs(mpi.Votes)

	data := &TrimmedMempoolInfo{
		Transactions:   FilterRegularTx(mempoolRegularTxs),
		Tickets:        TrimMempoolTxs(mpi.Tickets),
		Votes:          FilterUniqueLastBlockVotes(mempoolVotes),
		Revocations:    TrimMempoolTxs(mpi.Revocations),
		TSpends:        TrimMempoolTxs(mpi.TSpends),
		TAdds:          TrimMempoolTxs(mpi.TAdds),
		Total:          mpi.TotalOut,
		Time:           mpi.LastBlockTime,
		CoinFills:      mpi.MempoolShort.CoinFills,
		TotalFillRatio: mpi.MempoolShort.TotalFillRatio,
		ActiveSKACount: mpi.MempoolShort.ActiveSKACount,
		CoinStats:      mpi.MempoolShort.CoinStats,
		MaxBlockSize:   maxBlockSize,
		TotalSize:      mpi.MempoolShort.TotalSize,
	}

	// Calculate total fees for all mempool transactions.
	getTotalFee := func(txs []*TrimmedTxInfo) dcrutil.Amount {
		var sum dcrutil.Amount
		for _, tx := range txs {
			sum += tx.TxBasic.Fee
		}
		return sum
	}

	allFees := getTotalFee(data.Transactions) + getTotalFee(data.Revocations) +
		getTotalFee(data.Tickets) + getTotalFee(data.Votes)
	data.Fees = allFees.ToCoin()

	return data
}

// getTxFromList is a helper function for searching the MempoolInfo tx lists.
func getTxFromList(txid string, txns []MempoolTx) (MempoolTx, bool) {
	for idx := range txns {
		if txns[idx].TxID == txid {
			return txns[idx], true
		}
	}
	return MempoolTx{}, false
}

// Spenders searches all transaction lists in MempoolInfo for transactions
// spending from the specified funding transaction. It returns a map of funding
// output indexes to the spending transaction identify (hash and input index).
func (mpi *MempoolInfo) Spenders(fundingTxID string) map[uint32]TxInID {
	mpi.RLock()
	defer mpi.RUnlock()
	spenders := make(map[uint32]TxInID)
	search := func(txns []MempoolTx) {
		for _, tx := range txns {
			for i, vin := range tx.Vin {
				if vin.TxId == fundingTxID {
					spenders[vin.Outdex] = TxInID{
						Hash:  tx.TxID,
						Index: uint32(i),
					}
				}
			}
		}
	}
	search(mpi.Transactions)
	search(mpi.Tickets)
	search(mpi.Votes)
	search(mpi.Revocations)
	search(mpi.TSpends)
	search(mpi.TAdds)
	return spenders
}

// Tx checks the inventory and searches the appropriate lists for a
// transaction matching the provided transaction ID.
func (mpi *MempoolInfo) Tx(txid string) (MempoolTx, bool) {
	mpi.RLock()
	defer mpi.RUnlock()
	_, found := mpi.InvRegular[txid]
	if found {
		return getTxFromList(txid, mpi.Transactions)
	}
	_, found = mpi.InvStake[txid]
	if found {
		tx, found := getTxFromList(txid, mpi.Tickets)
		if found {
			return tx, true
		}
		tx, found = getTxFromList(txid, mpi.Votes)
		if found {
			return tx, true
		}
		tx, found = getTxFromList(txid, mpi.TAdds)
		if found {
			return tx, true
		}
		tx, found = getTxFromList(txid, mpi.TSpends)
		if found {
			return tx, true
		}
		return getTxFromList(txid, mpi.Revocations)
	}
	return MempoolTx{}, false
}

// ID can be used to track state changes.
func (mpi *MempoolInfo) ID() uint64 {
	mpi.RLock()
	defer mpi.RUnlock()
	return mpi.Ident
}

// FilterRegularTx returns a slice of all the regular (non-stake) transactions
// in the input slice, excluding coinbase (reward) transactions.
func FilterRegularTx(txs []*TrimmedTxInfo) (transactions []*TrimmedTxInfo) {
	for _, tx := range txs {
		if !tx.Coinbase {
			transactions = append(transactions, tx)
		}
	}
	return transactions
}

func BytesString(s uint64) string {
	if s < 1000 {
		return fmt.Sprintf("%d B", s)
	}
	e := math.Min(3, math.Floor(math.Log(float64(s))/math.Log(1000)))
	suffix := []string{"B", "kB", "MB", "GB"}[int(e)]
	val := math.Round(float64(s)/math.Pow(1000, e)*10) / 10
	f := "%.0f %s"
	if val < 10 {
		f = "%.1f %s"
	}

	return fmt.Sprintf(f, val, suffix)
}

// TrimMempoolTxs converts the input []MempoolTx to a []*TrimmedTxInfo.
func TrimMempoolTxs(txs []MempoolTx) []*TrimmedTxInfo {
	trimmedTxs := make([]*TrimmedTxInfo, 0, len(txs))
	for _, tx := range txs {
		trimmedTxs = append(trimmedTxs, TrimMempoolTx(&tx))
	}
	return trimmedTxs
}

// primaryCoinType extracts the coin type from a mempool transaction's SKATotals map.
// INVARIANT: A mempool transaction contains outputs of exactly one coin type
// (either VAR with no SKATotals, or exactly one SKA coin type). This function
// returns the coin type found, or 0 for VAR (empty SKATotals map).
func primaryCoinType(tx *MempoolTx) uint8 {
	for ct := range tx.SKATotals {
		return ct
	}
	return 0
}

// TrimMempoolTx converts the input MempoolTx to a TrimmedTxInfo for display.
func TrimMempoolTx(tx *MempoolTx) (trimmedTx *TrimmedTxInfo) {
	fee, _ := dcrutil.NewAmount(tx.Fees) // non-nil error returns 0 fee
	var feeRate dcrutil.Amount
	if tx.Size > 0 {
		feeRate = fee / dcrutil.Amount(int64(tx.Size))
	}
	coinType := primaryCoinType(tx)
	txBasic := &TxBasic{
		TxID:          tx.TxID,
		Type:          tx.Type,
		Version:       tx.Version,
		FormattedSize: BytesString(uint64(tx.Size)),
		Total:         tx.TotalOut,
		Fee:           fee,
		FeeRate:       feeRate,
		VoteInfo:      tx.VoteInfo,
		CoinType:      coinType,
		SKASent:       tx.SKATotals,
		// TreasuryBase and Coinbase are not in mempool
	}
	var voteValid bool
	if tx.VoteInfo != nil {
		voteValid = tx.VoteInfo.Validation.Validity
	}
	return &TrimmedTxInfo{
		TxBasic:   txBasic,
		Fees:      tx.Fees,
		VoteValid: voteValid,
		Voted:     tx.VoteInfo != nil,
		VinCount:  tx.VinCount,
		VoutCount: tx.VoutCount,
	}
}

// FilterUniqueLastBlockVotes returns a slice of all the vote transactions from
// the input slice that are flagged as voting on the previous block.
func FilterUniqueLastBlockVotes(txs []*TrimmedTxInfo) (votes []*TrimmedTxInfo) {
	seenVotes := make(map[string]struct{})
	for _, tx := range txs {
		if tx.VoteInfo != nil && tx.VoteInfo.ForLastBlock {
			// Do not append duplicates.
			if _, seen := seenVotes[tx.TxID]; seen {
				continue
			}
			votes = append(votes, tx)
			seenVotes[tx.TxID] = struct{}{}
		}
	}
	return votes
}

// TicketIndex is used to assign an index to a ticket hash.
type TicketIndex map[string]int

// BlockValidatorIndex keeps a list of arbitrary indexes for unique combinations
// of block hash and the ticket being spent to validate the block, i.e.
// map[validatedBlockHash]map[ticketHash]index.
type BlockValidatorIndex map[string]TicketIndex

// MempoolShort represents the mempool data sent as the mempool update
type MempoolShort struct {
	LastBlockHeight    int64               `json:"block_height"`
	LastBlockHash      string              `json:"block_hash"`
	LastBlockTime      int64               `json:"block_time"`
	FormattedBlockTime string              `json:"formatted_block_time"`
	Time               int64               `json:"time"`
	TotalOut           float64             `json:"total"`
	TotalSize          int32               `json:"size"`
	NumTickets         int                 `json:"num_tickets"`
	NumVotes           int                 `json:"num_votes"`
	NumRegular         int                 `json:"num_regular"`
	NumRevokes         int                 `json:"num_revokes"`
	NumTSpends         int                 `json:"num_tspends"`
	NumTAdds           int                 `json:"num_tadds"`
	NumAll             int                 `json:"num_all"`
	LikelyMineable     LikelyMineable      `json:"likely_mineable"`
	LatestTransactions []MempoolTx         `json:"latest"`
	FormattedTotalSize string              `json:"formatted_size"`
	TicketIndexes      BlockValidatorIndex `json:"-"`
	VotingInfo         VotingInfo          `json:"voting_info"`
	InvRegular         map[string]struct{} `json:"-"`
	InvStake           map[string]struct{} `json:"-"`
	// CoinStats holds per-coin tx count, size, and amount for all mempool txs.
	CoinStats map[uint8]MempoolCoinStats `json:"coin_stats,omitempty"`
	// CoinFills holds pre-computed per-coin fill bar data broadcast via WebSocket.
	CoinFills []CoinFillData `json:"coin_fills,omitempty"`
	// TotalFillRatio is the ratio of total mempool bytes to TC (unclamped).
	TotalFillRatio float64 `json:"total_fill_ratio"`
	// ActiveSKACount is the number of distinct SKA token types in CoinFills.
	ActiveSKACount int `json:"active_ska_count"`
}

// LikelyMineable holds the totals for all mempool transactions except for votes
// on non-tip blocks and multiple votes that spend the same ticket.
type LikelyMineable struct {
	Total         float64 `json:"total"`
	Size          int32   `json:"size"`
	FormattedSize string  `json:"formatted_size"`
	RegularTotal  float64 `json:"regular_total"`
	TicketTotal   float64 `json:"ticket_total"`
	VoteTotal     float64 `json:"vote_total"`
	RevokeTotal   float64 `json:"revoke_total"`
	TSpendTotal   float64 `json:"tspend_total"`
	TAddTotal     float64 `json:"tadd_total"`
	Count         int     `json:"count"`
}

func (mps *MempoolShort) DeepCopy() *MempoolShort {
	if mps == nil {
		return nil
	}

	out := &MempoolShort{
		LastBlockHash:      mps.LastBlockHash,
		LastBlockHeight:    mps.LastBlockHeight,
		LastBlockTime:      mps.LastBlockTime,
		FormattedBlockTime: mps.FormattedBlockTime,
		Time:               mps.Time,
		TotalOut:           mps.TotalOut,
		TotalSize:          mps.TotalSize,
		NumTickets:         mps.NumTickets,
		NumVotes:           mps.NumVotes,
		NumRegular:         mps.NumRegular,
		NumRevokes:         mps.NumRevokes,
		NumTSpends:         mps.NumTSpends,
		NumTAdds:           mps.NumTAdds,
		NumAll:             mps.NumAll,
		LikelyMineable:     mps.LikelyMineable,
		FormattedTotalSize: mps.FormattedTotalSize,
		VotingInfo: VotingInfo{
			TicketsVoted:     mps.VotingInfo.TicketsVoted,
			MaxVotesPerBlock: mps.VotingInfo.MaxVotesPerBlock,
		},
	}

	out.LatestTransactions = CopyMempoolTxSlice(mps.LatestTransactions)

	out.TicketIndexes = make(BlockValidatorIndex, len(mps.TicketIndexes))
	for bs, ti := range mps.TicketIndexes {
		m := make(TicketIndex, len(ti))
		out.TicketIndexes[bs] = m
		for bt, i := range ti {
			m[bt] = i
		}
	}

	out.VotingInfo.VotedTickets = make(map[string]bool, len(mps.VotingInfo.VotedTickets))
	for s, b := range mps.VotingInfo.VotedTickets {
		out.VotingInfo.VotedTickets[s] = b
	}

	out.VotingInfo.VoteTallys = make(map[string]*VoteTally, len(mps.VotingInfo.VoteTallys))
	for hash, tally := range mps.VotingInfo.VoteTallys {
		out.VotingInfo.VoteTallys[hash] = &VoteTally{
			TicketsPerBlock: tally.TicketsPerBlock,
			Marks:           tally.Marks,
		}
	}

	out.InvRegular = make(map[string]struct{}, len(mps.InvRegular))
	for s := range mps.InvRegular {
		out.InvRegular[s] = struct{}{}
	}

	out.InvStake = make(map[string]struct{}, len(mps.InvStake))
	for s := range mps.InvStake {
		out.InvStake[s] = struct{}{}
	}

	if mps.CoinStats != nil {
		out.CoinStats = make(map[uint8]MempoolCoinStats, len(mps.CoinStats))
		for k, v := range mps.CoinStats {
			out.CoinStats[k] = v
		}
	}

	out.CoinFills = CopyCoinFillSlice(mps.CoinFills)
	out.TotalFillRatio = mps.TotalFillRatio
	out.ActiveSKACount = mps.ActiveSKACount

	return out
}

// VotingInfo models data about the validity of the next block from mempool.
type VotingInfo struct {
	TicketsVoted     uint16          `json:"tickets_voted"`
	MaxVotesPerBlock uint16          `json:"max_votes_per_block"`
	VotedTickets     map[string]bool `json:"-"`
	// VoteTallys maps block hash to vote counts.
	VoteTallys map[string]*VoteTally `json:"vote_tally"`
}

// NewVotingInfo initializes a VotingInfo.
func NewVotingInfo(votesPerBlock uint16) VotingInfo {
	return VotingInfo{
		MaxVotesPerBlock: votesPerBlock,
		VotedTickets:     make(map[string]bool),
		VoteTallys:       make(map[string]*VoteTally),
	}
}

// Tally adds the VoteInfo to the VotingInfo.VoteTally
func (vi *VotingInfo) Tally(vinfo *VoteInfo) {
	_, ok := vi.VoteTallys[vinfo.Validation.Hash]
	if ok {
		vi.VoteTallys[vinfo.Validation.Hash].Mark(vinfo.Validation.Validity)
		return
	}
	marks := make([]bool, 1, vi.MaxVotesPerBlock)
	marks[0] = vinfo.Validation.Validity
	vi.VoteTallys[vinfo.Validation.Hash] = &VoteTally{
		TicketsPerBlock: int(vi.MaxVotesPerBlock),
		Marks:           marks,
	}
}

// BlockStatus fetches a list of votes in mempool, for the provided block hash.
// If not found, a list of VoteMissing is returned.
func (vi *VotingInfo) BlockStatus(hash string) ([]int, int) {
	tally, ok := vi.VoteTallys[hash]
	if ok {
		return tally.Status()
	}
	marks := make([]int, int(vi.MaxVotesPerBlock))
	for i := range marks {
		marks[i] = VoteMissing
	}
	return marks, VoteMissing
}

// VoteTally manages a list of bools representing the votes for a block.
type VoteTally struct {
	TicketsPerBlock int    `json:"-"`
	Marks           []bool `json:"marks"`
}

// Mark adds the vote to the VoteTally.
func (tally *VoteTally) Mark(vote bool) {
	tally.Marks = append(tally.Marks, vote)
}

// Status is a list of ints representing votes both received and not yet
// received for a block, and a single int representing consensus.
// 0: rejected, 1: affirmed, 2: vote not yet received
func (tally *VoteTally) Status() ([]int, int) {
	votes := []int{}
	var up, down, consensus int
	for _, affirmed := range tally.Marks {
		if affirmed {
			up++
			votes = append(votes, VoteAffirm)
		} else {
			down++
			votes = append(votes, VoteReject)
		}
	}
	for i := len(votes); i < tally.TicketsPerBlock; i++ {
		votes = append(votes, VoteMissing)
	}
	threshold := tally.TicketsPerBlock / 2
	if up > threshold {
		consensus = VoteAffirm
	} else if down > threshold {
		consensus = VoteReject
	}
	return votes, consensus
}

// Affirmations counts the number of selected ticket holders who have voted
// in favor of the block for the given hash.
func (tally *VoteTally) Affirmations() (c int) {
	for _, affirmed := range tally.Marks {
		if affirmed {
			c++
		}
	}
	return c
}

// VoteCount is the number of votes received.
func (tally *VoteTally) VoteCount() int {
	return len(tally.Marks)
}

// ChainParams models simple data about the chain server's parameters used for
// some info on the front page.
type ChainParams struct {
	WindowSize       int64 `json:"window_size"`
	RewardWindowSize int64 `json:"reward_window_size"`
	TargetPoolSize   int64 `json:"target_pool_size"`
	BlockTime        int64 `json:"target_block_time"`
	MeanVotingBlocks int64
}

// WebsocketBlock wraps the new block info for use in the websocket
type WebsocketBlock struct {
	Block *BlockInfo `json:"block"`
	Extra *HomeInfo  `json:"extra"`
}

// BlockID provides basic identifying information about a block.
type BlockID struct {
	Hash   string
	Height int64
	Time   int64
}

// TicketPoolInfo describes the live ticket pool
type TicketPoolInfo struct {
	Size          uint32  `json:"size"`
	Value         float64 `json:"value"`
	ValAvg        float64 `json:"valavg"`
	Percentage    float64 `json:"percent"`
	Target        uint32  `json:"target"`
	PercentTarget float64 `json:"percent_target"`
}

// MempoolTx models the tx basic data for the mempool page
type MempoolTx struct {
	TxID    string  `json:"txid"`
	Version int32   `json:"version"`
	Fees    float64 `json:"fees"`
	FeeRate float64 `json:"fee_rate"`
	// Consider atom representation:
	//FeeAmount   int64        `json:"fee_amount"`
	VinCount  int            `json:"vin_count"`
	VoutCount int            `json:"vout_count"`
	Vin       []MempoolInput `json:"vin,omitempty"`
	Coinbase  bool           `json:"coinbase"` // to signal the coinbase tx on new block despite not being in mempool
	Hash      string         `json:"hash"`     // dup of TxID?
	Time      int64          `json:"time"`
	Size      int32          `json:"size"`
	TotalOut  float64        `json:"total"`
	// Consider atom representation:
	//TotalOutAmt int64        `json:"total_amount"`
	Type        string           `json:"Type"`
	TypeID      int              `json:"typeID"` // stake package types
	VoteInfo    *VoteInfo        `json:"vote_info,omitempty"`
	SKATotals   map[uint8]string `json:"ska_totals,omitempty"`
	SKAFeeRates map[uint8]string `json:"ska_fee_rates,omitempty"` // SKA fee rate in atoms/kB, keyed by coin type
}

func (mpt *MempoolTx) DeepCopy() *MempoolTx {
	if mpt == nil {
		return nil
	}
	out := *mpt
	out.Vin = make([]MempoolInput, len(mpt.Vin))
	copy(out.Vin, mpt.Vin)
	out.VoteInfo = mpt.VoteInfo.DeepCopy()
	if mpt.SKATotals != nil {
		out.SKATotals = make(map[uint8]string, len(mpt.SKATotals))
		for k, v := range mpt.SKATotals {
			out.SKATotals[k] = v
		}
	}
	if mpt.SKAFeeRates != nil {
		out.SKAFeeRates = make(map[uint8]string, len(mpt.SKAFeeRates))
		for k, v := range mpt.SKAFeeRates {
			out.SKAFeeRates[k] = v
		}
	}
	return &out
}

func CopyMempoolTxSlice(s []MempoolTx) []MempoolTx {
	if s == nil { // []types.MempoolTx(nil) != []types.MempoolTx{}
		return nil
	}
	out := make([]MempoolTx, 0, len(s))
	for i := range s {
		out = append(out, *s[i].DeepCopy())
	}
	return out
}

// CopyCoinFillSlice returns a shallow copy of a CoinFillData slice.
// CoinFillData contains only value types so a shallow copy is sufficient.
func CopyCoinFillSlice(s []CoinFillData) []CoinFillData {
	if s == nil {
		return nil
	}
	out := make([]CoinFillData, len(s))
	copy(out, s)
	return out
}

// ComputeCoinFills derives per-coin fill bar data from the mempool CoinStats
// map. VAR is always first in the returned slice; SKA types follow in ascending
// coin-type order. When stats is empty or nil a single VAR entry with all
// ratios at 0.0 and status "ok" is returned.
// issuedSKA is the set of all SKA coin types that have ever been issued on-chain
// (from SKACoinSupply). Coin types present in issuedSKA but absent from stats
// are included as zero-fill entries so their indicators are always visible.
func ComputeCoinFills(stats map[uint8]MempoolCoinStats, maxBlockSize float64, issuedSKA []uint8) ([]CoinFillData, float64, int) {
	varQuota := maxBlockSize * 0.10
	skaPool := maxBlockSize * 0.90

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

	withDisplay := func(d CoinFillData) CoinFillData {
		raw := d.GQFillRatio*d.GQPositionRatio + d.ExtraFillRatio + d.OverflowFillRatio
		d.PctOfTC = raw * 100.0
		d.IsOverflow = raw > 1.0
		return d
	}

	varStatus := fillStatus(varSize, varQuota)
	varExtra, varOverflow := extraOrOverflow(varSize, varQuota, varStatus)

	fills := make([]CoinFillData, 0, 1+numSKA)
	fills = append(fills, withDisplay(CoinFillData{
		Symbol:            "VAR",
		GQFillRatio:       math.Min(varSize/varQuota, 1.0),
		ExtraFillRatio:    varExtra,
		OverflowFillRatio: varOverflow,
		GQPositionRatio:   0.10,
		Status:            varStatus,
	}))

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
		fills = append(fills, withDisplay(CoinFillData{
			Symbol:            fmt.Sprintf("SKA%d", ct),
			GQFillRatio:       math.Min(size/perSKAQuota, 1.0),
			ExtraFillRatio:    extra,
			OverflowFillRatio: overflow,
			GQPositionRatio:   gqPos,
			Status:            status,
		}))
	}
	return fills, totalFillRatio, numSKA
}

// NewMempoolTx models data sent from the notification handler
type NewMempoolTx struct {
	Time int64
	Hex  string
}

// MempoolVin is minimal information about the inputs of a mempool transaction.
type MempoolVin struct {
	TxId   string
	Inputs []MempoolInput
}

// MempoolInput is basic information about a transaction input.
type MempoolInput struct {
	TxId     string `json:"txid"`
	Index    uint32 `json:"index"`
	Outdex   uint32 `json:"vout"`
	CoinType uint8  `json:"coin_type,omitempty"`
	SKAValue string `json:"ska_value,omitempty"`
}

type MPTxsByTime []MempoolTx

func (txs MPTxsByTime) Less(i, j int) bool {
	return txs[i].Time > txs[j].Time
}

func (txs MPTxsByTime) Len() int {
	return len(txs)
}

func (txs MPTxsByTime) Swap(i, j int) {
	txs[i], txs[j] = txs[j], txs[i]
}

type MPTxsByHeight []MempoolTx

func (votes MPTxsByHeight) Less(i, j int) bool {
	if votes[i].VoteInfo.Validation.Height == votes[j].VoteInfo.Validation.Height {
		return votes[i].VoteInfo.MempoolTicketIndex <
			votes[j].VoteInfo.MempoolTicketIndex
	}
	return votes[i].VoteInfo.Validation.Height >
		votes[j].VoteInfo.Validation.Height
}

func (votes MPTxsByHeight) Len() int {
	return len(votes)
}

func (votes MPTxsByHeight) Swap(i, j int) {
	votes[i], votes[j] = votes[j], votes[i]
}

// AddrPrefix represent the address name it's prefix and description
type AddrPrefix struct {
	Name        string
	Prefix      string
	Description string
}

// AddressPrefixes generates an array AddrPrefix by using chaincfg.Params
func AddressPrefixes(params *chaincfg.Params) []AddrPrefix {
	Descriptions := []string{"P2PK address",
		"P2PKH address prefix. Standard wallet address. 1 public key -> 1 private key",
		"Ed25519 P2PKH address prefix",
		"secp256k1 Schnorr P2PKH address prefix",
		"P2SH address prefix",
		"WIF private key prefix",
		"HD extended private key prefix",
		"HD extended public key prefix",
	}
	Name := []string{"PubKeyAddrID",
		"PubKeyHashAddrID",
		"PKHEdwardsAddrID",
		"PKHSchnorrAddrID",
		"ScriptHashAddrID",
		"PrivateKeyID",
		"HDPrivateKeyID",
		"HDPublicKeyID",
	}

	MainnetPrefixes := []string{"Dk", "Ds", "De", "DS", "Dc", "Pm", "dprv", "dpub"}
	TestnetPrefixes := []string{"Tk", "Ts", "Te", "TS", "Tc", "Pt", "tprv", "tpub"}
	SimnetPrefixes := []string{"Sk", "Ss", "Se", "SS", "Sc", "Ps", "sprv", "spub"}

	name := params.Name
	var netPrefixes []string
	if name == "mainnet" {
		netPrefixes = MainnetPrefixes
	} else if strings.HasPrefix(name, "testnet") {
		netPrefixes = TestnetPrefixes
	} else if name == "simnet" {
		netPrefixes = SimnetPrefixes
	} else {
		return nil
	}

	addrPrefix := make([]AddrPrefix, 0, len(Descriptions))
	for i, desc := range Descriptions {
		addrPrefix = append(addrPrefix, AddrPrefix{
			Name:        Name[i],
			Description: desc,
			Prefix:      netPrefixes[i],
		})
	}
	return addrPrefix
}

// StatsInfo represents all of the data for the stats page.
type StatsInfo struct {
	UltimateSupply             int64
	TotalSupply                int64
	TotalSupplyPercentage      float64
	ProjectFunds               int64
	ProjectAddress             string
	PoWDiff                    float64
	HashRate                   float64
	BlockReward                int64
	NextBlockReward            int64
	PoWReward                  int64
	PoSReward                  int64
	ProjectFundReward          int64
	VotesInMempool             int
	TicketsInMempool           int
	TicketPrice                float64
	NextEstimatedTicketPrice   float64
	TicketPoolSize             uint32
	TicketPoolSizePerToTarget  float64
	TicketPoolValue            float64
	TPVOfTotalSupplyPeecentage float64
	TicketsROI                 float64
	RewardPeriod               string
	APR                        float64
	IdxBlockInWindow           int
	WindowSize                 int64
	BlockTime                  int64
	IdxInRewardWindow          int
	RewardWindowSize           int64
}

// UnspentOutputIndices finds the indices of the transaction outputs that appear
// unspent. The indices returned are the index within the passed slice, not
// within the transaction.
func UnspentOutputIndices(vouts []Vout) (unspents []int) {
	for idx := range vouts {
		vout := vouts[idx]
		if vout.Amount == 0.0 || vout.Spent {
			continue
		}
		unspents = append(unspents, idx)
	}
	return
}

// MsgTxMempoolInputs parses a MsgTx and creates a list of MempoolInput.
func MsgTxMempoolInputs(msgTx *wire.MsgTx) (inputs []MempoolInput) {
	for vindex := range msgTx.TxIn {
		outpoint := msgTx.TxIn[vindex].PreviousOutPoint
		outId := outpoint.Hash.String()
		inputs = append(inputs, MempoolInput{
			TxId:   outId,
			Index:  uint32(vindex),
			Outdex: outpoint.Index,
		})
	}
	return
}
