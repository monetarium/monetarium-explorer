// Copyright (c) 2026, The Monetarium developers
// See LICENSE for details.

package main

import (
	"bytes"
	"compress/gzip"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
)

// TestFileServerCacheControl verifies that FileServer serves static assets with
// the expected Cache-Control header: content-hashed assets under an immutable
// route get a long-lived immutable policy, while other static routes get a
// plain max-age policy.
func TestFileServerCacheControl(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "asset.txt"), []byte("hello"), 0o600); err != nil {
		t.Fatalf("failed to write test asset: %v", err)
	}

	mux := chi.NewRouter()
	FileServer(mux, "/dist", dir, 31536000, true)
	FileServer(mux, "/fonts", dir, 2592000, false)

	tests := []struct {
		name           string
		path           string
		wantCacheCtrl  string
		wantStatusCode int
	}{
		{
			name:           "immutable dist route",
			path:           "/dist/asset.txt",
			wantCacheCtrl:  "public, max-age=31536000, immutable",
			wantStatusCode: http.StatusOK,
		},
		{
			name:           "standard fonts route",
			path:           "/fonts/asset.txt",
			wantCacheCtrl:  "max-age=2592000",
			wantStatusCode: http.StatusOK,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			rec := httptest.NewRecorder()
			req := httptest.NewRequest(http.MethodGet, tt.path, nil)
			mux.ServeHTTP(rec, req)

			if rec.Code != tt.wantStatusCode {
				t.Errorf("status code = %d, want %d", rec.Code, tt.wantStatusCode)
			}
			if got := rec.Header().Get("Cache-Control"); got != tt.wantCacheCtrl {
				t.Errorf("Cache-Control = %q, want %q", got, tt.wantCacheCtrl)
			}
		})
	}
}

// TestFileServerCompression verifies that FileServer compresses compressible
// text assets (e.g. CSS/JS) when the client advertises gzip support, and leaves
// already-compressed binary assets (e.g. woff2 fonts) untouched. This keeps
// static-asset delivery efficient without depending on a compressing reverse
// proxy in front of the explorer.
func TestFileServerCompression(t *testing.T) {
	dir := t.TempDir()
	css := []byte(strings.Repeat("body { color: #123456; }\n", 200))
	if err := os.WriteFile(filepath.Join(dir, "asset.css"), css, 0o600); err != nil {
		t.Fatalf("failed to write css asset: %v", err)
	}
	js := []byte(strings.Repeat("function f(){ return 42; }\n", 200))
	if err := os.WriteFile(filepath.Join(dir, "asset.js"), js, 0o600); err != nil {
		t.Fatalf("failed to write js asset: %v", err)
	}
	// A woff2 file starts with the "wOF2" signature; its payload is already
	// compressed, so it must not be re-compressed.
	woff2 := append([]byte("wOF2"), bytes.Repeat([]byte{0x00, 0x11, 0x22}, 300)...)
	if err := os.WriteFile(filepath.Join(dir, "asset.woff2"), woff2, 0o600); err != nil {
		t.Fatalf("failed to write woff2 asset: %v", err)
	}

	mux := chi.NewRouter()
	FileServer(mux, "/dist", dir, 31536000, true)

	// assertGzipRoundTrip fetches path with gzip support and checks that the
	// response is gzip-encoded, varies on Accept-Encoding, does not advertise
	// byte ranges, and decodes back to the original bytes.
	assertGzipRoundTrip := func(t *testing.T, path string, want []byte) {
		t.Helper()
		rec := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodGet, path, nil)
		req.Header.Set("Accept-Encoding", "gzip")
		mux.ServeHTTP(rec, req)

		if got := rec.Header().Get("Content-Encoding"); got != "gzip" {
			t.Fatalf("Content-Encoding = %q, want %q", got, "gzip")
		}
		// A compressed, cacheable response must vary on Accept-Encoding so a
		// shared cache never serves gzipped bytes to a client that cannot
		// decode them.
		if got := rec.Header().Get("Vary"); !strings.Contains(got, "Accept-Encoding") {
			t.Errorf("Vary = %q, want it to contain %q", got, "Accept-Encoding")
		}
		// A gzip-encoded response must not advertise Accept-Ranges: a later
		// byte-range request is answered from the uncompressed file, whose
		// offsets don't line up with the gzip stream the client already holds.
		if got := rec.Header().Get("Accept-Ranges"); got != "" {
			t.Errorf("Accept-Ranges = %q, want empty on a gzip-encoded response", got)
		}
		gr, err := gzip.NewReader(rec.Body)
		if err != nil {
			t.Fatalf("gzip.NewReader: %v", err)
		}
		got, err := io.ReadAll(gr)
		if err != nil {
			t.Fatalf("reading gzip body: %v", err)
		}
		if !bytes.Equal(got, want) {
			t.Errorf("decompressed body (%d bytes) does not match original (%d bytes)", len(got), len(want))
		}
	}

	t.Run("css asset is gzip-compressed", func(t *testing.T) {
		assertGzipRoundTrip(t, "/dist/asset.css", css)
	})

	t.Run("js asset is gzip-compressed", func(t *testing.T) {
		assertGzipRoundTrip(t, "/dist/asset.js", js)
	})

	t.Run("woff2 asset is not compressed", func(t *testing.T) {
		rec := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodGet, "/dist/asset.woff2", nil)
		req.Header.Set("Accept-Encoding", "gzip")
		mux.ServeHTTP(rec, req)

		if got := rec.Header().Get("Content-Encoding"); got != "" {
			t.Errorf("Content-Encoding = %q, want empty (already-compressed binary must not be re-compressed)", got)
		}
		// The binary must be served byte-for-byte untouched, not merely with a
		// blank Content-Encoding.
		if got := rec.Body.Bytes(); !bytes.Equal(got, woff2) {
			t.Errorf("served body (%d bytes) does not match original woff2 (%d bytes)", len(got), len(woff2))
		}
		// An uncompressed asset keeps its byte-range advertisement; only the
		// gzip'ed representation drops it.
		if got := rec.Header().Get("Accept-Ranges"); got != "bytes" {
			t.Errorf("Accept-Ranges = %q, want %q for an uncompressed asset", got, "bytes")
		}
	})

	// Without an Accept-Encoding: gzip request header, even a compressible asset
	// must be served identity (uncompressed) so a client that cannot decode gzip
	// gets a usable body.
	t.Run("css asset is not compressed without Accept-Encoding", func(t *testing.T) {
		rec := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodGet, "/dist/asset.css", nil)
		mux.ServeHTTP(rec, req)

		if got := rec.Header().Get("Content-Encoding"); got != "" {
			t.Errorf("Content-Encoding = %q, want empty when the client does not advertise gzip", got)
		}
		if got := rec.Body.Bytes(); !bytes.Equal(got, css) {
			t.Errorf("served body (%d bytes) does not match original css (%d bytes)", len(got), len(css))
		}
	})

	// A ranged request to a compressible asset must not be gzip-encoded: the
	// 206 Content-Range describes offsets into the uncompressed file, which
	// cannot be reconciled with a gzip'ed body (RFC 7233). It must serve the
	// exact requested byte slice, uncompressed.
	t.Run("range request to css asset is not compressed", func(t *testing.T) {
		rec := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodGet, "/dist/asset.css", nil)
		req.Header.Set("Accept-Encoding", "gzip")
		req.Header.Set("Range", "bytes=0-9")
		mux.ServeHTTP(rec, req)

		if rec.Code != http.StatusPartialContent {
			t.Errorf("status = %d, want %d (206)", rec.Code, http.StatusPartialContent)
		}
		if got := rec.Header().Get("Content-Encoding"); got != "" {
			t.Errorf("Content-Encoding = %q, want empty for a ranged response", got)
		}
		if cr := rec.Header().Get("Content-Range"); cr == "" {
			t.Errorf("Content-Range header missing on 206 response")
		}
		if got := rec.Body.Bytes(); !bytes.Equal(got, css[:10]) {
			t.Errorf("body = %q, want the first 10 uncompressed bytes %q", got, css[:10])
		}
	})
}
