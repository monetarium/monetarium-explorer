package explorer

import (
	"fmt"

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

	// SKAAmount is the pre-formatted aggregate SKA amount across all SKA types.
	// Empty when the block has no SKA transactions.
	SKAAmount string

	// SKASubRows holds per-SKA-type accordion breakdown rows.
	SKASubRows []SKASubRow
}

// SKASubRow is one accordion detail row for a specific SKA token type.
// All numeric fields are pre-formatted strings.
type SKASubRow struct {
	TokenType string // e.g. "SKA-1", "SKA-2"
	TxCount   string // pre-formatted
	Amount    string // pre-formatted
	Size      string // pre-formatted
}

// buildHomeBlockRows converts a slice of BlockBasic pointers into HomeBlockRow
// view models using real CoinRows data. Nil entries are skipped.
func buildHomeBlockRows(blocks []*types.BlockBasic) []HomeBlockRow {
	rows := make([]HomeBlockRow, 0, len(blocks))
	for _, b := range blocks {
		if b == nil {
			continue
		}

		var varAmount, varSize string
		var varTxCount int
		var skaAmount string
		var subRows []SKASubRow
		totalTxCount := b.Transactions // default: raw block count

		if len(b.CoinRows) > 0 {
			totalTxCount = 0
			for _, cr := range b.CoinRows {
				totalTxCount += cr.TxCount
				if cr.CoinType == 0 {
					// VAR row
					varTxCount = cr.TxCount
					varAmount = formatCoinAtoms(cr.Amount, cr.CoinType)
					if cr.Size > 0 {
						varSize = fmt.Sprintf("%d B", cr.Size)
					} else {
						varSize = "—"
					}
				} else {
					// SKA row — add to sub-rows
					txCount := "—"
					if cr.TxCount > 0 {
						txCount = fmt.Sprintf("%d", cr.TxCount)
					}
					size := "—"
					if cr.Size > 0 {
						size = fmt.Sprintf("%d B", cr.Size)
					}
					subRows = append(subRows, SKASubRow{
						TokenType: cr.Symbol,
						TxCount:   txCount,
						Amount:    formatCoinAtoms(cr.Amount, cr.CoinType),
						Size:      size,
					})
				}
			}
			// Aggregate SKA amount label: use first SKA row's amount if only one,
			// or a count summary if multiple.
			if len(subRows) == 1 {
				skaAmount = subRows[0].Amount
			} else if len(subRows) > 1 {
				skaAmount = fmt.Sprintf("%d SKA types", len(subRows))
			}
		} else {
			// No CoinRows — VAR-only block, fall back to Total.
			varTxCount = b.Transactions
			varAmount = threeSigFigs(b.Total)
			varSize = b.FormattedBytes
		}

		rows = append(rows, HomeBlockRow{
			Height:         b.Height,
			Hash:           b.Hash,
			Transactions:   totalTxCount,
			Voters:         b.Voters,
			FreshStake:     b.FreshStake,
			Revocations:    b.Revocations,
			FormattedBytes: b.FormattedBytes,
			BlockTime:      b.BlockTime,
			VARTxCount:     varTxCount,
			VARAmount:      varAmount,
			VARSize:        varSize,
			SKAAmount:      skaAmount,
			SKASubRows:     subRows,
		})
	}
	return rows
}
