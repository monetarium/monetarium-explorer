package explorer

import (
	"context"
	"net/http/httptest"
	"testing"

	explorerTypes "github.com/monetarium/monetarium-explorer/explorer/types"
	"github.com/monetarium/monetarium-explorer/gov/agendas"
	"github.com/monetarium/monetarium-node/chaincfg"
	chainjson "github.com/monetarium/monetarium-node/rpc/jsonrpc/types"
)

// stubAgendaSource is a minimal agendaBackend: it returns a single agenda so
// AgendaPage gets past the AgendaInfo lookup and on to the vote-summary code.
type stubAgendaSource struct{ ai *agendas.AgendaTagged }

func (s stubAgendaSource) AgendaInfo(string) (*agendas.AgendaTagged, error) { return s.ai, nil }
func (s stubAgendaSource) AllAgendas() ([]*agendas.AgendaTagged, error) {
	return []*agendas.AgendaTagged{s.ai}, nil
}
func (s stubAgendaSource) UpdateAgendas() error { return nil }

// TestAgendaPage_NilSummaryNotYetStarted guards against a regression where
// AgendaPage dereferenced the *dbtypes.AgendaSummary returned by
// AgendasVotesSummary without a nil check. ChainDB.AgendasVotesSummary returns
// (nil, nil) for an agenda whose deployment StartTime is still in the future
// (voting not yet started); mockDataSource.AgendasVotesSummary models that by
// always returning (nil, nil). Before the guard, visiting /agenda/{id} for such
// an agenda panicked (recovered as HTTP 500 in production via
// middleware.Recoverer).
//
// The assertion is "the handler does not panic" rather than a specific status
// code: the bug is a nil-pointer panic, and that is exactly what we must never
// reintroduce. (The bare test harness renders the shared navbar/footer with a
// nil chain tip, so the page itself returns 500 here — incidental to this test.)
func TestAgendaPage_NilSummaryNotYetStarted(t *testing.T) {
	params := chaincfg.SimNetParams()

	funcMap := makeTemplateFuncMap(params)
	funcMap["asset"] = func(name string) string { return "/dist/" + name }
	tmpl := newTemplates(viewsFolder, false, []string{"extras"}, funcMap)
	if err := tmpl.addTemplate("agenda"); err != nil {
		t.Fatalf("addTemplate(agenda): %v", err)
	}
	if err := tmpl.addTemplate("status"); err != nil {
		t.Fatalf("addTemplate(status): %v", err)
	}

	exp := &explorerUI{
		dataSource: &mockDataSource{params: params}, // AgendasVotesSummary -> (nil, nil)
		agendasSource: stubAgendaSource{ai: &agendas.AgendaTagged{
			ID:          "reprotestagenda",
			Description: "not-yet-started agenda",
			VoteVersion: 9,
			Choices:     []chainjson.Choice{{ID: "yes"}, {ID: "no"}, {ID: "abstain"}},
		}},
		templates:   tmpl,
		ChainParams: params,
		pageData:    &pageData{BlockInfo: &explorerTypes.BlockInfo{}},
	}

	req := httptest.NewRequest("GET", "/agenda/reprotestagenda", nil)
	req = req.WithContext(context.WithValue(req.Context(), ctxAgendaId, "reprotestagenda"))
	w := httptest.NewRecorder()

	// AgendaPage is called directly (no middleware.Recoverer), so a nil-pointer
	// panic would propagate; recover and fail loudly if it does.
	defer func() {
		if r := recover(); r != nil {
			t.Fatalf("AgendaPage panicked on a nil vote summary (regression): %v", r)
		}
	}()

	exp.AgendaPage(w, req)
}
