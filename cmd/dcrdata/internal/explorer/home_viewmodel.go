package explorer

import (
	"fmt"

	humanize "github.com/dustin/go-humanize"
	"github.com/monetarium/monetarium-explorer/explorer/types"
)

// HomeBlockRow is the view model for one row in the home page block table.
// It carries all column values pre-formatted so the template performs no
// numeric logic.
type HomeBlockRow struct {
	// Overview group — sourced directly from BlockBasic.
	Height         int64
	Hash           string
	Transactions   int
	Voters         uint16
	FreshStake     uint8
	Revocations    uint32
	FormattedBytes string
	BlockTime      types.TimeDef

	// VAR group — monetary values pre-formatted.
	VARTxCount int
	VARAmount  string
	VARSize    string

	// SKAAmount is the raw atom string of the first SKA row in CoinRows.
	// The template renders the aggregate cell via formatSKAAmountCell, which
	// uses SKAAmount only when len(SKASubRows) == 1. Empty when CoinRows has
	// no SKA entries.
	SKAAmount string

	// SKAActiveSubRows is the count of SKASubRows with txCount > 0 — what
	// the "Σ K" cell summary shows when len(SKASubRows) >= 2.
	SKAActiveSubRows int

	// SKASubRows holds per-SKA-type accordion breakdown rows.
	SKASubRows []SKASubRow
}

// SKASubRow is one accordion detail row for a specific SKA token type.
// All numeric fields are pre-formatted strings.
type SKASubRow struct {
	TokenType string // e.g. "SKA1", "SKA2"
	TxCount   string // pre-formatted
	Amount    string // pre-formatted
	Size      string // pre-formatted
}

// buildHomeBlockRows converts a slice of BlockBasic pointers into HomeBlockRow
// view models using real CoinRows data. Nil entries are skipped.
// Coin-row flattening here intentionally duplicates types.BlockBasic.FlattenCoinRows
// because HomeBlockRow needs pre-formatted fields (string TxCount, formatted amounts)
// while FlattenCoinRows stores raw values for the block table template. Keep both in sync.
func buildHomeBlockRows(blocks []*types.BlockBasic) []HomeBlockRow {
	rows := make([]HomeBlockRow, 0, len(blocks))
	for _, b := range blocks {
		if b == nil {
			continue
		}

		var varAmount, varSize string
		var varTxCount int
		var skaAmount string
		var skaActive int
		var subRows []SKASubRow
		totalTxCount := b.Transactions // default: raw block count

		if len(b.CoinRows) > 0 {
			totalTxCount = 0
			for _, cr := range b.CoinRows {
				totalTxCount += cr.TxCount
			}
			totalTxCount -= int(b.Voters) + int(b.FreshStake) + int(b.Revocations)
			if totalTxCount < 0 {
				totalTxCount = 0
			}
			for _, cr := range b.CoinRows {
				if cr.CoinType == 0 {
					// VAR row - subtract votes, tickets, revokes to get regular txs only
					varTxCount = cr.TxCount - int(b.Voters) - int(b.FreshStake) - int(b.Revocations)
					if varTxCount < 0 {
						varTxCount = 0
					}
					varAmount = formatCoinAtoms(cr.Amount, cr.CoinType)
					if cr.Size > 0 {
						varSize = humanize.Bytes(uint64(cr.Size))
					} else {
						varSize = "—"
					}
				} else {
					// SKA row — add to sub-rows. Record the first SKA row's raw
					// atom amount as the aggregate's source; the template
					// resolves the displayed cell via formatSKAAmountCell.
					txCount := fmt.Sprintf("%d", cr.TxCount)
					size := humanize.Bytes(uint64(cr.Size))
					subRows = append(subRows, SKASubRow{
						TokenType: cr.Symbol,
						TxCount:   txCount,
						Amount:    formatCoinAtoms(cr.Amount, cr.CoinType),
						Size:      size,
					})
					if cr.TxCount > 0 {
						skaActive++
					}
					if skaAmount == "" {
						skaAmount = cr.Amount
					}
				}
			}
		} else {
			// No CoinRows — VAR-only block, fall back to Total.
			varTxCount = b.Transactions
			varAmount = threeSigFigs(b.Total)
			varSize = b.FormattedBytes
		}

		rows = append(rows, HomeBlockRow{
			Height:           b.Height,
			Hash:             b.Hash,
			Transactions:     totalTxCount,
			Voters:           b.Voters,
			FreshStake:       b.FreshStake,
			Revocations:      b.Revocations,
			FormattedBytes:   b.FormattedBytes,
			BlockTime:        b.BlockTime,
			VARTxCount:       varTxCount,
			VARAmount:        varAmount,
			VARSize:          varSize,
			SKAAmount:        skaAmount,
			SKAActiveSubRows: skaActive,
			SKASubRows:       subRows,
		})
	}
	return rows
}
