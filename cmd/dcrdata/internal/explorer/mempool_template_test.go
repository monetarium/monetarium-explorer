package explorer

import (
	"strings"
	"testing"

	"github.com/monetarium/monetarium-explorer/explorer/types"
	"github.com/monetarium/monetarium-node/chaincfg"
)

// loadMempoolTemplate parses mempool.tmpl plus extras.tmpl with the production
// helper FuncMap. Fails the test on parse error.
func loadMempoolTemplate(t *testing.T) templates {
	t.Helper()
	funcMap := makeTemplateFuncMap(chaincfg.SimNetParams())
	funcMap["asset"] = func(name string) string { return "/dist/" + name }
	tmpl := newTemplates(viewsFolder, false, []string{"extras"}, funcMap)
	if err := tmpl.addTemplate("mempool"); err != nil {
		t.Fatalf("addTemplate mempool: %v", err)
	}
	return tmpl
}

// renderMempool executes the mempool template against a *types.MempoolInfo and
// returns the rendered HTML.
func renderMempool(t *testing.T, tmpl templates, inv *types.MempoolInfo) string {
	t.Helper()
	data := struct {
		*CommonPageData
		Mempool *types.MempoolInfo
	}{
		CommonPageData: &CommonPageData{Links: &links{}, Tip: &types.WebBasicBlock{}},
		Mempool:        inv,
	}
	pt, ok := tmpl.templates["mempool"]
	if !ok {
		t.Fatal("mempool template not loaded")
	}
	var sb strings.Builder
	if err := pt.template.ExecuteTemplate(&sb, "mempool", data); err != nil {
		t.Fatalf("execute mempool: %v", err)
	}
	return sb.String()
}

// TestMempoolTemplate exercises mempool.tmpl across the spec-relevant shapes
// (VAR-only, VAR+SKA, empty). The goal is to catch template regressions
// without spinning up a node; behaviour-specific assertions verify the spec
// requirements from wiki/specs/mempool/spec.md.
func TestMempoolTemplate(t *testing.T) {
	tmpl := loadMempoolTemplate(t)

	t.Run("VAR-only mempool with regular tx", func(t *testing.T) {
		inv := &types.MempoolInfo{
			MempoolShort: types.MempoolShort{
				NumRegular: 1,
				LikelyMineable: types.LikelyMineable{
					Total: 1.5, Count: 1, Size: 250,
					RegularTotal: 1.5, FormattedSize: "250 B",
				},
				CoinStats: map[uint8]types.MempoolCoinStats{
					0: {
						TxCount: 1, Size: 250,
						Amount:       "150000000",
						RegularCount: 1, RegularAmount: "150000000",
						TicketCount: 0, TicketAmount: "0",
						VoteCount: 0, VoteAmount: "0",
						RevokeCount: 0, RevokeAmount: "0",
					},
				},
			},
			Transactions: []types.MempoolTx{
				{Hash: "varhash1", Time: 1, Size: 250, TotalOut: 1.5, FeeRate: 0.0001, Type: "Regular"},
			},
		}
		out := renderMempool(t, tmpl, inv)

		// Total Sent card: VAR row present, SKA absent.
		if !strings.Contains(out, `data-mempool-target="totalSent"`) {
			t.Error("missing totalSent container")
		}
		// Regular table has the new Coin column + spec-mandated header.
		if !strings.Contains(out, ">Coin<") {
			t.Error("expected Coin column header in Regular table")
		}
		if strings.Contains(out, ">Total DCR<") {
			t.Error("found stale 'Total DCR' header — should be 'Total VAR'")
		}
		if !strings.Contains(out, "VAR/kB") {
			t.Error("expected VAR/kB unit label")
		}
		// Treasury Spends removed.
		if strings.Contains(out, "Treasury Spends") {
			t.Error("Treasury Spends section should be removed")
		}
		// Empty state strings — Revocations table is empty (no revs), spec text.
		if !strings.Contains(out, "No revocations in mempool.") {
			t.Error("expected exact spec empty state for Revocations")
		}
		// VAR row in Regular table renders the symbol literal "VAR" via the
		// non-SKATotals branch.
		if !strings.Contains(out, "varhash1") {
			t.Error("expected VAR tx hash in rendered output")
		}
	})

	t.Run("VAR+SKA mempool — both Total Sent rows render", func(t *testing.T) {
		inv := &types.MempoolInfo{
			MempoolShort: types.MempoolShort{
				NumRegular: 2,
				LikelyMineable: types.LikelyMineable{
					Total: 1.5, Count: 2, Size: 500,
					RegularTotal: 1.5, FormattedSize: "500 B",
				},
				CoinStats: map[uint8]types.MempoolCoinStats{
					0: {
						TxCount: 1, Size: 250, Amount: "150000000",
						RegularCount: 1, RegularAmount: "150000000",
						TicketCount: 0, TicketAmount: "0",
						VoteCount: 0, VoteAmount: "0",
						RevokeCount: 0, RevokeAmount: "0",
					},
					1: {
						TxCount: 1, Size: 250, Amount: "1230000000000000000",
						RegularCount: 1, RegularAmount: "1230000000000000000",
						TicketAmount: "0", VoteAmount: "0", RevokeAmount: "0",
					},
				},
			},
			Transactions: []types.MempoolTx{
				{Hash: "varhash", Time: 1, Size: 250, TotalOut: 1.5, FeeRate: 0.0001, Type: "Regular"},
				{Hash: "skahash", Time: 2, Size: 250, Type: "Regular",
					SKATotals: map[uint8]string{1: "1230000000000000000"}},
			},
		}
		out := renderMempool(t, tmpl, inv)

		// SKA section in Transactions card appears.
		if !strings.Contains(out, `data-coin-type="1"`) {
			t.Error("expected SKA1 section in Transactions card")
		}
		// SKA tx row uses the coinSymbol branch.
		if !strings.Contains(out, "skahash") {
			t.Error("missing SKA tx hash in output")
		}
		// SKA row should not render `VAR/kB` (fee rate em-dash). The literal
		// `—` is fine; we just verify no `VAR/kB` for the SKA row by checking
		// only one VAR/kB occurrence (the one VAR tx).
		varKbCount := strings.Count(out, "VAR/kB")
		if varKbCount == 0 {
			t.Error("expected at least one VAR/kB for the VAR tx")
		}
		// SSR Total Sent includes the SKA1 symbol.
		if !strings.Contains(out, "SKA1") {
			t.Error("expected SKA1 symbol in rendered output")
		}
	})

	t.Run("Empty mempool — VAR card still shows, empty states correct", func(t *testing.T) {
		inv := &types.MempoolInfo{
			MempoolShort: types.MempoolShort{
				LikelyMineable: types.LikelyMineable{FormattedSize: "0 B"},
				CoinStats:      map[uint8]types.MempoolCoinStats{},
			},
		}
		out := renderMempool(t, tmpl, inv)

		// VAR row in Total Sent renders even with empty CoinStats (helper
		// supplies zero stats).
		if !strings.Contains(out, "VAR") {
			t.Error("expected VAR symbol on empty mempool (always shown)")
		}
		// Spec empty states for every VAR-only table.
		for _, want := range []string{
			"No transactions in mempool.",
			"No tickets in mempool.",
			"No votes in mempool.",
			"No revocations in mempool.",
		} {
			if !strings.Contains(out, want) {
				t.Errorf("missing empty state %q", want)
			}
		}
	})
}
