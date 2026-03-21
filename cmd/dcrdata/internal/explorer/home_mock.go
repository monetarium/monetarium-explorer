// home_mock.go provides mock SKA data for the home page block table.
// Isolated in its own file so the entire mock can be replaced by a real
// database call by editing only this file — home_viewmodel.go and
// explorerroutes.go remain untouched.

package explorer

import "fmt"

var mockSKATokens = []struct {
	name   string
	txs    int
	amount float64
	size   float64
}{
	{"SKA-1", 42, 1_250_000, 8_400},
	{"SKA-2", 17, 450_000, 3_200},
	{"SKA-3", 5, 2_100_000_000, 1_100},
}

// mockSKAData returns pre-formatted SKA aggregate values and sub-rows.
// When height % 9 == 0, it returns an empty sub-row slice to simulate a block
// with no SKA activity, exercising the accordion-disabled state.
func mockSKAData(height int64) (txCount, amount, size string, subRows []SKASubRow) {
	if height%9 == 0 {
		return "0", "0", "0", nil
	}
	offset := int(height % 10)
	var aggTx int
	var aggAmt, aggSz float64
	subRows = make([]SKASubRow, 0, len(mockSKATokens))
	for _, tok := range mockSKATokens {
		tx := tok.txs + offset
		amt := tok.amount * (1 + float64(offset)/100)
		sz := tok.size + float64(offset)*10
		aggTx += tx
		aggAmt += amt
		aggSz += sz
		subRows = append(subRows, SKASubRow{
			TokenType: tok.name,
			TxCount:   fmt.Sprintf("%d", tx),
			Amount:    threeSigFigs(amt),
			Size:      threeSigFigs(sz),
		})
	}
	return fmt.Sprintf("%d", aggTx), threeSigFigs(aggAmt), threeSigFigs(aggSz), subRows
}
