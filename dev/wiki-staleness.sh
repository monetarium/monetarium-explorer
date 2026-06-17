#!/usr/bin/env bash
# wiki-staleness.sh — flag drifted wiki/code-analysis traces.
# Contract: each wiki/code-analysis/<domain>/meta.yml carries `anchor` (commit the
# trace was last verified against) and `files` (covered code paths). A domain is
# STALE when any covered file changed since its anchor. See wiki/core/maintenance.md.
set -euo pipefail

ROOT=$(git rev-parse --show-toplevel)
CA_DIR="$ROOT/wiki/code-analysis"

STRICT=0
CHANGED_RANGE=""

usage() {
  cat <<'EOF'
Usage: dev/wiki-staleness.sh [--strict] [--changed <range>]
  (no flags)        Report STALE/FRESH/UNTRACKED for every code-analysis domain.
  --changed <range> Restrict report to domains touched by a git commit range.
  --strict          Exit non-zero if any in-scope domain is STALE.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --strict)  STRICT=1; shift ;;
    --changed) CHANGED_RANGE="${2:-}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "unknown arg: $1" >&2; usage >&2; exit 2 ;;
  esac
done

# --- meta.yml parsing -------------------------------------------------------
meta_anchor() { awk -F'[: ]+' '/^anchor:/{print $2; exit}' "$1"; }
meta_files()  {
  awk '
    /^files:/ {inlist=1; next}
    inlist && /^[[:space:]]*-[[:space:]]+/ { sub(/^[[:space:]]*-[[:space:]]+/, ""); print; next }
    inlist && /^[^[:space:]]/ {inlist=0}
  ' "$1"
}

valid_commit() { git -C "$ROOT" cat-file -e "${1}^{commit}" 2>/dev/null; }

# --- accumulators (strings, to dodge bash-3.2 array/set -u pitfalls) --------
STALE=""; FRESH=""; UNTRACKED=""; ERRORS=""
n_stale=0; n_fresh=0; n_untracked=0; n_errors=0

for dir in "$CA_DIR"/*/; do
  [[ -d "$dir" ]] || continue
  domain=$(basename "$dir")
  meta="${dir}meta.yml"

  if [[ ! -f "$meta" ]]; then
    [[ -n "$CHANGED_RANGE" ]] && continue            # cannot scope an untracked domain
    UNTRACKED="${UNTRACKED}  - ${domain}"$'\n'; n_untracked=$((n_untracked+1)); continue
  fi

  anchor=$(meta_anchor "$meta")
  covered=()
  while IFS= read -r line; do [[ -n "$line" ]] && covered+=("$line"); done < <(meta_files "$meta")

  if [[ -n "$CHANGED_RANGE" ]]; then
    [[ ${#covered[@]} -gt 0 ]] || continue
    touched=$(git -C "$ROOT" log --oneline "$CHANGED_RANGE" -- "${covered[@]}" 2>/dev/null | wc -l | tr -d ' ')
    [[ "$touched" -gt 0 ]] || continue
  fi

  if [[ -z "$anchor" ]] || ! valid_commit "$anchor"; then
    ERRORS="${ERRORS}  - ${domain}: invalid or missing anchor"$'\n'; n_errors=$((n_errors+1)); continue
  fi

  range="${anchor}..HEAD"
  commits=$(git -C "$ROOT" log --oneline "$range" -- "${covered[@]}" 2>/dev/null | wc -l | tr -d ' ')
  changed=$(git -C "$ROOT" log --name-only --pretty=format: "$range" -- "${covered[@]}" 2>/dev/null \
            | sed '/^$/d' | sort -u | wc -l | tr -d ' ')
  total=${#covered[@]}

  if [[ "$changed" -gt 0 ]]; then
    STALE="${STALE}  - ${domain}: ${commits} commit(s), ${changed}/${total} covered file(s) changed since ${anchor}"$'\n'
    n_stale=$((n_stale+1))
  else
    FRESH="${FRESH}  - ${domain}"$'\n'; n_fresh=$((n_fresh+1))
  fi
done

# --- report -----------------------------------------------------------------
echo "Wiki staleness report"
echo
echo "STALE (${n_stale}):"
[[ -n "$STALE" ]] && printf '%s' "$STALE"
echo "FRESH (${n_fresh}):"
[[ -n "$FRESH" ]] && printf '%s' "$FRESH"
echo "UNTRACKED (${n_untracked}):"
[[ -n "$UNTRACKED" ]] && printf '%s' "$UNTRACKED"
[[ "$n_untracked" -gt 0 ]] && echo "  (run: ./dev/wiki-staleness.sh --bootstrap)"
if [[ "$n_errors" -gt 0 ]]; then
  echo "ERRORS (${n_errors}):"
  printf '%s' "$ERRORS"
fi

if [[ "$STRICT" -eq 1 ]] && { [[ "$n_stale" -gt 0 ]] || [[ "$n_errors" -gt 0 ]]; }; then
  exit 1
fi
exit 0
