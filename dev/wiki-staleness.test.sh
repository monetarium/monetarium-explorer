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
[[ $FAILED -eq 0 ]] && echo "ALL PASS" || { echo "SOME FAILED"; exit 1; }
