// Copyright (c) 2019-2021, The Decred developers
// See LICENSE for details.

package explorer

import (
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
)

func TestMenuFormParser(t *testing.T) {
	// Dummy hander for use with the MenuFormParser middleware.
	blah := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		io.WriteString(w, "blah")
	})
	// The handler wrapping blah with MenuFormParser.
	handler := MenuFormParser(blah)

	// TEST with no form data. Expected response body: "blah"
	r := httptest.NewRequest("POST", "/set", nil)

	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)
	//resp := w.Result()

	if w.Body.String() != "blah" {
		t.Errorf("MenuFormParser failed to call dummy handler's ServeHTTP.")
	}

	// TEST with form with requestURIFormKey ("requestURI"). Expect 302 redirect
	// to the relative URL (path, no scheme, no host, no query, no fragment).
	form := url.Values{}
	form.Add(darkModeFormKey, "1")
	form.Add(requestURIFormKey, "https://explorer.decred.org/blocks?junk=1#fraggle")

	r = httptest.NewRequest("POST", "/set", strings.NewReader(form.Encode()))
	r.Header.Add("Content-Type", "application/x-www-form-urlencoded") // Required!
	// darkCookie := &http.Cookie{
	// 	Name:   darkModeCoookie,
	// 	Value:  "1",
	// 	MaxAge: 0,
	// }
	// r.AddCookie(darkCookie)

	w = httptest.NewRecorder()
	handler.ServeHTTP(w, r)
	resp := w.Result()

	if w.Body.String() != "" {
		t.Errorf("MenuFormParser failed to respond with an empty body. Got: %v.",
			w.Body.String())
	}

	if resp.StatusCode != http.StatusFound {
		t.Errorf("MenuFormParser failed to respond with status 302 FOUND. Got: %v.",
			resp.StatusCode)
	}

	loc, err := resp.Location()
	if err != nil {
		t.Errorf(`Location header not found or invalid: "%v"`, err)
	}
	if loc.String() != "/blocks" {
		t.Errorf(`Location header not set to "/blocks", got "%s".`, loc)
	}
	if loc.IsAbs() {
		t.Errorf(`Location should have been relative, was absolute: "%s"`, loc)
	}
	if len(loc.Query()) > 0 {
		t.Errorf(`Location included a query, should have been an escaped path. Loc: "%s"`, loc)
	}
	if loc.String() != loc.EscapedPath() {
		t.Errorf(`Location should have been JUST an escaped path, got "%s"`, loc)
	}
	if loc.Host != "" {
		t.Errorf("Location should not have a host, but it was %s", loc.Host)
	}
}

func TestThemeFromQueryParser(t *testing.T) {
	blah := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		io.WriteString(w, "blah")
	})
	handler := ThemeFromQueryParser(blah)

	tests := []struct {
		name           string
		query          string
		existingCookie *http.Cookie
		wantValue      string // expected cookie value; "" = no cookie expected
		wantDark       bool   // what the current request's cookie says
	}{
		{
			name:      "dark from landing with no cookie",
			query:     "?theme=dark",
			wantValue: "1",
			wantDark:  true,
		},
		{
			name:      "light from landing with no cookie",
			query:     "?theme=light",
			wantValue: "0",
			wantDark:  false,
		},
		{
			name:  "no theme param",
			query: "",
		},
		{
			name:  "unknown theme value",
			query: "?theme=neon",
		},
		{
			name:           "landing light ignored when dark cookie exists",
			query:          "?theme=light",
			existingCookie: &http.Cookie{Name: darkModeCoookie, Value: "1"},
			wantDark:       true,
		},
		{
			name:           "landing dark ignored when dark cookie exists",
			query:          "?theme=dark",
			existingCookie: &http.Cookie{Name: darkModeCoookie, Value: "1"},
			wantDark:       true,
		},
		{
			name:           "landing dark ignored when light cookie exists",
			query:          "?theme=dark",
			existingCookie: &http.Cookie{Name: darkModeCoookie, Value: "0"},
			wantDark:       false,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			r := httptest.NewRequest("GET", "/"+test.query, nil)
			if test.existingCookie != nil {
				r.AddCookie(test.existingCookie)
			}
			w := httptest.NewRecorder()
			handler.ServeHTTP(w, r)

			if w.Body.String() != "blah" {
				t.Errorf("ThemeFromQueryParser failed to call the wrapped handler.")
			}

			if test.wantValue != "" {
				resp := w.Result()
				cookies := resp.Cookies()
				var got *http.Cookie
				for _, c := range cookies {
					if c.Name == darkModeCoookie {
						got = c
						break
					}
				}
				if got == nil {
					t.Fatalf("expected a %s cookie to be set, got %v", darkModeCoookie, cookies)
				}
				if got.Value != test.wantValue {
					t.Errorf("cookie value: want %s, got %s", test.wantValue, got.Value)
				}
			} else {
				resp := w.Result()
				for _, c := range resp.Cookies() {
					if c.Name == darkModeCoookie {
						t.Errorf("did not expect a %s cookie, got %v", darkModeCoookie, c)
					}
				}
			}

			// The cookie must be visible to the current request (commonData
			// reads it to render the first paint).
			rc, err := r.Cookie(darkModeCoookie)
			gotDark := err == nil && rc.Value == "1"
			if gotDark != test.wantDark {
				t.Errorf("request cookie dark value: want %v, got %v", test.wantDark, gotDark)
			}
		})
	}
}
