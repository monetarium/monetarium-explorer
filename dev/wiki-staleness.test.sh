#!/usr/bin/env bash
# Tests for dev/wiki-staleness.sh — builds a fixture git repo and asserts exact output.
set -uo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
DETECTOR="$SCRIPT_DIR/wiki-staleness.sh"
FAILED=0

# --- assertion helpers ------------------------------------------------------
assert_eq() { # $1=label $2=expected $3=actual
  if [[ "$2" != "$3" ]]; then
    echo "FAIL: $1"
    echo "--- expected ---"; printf '%s\n' "$2"
    echo "--- actual -----"; printf '%s\n' "$3"
    FAILED=1
  else
    echo "ok: $1"
  fi
}
assert_code() { # $1=label $2=expected_code $3=actual_code
  if [[ "$2" != "$3" ]]; then
    echo "FAIL: $1 (exit want=$2 got=$3)"; FAILED=1
  else
    echo "ok: $1 (exit $3)"
  fi
}

# --- fixture builder --------------------------------------------------------
# Creates a temp repo:
#   commit C0: code/block.go, code/win_a.go, code/win_b.go + meta.yml for block, windows, orphan(none)
#   commit C1: modify code/win_a.go  (so windows drifts; block stays fresh)
# anchors: block -> C0 (fresh), windows -> C0 (stale after C1)
make_fixture() {
  FIX=$(mktemp -d)
  git -C "$FIX" init -q
  git -C "$FIX" config user.email t@t && git -C "$FIX" config user.name t
  mkdir -p "$FIX/code" "$FIX/wiki/code-analysis/block" \
           "$FIX/wiki/code-analysis/windows" "$FIX/wiki/code-analysis/orphan"
  echo "package x" > "$FIX/code/block.go"
  echo "package x" > "$FIX/code/win_a.go"
  echo "package x" > "$FIX/code/win_b.go"
  echo "trace" > "$FIX/wiki/code-analysis/orphan/flow.full.md"  # no meta.yml -> UNTRACKED
  git -C "$FIX" add -A && git -C "$FIX" commit -q -m C0
  C0=$(git -C "$FIX" rev-parse --short HEAD)
  # write meta.yml anchored at C0
  printf 'domain: block\nanchor: %s\nfiles:\n  - code/block.go\n' "$C0" \
    > "$FIX/wiki/code-analysis/block/meta.yml"
  printf 'domain: windows\nanchor: %s\nfiles:\n  - code/win_a.go\n  - code/win_b.go\n' "$C0" \
    > "$FIX/wiki/code-analysis/windows/meta.yml"
  git -C "$FIX" add -A && git -C "$FIX" commit -q -m "add meta"
  C_META=$(git -C "$FIX" rev-parse --short HEAD)
  # drift windows by changing one covered file
  echo "// changed" >> "$FIX/code/win_a.go"
  git -C "$FIX" add -A && git -C "$FIX" commit -q -m C1
  C1=$(git -C "$FIX" rev-parse --short HEAD)
}

run() { ( cd "$FIX" && "$DETECTOR" "$@" ); }  # subshell so cwd resolves ROOT to fixture

# --- tests ------------------------------------------------------------------
make_fixture
EXPECTED_DEFAULT="Wiki staleness report

STALE (1):
  - windows: 1 commit(s), 1/2 covered file(s) changed since $C0
FRESH (1):
  - block
UNTRACKED (1):
  - orphan
  (run: ./dev/wiki-staleness.sh --bootstrap)"
ACTUAL_DEFAULT=$(run)
assert_eq "default report" "$EXPECTED_DEFAULT" "$ACTUAL_DEFAULT"

run >/dev/null; assert_code "default exit 0" 0 $?
run --strict >/dev/null; assert_code "strict exit 1 when stale" 1 $?

# --changed scoped to the C1 commit (only win_a.go) -> windows in scope, block not, orphan omitted
EXPECTED_CHANGED="Wiki staleness report

STALE (1):
  - windows: 1 commit(s), 1/2 covered file(s) changed since $C0
FRESH (0):
UNTRACKED (0):"
ACTUAL_CHANGED=$(run --changed "${C_META}..${C1}")
assert_eq "changed-scoped report" "$EXPECTED_CHANGED" "$ACTUAL_CHANGED"

rm -rf "$FIX"

# --- Fix 1: empty files list → FRESH ----------------------------------------
FIX2=$(mktemp -d)
git -C "$FIX2" init -q
git -C "$FIX2" config user.email t@t && git -C "$FIX2" config user.name t
mkdir -p "$FIX2/code" "$FIX2/wiki/code-analysis/nofiles"
echo "package x" > "$FIX2/code/stuff.go"
git -C "$FIX2" add -A && git -C "$FIX2" commit -q -m C0
C0_F2=$(git -C "$FIX2" rev-parse --short HEAD)
printf 'domain: nofiles\nanchor: %s\nfiles:\n' "$C0_F2" \
  > "$FIX2/wiki/code-analysis/nofiles/meta.yml"
git -C "$FIX2" add -A && git -C "$FIX2" commit -q -m "add meta"
# drift: change code file (should NOT affect nofiles domain)
echo "// changed" >> "$FIX2/code/stuff.go"
git -C "$FIX2" add -A && git -C "$FIX2" commit -q -m C1
run2() { ( cd "$FIX2" && "$DETECTOR" "$@" ); }
EXPECTED_EMPTYFILES="Wiki staleness report

STALE (0):
FRESH (1):
  - nofiles
UNTRACKED (0):"
ACTUAL_EMPTYFILES=$(run2)
assert_eq "empty files list → FRESH" "$EXPECTED_EMPTYFILES" "$ACTUAL_EMPTYFILES"

# --- Fix 2a: --strict exits 0 when all in-scope domains are FRESH ------------
# Reuse FIX2 fixture: nofiles is FRESH, no STALE domains
run2 --strict >/dev/null; assert_code "strict exit 0 when all fresh" 0 $?

# --- Fix 2b: invalid anchor → ERRORS section; --strict exits 1 --------------
FIX3=$(mktemp -d)
git -C "$FIX3" init -q
git -C "$FIX3" config user.email t@t && git -C "$FIX3" config user.name t
mkdir -p "$FIX3/code" "$FIX3/wiki/code-analysis/badanchor"
echo "package x" > "$FIX3/code/stuff.go"
printf 'domain: badanchor\nanchor: deadbeef\nfiles:\n  - code/stuff.go\n' \
  > "$FIX3/wiki/code-analysis/badanchor/meta.yml"
git -C "$FIX3" add -A && git -C "$FIX3" commit -q -m C0
run3() { ( cd "$FIX3" && "$DETECTOR" "$@" ); }
EXPECTED_ERRORS="Wiki staleness report

STALE (0):
FRESH (0):
UNTRACKED (0):
ERRORS (1):
  - badanchor: invalid or missing anchor"
ACTUAL_ERRORS=$(run3)
assert_eq "invalid anchor → ERRORS section" "$EXPECTED_ERRORS" "$ACTUAL_ERRORS"
run3 --strict >/dev/null; assert_code "strict exit 1 when errors" 1 $?

rm -rf "$FIX2" "$FIX3"
[[ $FAILED -eq 0 ]] && echo "ALL PASS" || { echo "SOME FAILED"; exit 1; }
