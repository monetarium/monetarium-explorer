// Copyright (c) 2026, The Monetarium developers
// See LICENSE for details.

package main

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
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
