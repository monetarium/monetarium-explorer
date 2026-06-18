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

# --- bootstrap test ---------------------------------------------------------
make_fixture
# orphan has no meta.yml; give its trace a code ref + a HEAD= marker
printf 'See cmd/app/main.go for detail. Revised at HEAD=%s.\n' "$C0" \
  > "$FIX/wiki/code-analysis/orphan/flow.full.md"
mkdir -p "$FIX/cmd/app"; echo "package main" > "$FIX/cmd/app/main.go"
( cd "$FIX" && git add -A && git commit -q -m "orphan trace + code" )
run --bootstrap >/dev/null
BOOT_META="$FIX/wiki/code-analysis/orphan/meta.yml"
EXPECTED_BOOT="domain: orphan
anchor: $C0
files:
  - cmd/app/main.go"
ACTUAL_BOOT=$(cat "$BOOT_META")
assert_eq "bootstrap draft meta.yml" "$EXPECTED_BOOT" "$ACTUAL_BOOT"
# does not overwrite existing (block already has meta.yml)
BEFORE=$(cat "$FIX/wiki/code-analysis/block/meta.yml")
run --bootstrap >/dev/null
AFTER=$(cat "$FIX/wiki/code-analysis/block/meta.yml")
assert_eq "bootstrap leaves existing meta.yml untouched" "$BEFORE" "$AFTER"
rm -rf "$FIX"

# --- Fix 3: no anchor found → skip, no meta.yml written -----------------------
FIX4=$(mktemp -d)
git -C "$FIX4" init -q
git -C "$FIX4" config user.email t@t && git -C "$FIX4" config user.name t
mkdir -p "$FIX4/code" "$FIX4/wiki/code-analysis/block" "$FIX4/wiki/code-analysis/noanchor"
echo "package x" > "$FIX4/code/block.go"
git -C "$FIX4" add -A && git -C "$FIX4" commit -q -m C0
C0_F4=$(git -C "$FIX4" rev-parse --short HEAD)
printf 'domain: block\nanchor: %s\nfiles:\n  - code/block.go\n' "$C0_F4" \
  > "$FIX4/wiki/code-analysis/block/meta.yml"
git -C "$FIX4" add -A && git -C "$FIX4" commit -q -m "add block meta"
# Create brand-new noanchor domain NOT committed; has prose but no HEAD= marker and no code refs
mkdir -p "$FIX4/wiki/code-analysis/noanchor"
echo "prose with no markers" > "$FIX4/wiki/code-analysis/noanchor/flow.full.md"
run4() { ( cd "$FIX4" && "$DETECTOR" "$@" ); }
OUT_NOANCHOR=$(run4 --bootstrap)
# Assert: message 'skip (no anchor found): noanchor' appears in output
case "$OUT_NOANCHOR" in
  *"skip (no anchor found): noanchor"*) echo "ok: bootstrap skip message for no anchor" ;;
  *) echo "FAIL: bootstrap skip message for no anchor"; echo "--- output ---"; printf '%s\n' "$OUT_NOANCHOR"; FAILED=1 ;;
esac
# Assert: meta.yml was NOT created
if [[ ! -f "$FIX4/wiki/code-analysis/noanchor/meta.yml" ]]; then
  echo "ok: bootstrap did not create meta.yml with no anchor"
else
  echo "FAIL: bootstrap created meta.yml with no anchor"; FAILED=1
fi
rm -rf "$FIX4"

# --- Fix 4: malformed --changed range → exit 2 with error message ------
make_fixture
OUT=$(run --changed "deadbeef0000..cafebabe0000" 2>&1); CODE=$?
assert_code "invalid --changed range exits 2" 2 $CODE
case "$OUT" in
  *"invalid range:"*) echo "ok: invalid range message printed" ;;
  *) echo "FAIL: invalid range message missing"; FAILED=1 ;;
esac
rm -rf "$FIX"

# --- pre-push hook smoke test ----------------------------------------------
make_fixture
HOOK="$SCRIPT_DIR/hooks/pre-push"
# Copy detector into the fixture so the hook can find it (fixture ROOT resolves to $FIX)
mkdir -p "$FIX/dev"
cp "$SCRIPT_DIR/wiki-staleness.sh" "$FIX/dev/wiki-staleness.sh"
chmod +x "$FIX/dev/wiki-staleness.sh"
# simulate pushing the C_META..C1 range over stdin; warn-only must exit 0 and mention windows
OUT=$( ( cd "$FIX" && printf 'refs/heads/x %s refs/heads/x %s\n' "$C1" "$C_META" | "$HOOK" origin file://"$FIX" ) ); CODE=$?
assert_code "pre-push warn-only exits 0" 0 $CODE
case "$OUT" in *"windows"*) echo "ok: pre-push reports stale windows";; *) echo "FAIL: pre-push missing windows"; FAILED=1;; esac
# strict mode blocks (non-zero) when stale
( cd "$FIX" && printf 'refs/heads/x %s refs/heads/x %s\n' "$C1" "$C_META" | WIKI_STALENESS_STRICT=1 "$HOOK" origin file://"$FIX" ) >/dev/null; CODE=$?
assert_code "pre-push strict blocks when stale" 1 $CODE
# multi-ref push must check EVERY ref's range, not just the last one (regression)
echo "// blockchange" >> "$FIX/code/block.go"
git -C "$FIX" add -A && git -C "$FIX" commit -q -m C2
C2=$(git -C "$FIX" rev-parse --short HEAD)
# ref a's range (C_META..C1) drifts windows; ref b's range (C1..C2) drifts block
OUT=$( ( cd "$FIX" && printf 'refs/heads/a %s refs/heads/a %s\nrefs/heads/b %s refs/heads/b %s\n' "$C1" "$C_META" "$C2" "$C1" | "$HOOK" origin file://"$FIX" ) ); CODE=$?
assert_code "pre-push multi-ref exits 0 (warn-only)" 0 $CODE
case "$OUT" in *windows*) echo "ok: multi-ref reports windows (ref a)" ;; *) echo "FAIL: multi-ref dropped windows (ref a)"; FAILED=1 ;; esac
case "$OUT" in *"- block"*)   echo "ok: multi-ref reports block (ref b)" ;;   *) echo "FAIL: multi-ref dropped block (ref b)"; FAILED=1 ;; esac
rm -rf "$FIX"

# --- new-branch base resolution (remote_sha all-zero, no remote ref yet) -----
Z40=0000000000000000000000000000000000000000
copy_detector() { mkdir -p "$1/dev"; cp "$SCRIPT_DIR/wiki-staleness.sh" "$1/dev/wiki-staleness.sh"; chmod +x "$1/dev/wiki-staleness.sh"; }

# (A) origin/develop present → scope to the fork (windows changed in C_META..C1; block did not)
make_fixture; copy_detector "$FIX"
git -C "$FIX" update-ref refs/remotes/origin/develop "$C_META"
OUT=$( ( cd "$FIX" && printf 'refs/heads/feature %s refs/heads/feature %s\n' "$C1" "$Z40" | "$HOOK" origin file://"$FIX" ) 2>&1 ); CODE=$?
assert_code "new-branch via develop exits 0" 0 $CODE
case "$OUT" in *windows*) echo "ok: new-branch scopes via develop (windows)" ;; *) echo "FAIL: new-branch develop dropped windows"; FAILED=1 ;; esac
case "$OUT" in *"- block"*) echo "FAIL: new-branch over-scoped to block"; FAILED=1 ;; *) echo "ok: new-branch did not over-scope to block" ;; esac
rm -rf "$FIX"

# (B) develop absent, origin/HEAD→origin/main present → fall back to default branch
make_fixture; copy_detector "$FIX"
git -C "$FIX" update-ref refs/remotes/origin/main "$C_META"
git -C "$FIX" symbolic-ref refs/remotes/origin/HEAD refs/remotes/origin/main
OUT=$( ( cd "$FIX" && printf 'refs/heads/feature %s refs/heads/feature %s\n' "$C1" "$Z40" | "$HOOK" origin file://"$FIX" ) 2>&1 ); CODE=$?
assert_code "new-branch via origin/HEAD fallback exits 0" 0 $CODE
case "$OUT" in *windows*) echo "ok: new-branch falls back to origin/HEAD (windows)" ;; *) echo "FAIL: origin/HEAD fallback dropped windows"; FAILED=1 ;; esac
case "$OUT" in *"- block"*) echo "FAIL: origin/HEAD fallback over-scoped to block (full history?)"; FAILED=1 ;; *) echo "ok: origin/HEAD fallback did not over-scope" ;; esac
rm -rf "$FIX"

# (C) no develop, no origin/HEAD → skip the ref (must NOT enumerate full history)
make_fixture; copy_detector "$FIX"
OUT=$( ( cd "$FIX" && printf 'refs/heads/feature %s refs/heads/feature %s\n' "$C1" "$Z40" | "$HOOK" origin file://"$FIX" ) 2>&1 ); CODE=$?
assert_code "new-branch with no base exits 0" 0 $CODE
case "$OUT" in *skipping*) echo "ok: no-base new-branch skips" ;; *) echo "FAIL: no-base new-branch did not skip"; FAILED=1 ;; esac
case "$OUT" in *"- block"*) echo "FAIL: no-base enumerated full history (block over-scoped)"; FAILED=1 ;; *) echo "ok: no-base did not enumerate full history" ;; esac
rm -rf "$FIX"

rm -rf "$FIX2" "$FIX3"
[[ $FAILED -eq 0 ]] && echo "ALL PASS" || { echo "SOME FAILED"; exit 1; }
