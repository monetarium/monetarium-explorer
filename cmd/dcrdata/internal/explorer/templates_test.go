package explorer

import (
	"html/template"
	"reflect"
	"strings"
	"testing"

	"github.com/monetarium/monetarium-explorer/explorer/types"
	"github.com/monetarium/monetarium-node/chaincfg"
)

func TestBlockVoteBitsStr(t *testing.T) {
	funcs := makeTemplateFuncMap(nil)

	blockVoteBitsStr, ok := funcs["blockVoteBitsStr"]
	if !ok {
		t.Fatalf(`Template function map does not contain "blockVoteBitsStr".`)
	}

	blockVoteBitsStrFn, ok := blockVoteBitsStr.(func(voteBits uint16) string)
	if !ok {
		t.Fatalf(`Template function "blockVoteBitsStr" is not of type "func(voteBits uint16) string".`)
	}

	testData := []struct {
		bits uint16
		want string
	}{
		{0, "disapprove"},
		{1, "approve"},
		{2, "disapprove"},
		{3, "approve"},
		{10, "disapprove"},
		{11, "approve"},
	}

	for i := range testData {
		if got := blockVoteBitsStrFn(testData[i].bits); got != testData[i].want {
			t.Errorf("wanted %q, got %q", testData[i].want, got)
		}
	}
}

func TestPrefixPath(t *testing.T) {
	funcs := makeTemplateFuncMap(nil)

	prefixPath, ok := funcs["prefixPath"]
	if !ok {
		t.Fatalf(`Template function map does not contain "prefixPath".`)
	}

	prefixPathFn, ok := prefixPath.(func(prefix, path string) string)
	if !ok {
		t.Fatalf(`Template function "prefixPath" is not of type "func(prefix, path string) string".`)
	}

	testData := []struct {
		prefix string
		path   string
		out    string
	}{
		{"", "", ""},
		{"", "/", "/"},
		{"/", "", "/"},
		{"/", "/path", "/path"},
		{"/", "path", "/path"},
		{"//", "//", "/"},
		{"//", "/", "/"},
		{"/", "//", "/"},
		{"/", "/", "/"},
		{"", "/path", "/path"},
		{"stuff", "/", "stuff/"},
		{"stuff", "", "stuff"},
		{"/things", "", "/things"},
		{"/insight", "/api/status", "/insight/api/status"},
		{"/insight", "api/status", "/insight/api/status"},
		{"/insight/", "api/status", "/insight/api/status"},
		{"/insight/", "/api/status", "/insight/api/status"},
		{"insight", "api/status", "insight/api/status"},
	}

	for i := range testData {
		actual := prefixPathFn(testData[i].prefix, testData[i].path)
		if actual != testData[i].out {
			t.Errorf(`prefixPathFn("%s", "%s") returned "%s", expected "%s"`,
				testData[i].prefix, testData[i].path, actual, testData[i].out)
		}
	}
}

func TestHashStart(t *testing.T) {
	funcs := makeTemplateFuncMap(nil)

	hashStart, ok := funcs["hashStart"]
	if !ok {
		t.Fatalf(`Template function map does not contain "hashStart".`)
	}

	hashStartFn, ok := hashStart.(func(hash any) string)
	if !ok {
		t.Fatalf(`Template function "hashStart" is not of type "func(hash any) string, is %T".`, hashStart)
	}

	testData := []struct {
		in  string
		out string
	}{
		{"2769040088594af8581b2f5c", "2769040088594af858"},
		{"948004e47d1578365b7b2b7b57512360b688e35ecd04f2e709f967000efdd6e9", "948004e47d1578365b7b2b7b57512360b688e35ecd04f2e709f967000e"},
		{"1234567", "1"},
		{"123456", ""},
		{"12345", ""},
		{"", ""},
	}

	for i := range testData {
		actual := hashStartFn(testData[i].in)
		if actual != testData[i].out {
			t.Errorf(`hashStart("%s") returned "%s", expected "%s"`,
				testData[i].in, actual, testData[i].out)
		}
	}
}

func TestHashEnd(t *testing.T) {
	funcs := makeTemplateFuncMap(nil)

	hashEnd, ok := funcs["hashEnd"]
	if !ok {
		t.Fatalf(`Template function map does not contain "hashEnd".`)
	}

	hashEndFn, ok := hashEnd.(func(hash any) string)
	if !ok {
		t.Fatalf(`Template function "hashEnd" is not of type "func(hash string) string, is %T".`, hashEnd)
	}

	testData := []struct {
		in  string
		out string
	}{
		{"2769040088594af8581b2f5c", "1b2f5c"},
		{"948004e47d1578365b7b2b7b57512360b688e35ecd04f2e709f967000efdd6e9", "fdd6e9"},
		{"1234567", "234567"},
		{"123456", "123456"},
		{"12345", "12345"},
		{"", ""},
	}

	for i := range testData {
		actual := hashEndFn(testData[i].in)
		if actual != testData[i].out {
			t.Errorf(`hashEnd("%s") returned "%s", expected "%s"`,
				testData[i].in, actual, testData[i].out)
		}
	}
}

func TestHashStartEnd(t *testing.T) {
	funcs := makeTemplateFuncMap(nil)

	hashStart, ok := funcs["hashStart"]
	if !ok {
		t.Fatalf(`Template function map does not contain "hashStart".`)
	}

	hashStartFn, ok := hashStart.(func(hash any) string)
	if !ok {
		t.Fatalf(`Template function "hashStart" is not of type "func(hash string) string".`)
	}

	hashEnd, ok := funcs["hashEnd"]
	if !ok {
		t.Fatalf(`Template function map does not contain "hashEnd".`)
	}

	hashEndFn, ok := hashEnd.(func(hash any) string)
	if !ok {
		t.Fatalf(`Template function "hashEnd" is not of type "func(hash string) string".`)
	}

	testData := []struct {
		in         string
		out1, out2 string
	}{
		{"2769040088594af8581b2f5c", "2769040088594af858", "1b2f5c"},
		{"948004e47d1578365b7b2b7b57512360b688e35ecd04f2e709f967000efdd6e9", "948004e47d1578365b7b2b7b57512360b688e35ecd04f2e709f967000e", "fdd6e9"},
		{"123456789ab", "12345", "6789ab"},
		{"123456789abc", "123456", "789abc"},
		{"123456789abcd", "1234567", "89abcd"},
		{"1234567", "1", "234567"},
		{"123456", "", "123456"},
		{"12345", "", "12345"},
		{"1", "", "1"},
		{"", "", ""},
	}

	for i := range testData {
		actualStart := hashStartFn(testData[i].in)
		actualEnd := hashEndFn(testData[i].in)
		if actualStart+actualEnd != testData[i].in {
			t.Errorf(`hashStart+hashEnd("%s") returned "%s" ("%s"+"%s"), expected "%s"`,
				testData[i].in, actualStart+actualEnd, actualStart, actualEnd, testData[i].in)
		}
		if actualStart != testData[i].out1 {
			t.Errorf(`hashStart("%s") returned "%s", expected "%s"`,
				testData[i].in, actualStart, testData[i].out1)
		}
		if actualEnd != testData[i].out2 {
			t.Errorf(`hashEnd("%s") returned "%s", expected "%s"`,
				testData[i].in, actualEnd, testData[i].out2)
		}
	}
}

func TestAmountAsDecimalPartsTrimmed(t *testing.T) {
	in := []struct {
		amt    int64
		n      int64
		commas bool
	}{
		{314159000, 2, false},
		{76543210000, 2, false},
		{766432100000, 2, true},
		{654321000, 1, false},
		{987654321, 8, false},
		{987654321, 2, false},
		{90765432100, 2, false},
		{9076543200000, 2, false},
		{907654320, 7, false},
		{1234590700, 2, false},
		{100000000, 2, false},
		{314159000, 2, false},
		{14159000, 2, false},
		{314159000, 7, true},
		{300000000, 7, true},
		{301000000, 1, true},
		{300000000, 0, true},
		{987654321, 11, false},
		{987654321237, 11, false},
	}

	expected := []struct {
		whole, frac, tail string
	}{
		{"3", "14", ""},
		{"765", "43", ""},
		{"7,664", "32", ""},
		{"6", "5", ""},
		{"9", "87654321", ""},
		{"9", "87", ""},
		{"907", "65", ""},
		{"90765", "43", ""},
		{"9", "0765432", ""},
		{"12", "34", ""},
		{"1", "", "00"},
		{"3", "14", ""},
		{"0", "14", ""},
		{"3", "14159", "00"},
		{"3", "", "0000000"},
		{"3", "", "0"},
		{"3", "", ""},
		{"9", "87654321", ""},
		{"9876", "54321237", ""},
	}

	for i := range in {
		out := amountAsDecimalPartsTrimmed(in[i].amt, in[i].n, in[i].commas)
		if out[0] != expected[i].whole || out[1] != expected[i].frac ||
			out[2] != expected[i].tail {
			t.Errorf("amountAsDecimalPartsTrimmed failed for "+
				"%d (%d decimals, commas=%v). Got %s.%s%s, expected %s.%s%s.",
				in[i].amt, in[i].n, in[i].commas,
				out[0], out[1], out[2],
				expected[i].whole, expected[i].frac, expected[i].tail)
		}
	}
}

func TestCoinRowData_Variants(t *testing.T) {
	// 0 SKA types: only VAR row
	rows0 := []types.CoinRowData{
		{CoinType: 0, Symbol: "VAR", TxCount: 5, Amount: "1.23K VAR", Size: 1024},
	}
	if len(rows0) != 1 || rows0[0].Symbol != "VAR" {
		t.Errorf("0 SKA: unexpected rows: %v", rows0)
	}

	// 1 SKA type
	rows1 := []types.CoinRowData{
		{CoinType: 0, Symbol: "VAR", TxCount: 3, Amount: "500 VAR", Size: 512},
		{CoinType: 1, Symbol: "SKA1", TxCount: 2, Amount: "1M SKA1", Size: 256},
	}
	if len(rows1) != 2 || rows1[1].CoinType != 1 {
		t.Errorf("1 SKA: unexpected rows: %v", rows1)
	}

	// 2 SKA types
	rows2 := []types.CoinRowData{
		{CoinType: 0, Symbol: "VAR", TxCount: 1, Amount: "100 VAR", Size: 200},
		{CoinType: 1, Symbol: "SKA1", TxCount: 1, Amount: "50 SKA1", Size: 100},
		{CoinType: 2, Symbol: "SKA2", TxCount: 1, Amount: "25 SKA2", Size: 100},
	}
	if len(rows2) != 3 || rows2[2].Symbol != "SKA2" {
		t.Errorf("2 SKA: unexpected rows: %v", rows2)
	}

	// Verify TrimmedBlockInfo carries CoinRows
	tbi := types.TrimmedBlockInfo{
		Height:   100,
		CoinRows: rows2,
	}
	if len(tbi.CoinRows) != 3 {
		t.Errorf("TrimmedBlockInfo.CoinRows: want 3, got %d", len(tbi.CoinRows))
	}
}

func TestCoinFillData(t *testing.T) {
	fills := []types.CoinFillData{
		{Symbol: "VAR", GQFillRatio: 0.5, GQPositionRatio: 0.10, Status: "ok"},
		{Symbol: "SKA1", GQFillRatio: 1.0, GQPositionRatio: 0.90, Status: "full"},
	}
	mpi := types.MempoolInfo{}
	mpi.CoinFills = fills
	if len(mpi.CoinFills) != 2 {
		t.Errorf("MempoolInfo.CoinFills: want 2, got %d", len(mpi.CoinFills))
	}
	if mpi.CoinFills[0].Symbol != "VAR" || mpi.CoinFills[1].Status != "full" {
		t.Errorf("unexpected CoinFills: %v", mpi.CoinFills)
	}
}

func TestComputeCoinFills(t *testing.T) {
	const max = 100.0 // simplified maxBlockSize for easy math

	t.Run("empty stats", func(t *testing.T) {
		fills, totalFill, numSKA := computeCoinFills(nil, max, nil)
		if len(fills) != 1 || fills[0].Symbol != "VAR" || fills[0].Status != "ok" {
			t.Errorf("unexpected fills for empty stats: %v", fills)
		}
		if totalFill != 0.0 {
			t.Errorf("empty stats: want totalFillRatio 0.0, got %f", totalFill)
		}
		if numSKA != 0 {
			t.Errorf("empty stats: want numSKA 0, got %d", numSKA)
		}
	})

	t.Run("VAR within quota", func(t *testing.T) {
		stats := map[uint8]types.MempoolCoinStats{0: {Size: 5}} // 5 of 10 quota
		fills, _, _ := computeCoinFills(stats, max, nil)
		if fills[0].Status != "ok" {
			t.Errorf("VAR within quota: want ok, got %s", fills[0].Status)
		}
		if fills[0].GQPositionRatio != 0.10 {
			t.Errorf("VAR GQPositionRatio: want 0.10, got %f", fills[0].GQPositionRatio)
		}
		if fills[0].GQFillRatio != 0.5 {
			t.Errorf("VAR GQFillRatio: want 0.5, got %f", fills[0].GQFillRatio)
		}
	})

	t.Run("VAR over quota, block not full", func(t *testing.T) {
		stats := map[uint8]types.MempoolCoinStats{0: {Size: 15}} // 15 > 10 quota, < 100 total
		fills, _, _ := computeCoinFills(stats, max, nil)
		if fills[0].Status != "borrowing" {
			t.Errorf("VAR borrowing: want borrowing, got %s", fills[0].Status)
		}
		if fills[0].ExtraFillRatio == 0 {
			t.Errorf("VAR borrowing: ExtraFillRatio should be non-zero")
		}
	})

	t.Run("VAR over quota, block full", func(t *testing.T) {
		stats := map[uint8]types.MempoolCoinStats{0: {Size: 110}} // > 100 total
		fills, totalFill, _ := computeCoinFills(stats, max, nil)
		if fills[0].Status != "full" {
			t.Errorf("VAR full: want full, got %s", fills[0].Status)
		}
		if fills[0].OverflowFillRatio == 0 {
			t.Errorf("VAR full: OverflowFillRatio should be non-zero")
		}
		if totalFill <= 1.0 {
			t.Errorf("VAR full: totalFillRatio should exceed 1.0, got %f", totalFill)
		}
	})

	t.Run("SKA within quota", func(t *testing.T) {
		// 1 SKA type gets 90% = 90 quota
		stats := map[uint8]types.MempoolCoinStats{1: {Size: 40}}
		fills, _, numSKA := computeCoinFills(stats, max, nil)
		if numSKA != 1 {
			t.Errorf("SKA count: want 1, got %d", numSKA)
		}
		var ska types.CoinFillData
		for _, f := range fills {
			if f.Symbol == "SKA1" {
				ska = f
			}
		}
		if ska.Status != "ok" {
			t.Errorf("SKA within quota: want ok, got %s", ska.Status)
		}
		if ska.GQPositionRatio != 0.90 {
			t.Errorf("SKA GQPositionRatio (1 SKA): want 0.90, got %f", ska.GQPositionRatio)
		}
	})

	t.Run("SKA over own quota, pool not exhausted", func(t *testing.T) {
		// 2 SKA types, each gets 45 quota; SKA1 uses 50 but total SKA = 50 < 90
		stats := map[uint8]types.MempoolCoinStats{1: {Size: 50}, 2: {Size: 0}}
		fills, _, numSKA := computeCoinFills(stats, max, nil)
		if numSKA != 2 {
			t.Errorf("SKA count: want 2, got %d", numSKA)
		}
		var ska1 types.CoinFillData
		for _, f := range fills {
			if f.Symbol == "SKA1" {
				ska1 = f
			}
		}
		if ska1.Status != "borrowing" {
			t.Errorf("SKA borrowing: want borrowing, got %s", ska1.Status)
		}
		wantPos := 0.90 / 2.0
		if ska1.GQPositionRatio != wantPos {
			t.Errorf("SKA GQPositionRatio (2 SKAs): want %f, got %f", wantPos, ska1.GQPositionRatio)
		}
	})

	t.Run("SKA does not affect VAR status", func(t *testing.T) {
		stats := map[uint8]types.MempoolCoinStats{0: {Size: 5}, 1: {Size: 95}}
		fills, _, _ := computeCoinFills(stats, max, nil)
		for _, f := range fills {
			if f.Symbol == "VAR" && f.Status != "ok" {
				t.Errorf("VAR should be ok regardless of SKA: got %s", f.Status)
			}
		}
	})

	t.Run("SKA types sorted by ascending coin-type key", func(t *testing.T) {
		stats := map[uint8]types.MempoolCoinStats{3: {Size: 1}, 1: {Size: 1}, 2: {Size: 1}}
		fills, _, _ := computeCoinFills(stats, max, nil)
		// fills[0] is VAR; fills[1..3] should be SKA1, SKA2, SKA3
		if fills[1].Symbol != "SKA1" || fills[2].Symbol != "SKA2" || fills[3].Symbol != "SKA3" {
			t.Errorf("SKA order: want SKA1,SKA2,SKA3 got %s,%s,%s", fills[1].Symbol, fills[2].Symbol, fills[3].Symbol)
		}
	})

	t.Run("issued SKA with no mempool activity gets zero-fill entry", func(t *testing.T) {
		// SKA5 is issued on-chain but has no mempool transactions yet.
		stats := map[uint8]types.MempoolCoinStats{0: {Size: 5}}
		fills, _, numSKA := computeCoinFills(stats, max, []uint8{5})
		if numSKA != 1 {
			t.Errorf("want numSKA 1, got %d", numSKA)
		}
		var found bool
		for _, f := range fills {
			if f.Symbol == "SKA5" {
				found = true
				if f.GQFillRatio != 0 || f.ExtraFillRatio != 0 || f.OverflowFillRatio != 0 {
					t.Errorf("SKA5 zero-fill: want all ratios 0, got %+v", f)
				}
				if f.Status != "ok" {
					t.Errorf("SKA5 zero-fill: want status ok, got %s", f.Status)
				}
			}
		}
		if !found {
			t.Errorf("SKA5 not found in fills: %v", fills)
		}
	})

	t.Run("issuedSKA does not duplicate coins already in stats", func(t *testing.T) {
		stats := map[uint8]types.MempoolCoinStats{1: {Size: 10}}
		fills, _, numSKA := computeCoinFills(stats, max, []uint8{1})
		if numSKA != 1 {
			t.Errorf("want numSKA 1 (no duplicate), got %d", numSKA)
		}
		count := 0
		for _, f := range fills {
			if f.Symbol == "SKA1" {
				count++
			}
		}
		if count != 1 {
			t.Errorf("SKA1 should appear exactly once, got %d", count)
		}
	})
}

func TestFloat64Formatting(t *testing.T) {
	tests := []struct {
		name       string
		value      float64
		numPlaces  int
		useCommas  bool
		boldPlaces []int
		expected   []string
	}{
		{
			name:       "normal value with bold",
			value:      332.39617174,
			numPlaces:  8,
			useCommas:  false,
			boldPlaces: []int{2},
			expected:   []string{"332", "39", "617174", ""},
		},
		{
			name:       "short decimal (previously broken case)",
			value:      3.2,
			numPlaces:  8,
			useCommas:  false,
			boldPlaces: []int{2},
			expected:   []string{"3", "20", "", "000000"},
		},
		{
			name:       "no bold mode",
			value:      3.2,
			numPlaces:  8,
			useCommas:  false,
			boldPlaces: nil,
			expected:   []string{"3", "2", "0000000"},
		},
		{
			name:       "integer value",
			value:      5.0,
			numPlaces:  8,
			useCommas:  false,
			boldPlaces: []int{2},
			expected:   []string{"5", "00", "", "000000"},
		},
		{
			name:       "rounding case",
			value:      1.999999999,
			numPlaces:  8,
			useCommas:  false,
			boldPlaces: []int{2},
			expected:   []string{"2", "00", "", "000000"},
		},
		{
			name:       "with commas",
			value:      12345.67,
			numPlaces:  8,
			useCommas:  true,
			boldPlaces: []int{2},
			expected:   []string{"12,345", "67", "", "000000"},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var result []string

			if tt.boldPlaces != nil {
				result = float64Formatting(tt.value, tt.numPlaces, tt.useCommas, tt.boldPlaces...)
			} else {
				result = float64Formatting(tt.value, tt.numPlaces, tt.useCommas)
			}

			if !reflect.DeepEqual(result, tt.expected) {
				t.Errorf("unexpected result\nexpected: %#v\ngot:      %#v", tt.expected, result)
			}
		})
	}
}

func TestFloat64FormattingNoTrailing(t *testing.T) {
	got := float64FormattingNoTrailing(3.2, 8, false, 2)

	expected := []string{"3", "20", "", ""}

	if !reflect.DeepEqual(got, expected) {
		t.Fatalf("expected %#v, got %#v", expected, got)
	}
}
func TestDecimalPartsTemplate(t *testing.T) {
	funcMap := makeTemplateFuncMap(chaincfg.SimNetParams())
	// Mock asset function which is used in some templates but not decimalParts
	funcMap["asset"] = func(name string) string { return name }

	// Create a template and parse the extras.tmpl file. In tests, the path
	// is relative to the package directory.
	tmpl, err := template.New("base").Funcs(funcMap).ParseFiles("../../views/extras.tmpl")
	if err != nil {
		t.Fatalf("failed to parse template: %v", err)
	}

	tests := []struct {
		name     string
		input    []string
		expected string
	}{
		{
			name:  "User requested case: 4 parts, empty index 2",
			input: []string{"3", "20", "", "000000"},
			// Based on line 183-197 of extras.tmpl:
			// len is 4.
			// index 1 is "20" (len > 0), so it renders "{{ index . 0 }}.{{index . 1 }}" in span class="int"
			// index 2 is "", index 3 is "000000", so the second if block IS rendered.
			expected: `<div class="decimal-parts d-inline-block"><span class="int">3.20</span><span class="decimal"></span><span class="decimal trailing-zeroes">000000</span></div>`,
		},
		{
			name:     "4 parts, non-empty index 2",
			input:    []string{"3", "20", "1", "00000"},
			expected: `<div class="decimal-parts d-inline-block"><span class="int">3.20</span><span class="decimal">1</span><span class="decimal trailing-zeroes">00000</span></div>`,
		},
		{
			name:     "4 parts, no decimals in int span",
			input:    []string{"3", "", "1", "00000"},
			expected: `<div class="decimal-parts d-inline-block"><span class="int">3</span><span class="decimal">1</span><span class="decimal trailing-zeroes">00000</span></div>`,
		},
		{
			name:     "3 parts, normal",
			input:    []string{"3", "2", "0000000"},
			expected: `<div class="decimal-parts d-inline-block"><span class="int">3</span><span class="decimal dot">.</span><span class="decimal">2</span><span class="decimal trailing-zeroes">0000000</span></div>`,
		},
		{
			name:     "3 parts, only trailing zeros",
			input:    []string{"3", "", "00000000"},
			expected: `<div class="decimal-parts d-inline-block"><span class="int">3</span><span class="decimal dot">.</span><span class="decimal"></span><span class="decimal trailing-zeroes">00000000</span></div>`,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var out strings.Builder
			err := tmpl.ExecuteTemplate(&out, "decimalParts", tt.input)
			if err != nil {
				t.Fatalf("failed to execute template: %v", err)
			}

			got := strings.TrimSpace(out.String())
			// Remove any internal newlines/tabs that might be present due to template formatting
			// although the template uses {{- and -}} to control whitespace.
			got = strings.ReplaceAll(got, "\n", "")
			got = strings.ReplaceAll(got, "\t", "")

			if got != tt.expected {
				t.Errorf("expected:\n%s\ngot:\n%s", tt.expected, got)
			}
		})
	}
}
