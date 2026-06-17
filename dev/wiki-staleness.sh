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
MODE=""

usage() {
  cat <<'EOF'
Usage: dev/wiki-staleness.sh [--strict] [--changed <range>] [--bootstrap]
  (no flags)        Report STALE/FRESH/UNTRACKED for every code-analysis domain.
  --changed <range> Restrict report to domains touched by a git commit range.
  --strict          Exit non-zero if any in-scope domain is STALE.
  --bootstrap       Write draft meta.yml for every domain lacking one.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --strict)    STRICT=1; shift ;;
    --changed)   CHANGED_RANGE="${2:-}"; shift 2 ;;
    --bootstrap) MODE="bootstrap"; shift ;;
    -h|--help)   usage; exit 0 ;;
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

bootstrap_domain() { # $1 = domain dir (trailing slash)
  local dir="$1" domain meta anchor files f
  domain=$(basename "$dir")
  meta="${dir}meta.yml"
  if [[ -f "$meta" ]]; then echo "skip (exists): $domain"; return; fi

  anchor=$(grep -rhoE 'HEAD=[0-9a-f]{7,40}' "$dir" 2>/dev/null | head -1 | sed 's/HEAD=//' || true)
  if [[ -z "$anchor" ]]; then
    anchor=$(git -C "$ROOT" log -1 --format=%h -- "wiki/code-analysis/${domain}/" 2>/dev/null || true)
  fi

  if [[ -z "$anchor" ]]; then
    echo "skip (no anchor found): $domain"
    return
  fi

  files=$(grep -rhoE '[A-Za-z0-9_./-]+\.(go|tmpl|js|scss|sql)' "$dir" 2>/dev/null \
          | sed -E 's#^(\.\./)+##; s/[):,.]*$//' | sort -u || true)

  {
    echo "domain: $domain"
    echo "anchor: $anchor"
    echo "files:"
    while IFS= read -r f; do
      [[ -z "$f" ]] && continue
      [[ -e "$ROOT/$f" ]] && echo "  - $f"
    done <<EOF
$files
EOF
  } > "$meta"
  echo "wrote draft: wiki/code-analysis/${domain}/meta.yml (review before committing)"
}

if [[ "$MODE" == "bootstrap" ]]; then
  for dir in "$CA_DIR"/*/; do [[ -d "$dir" ]] && bootstrap_domain "$dir"; done
  exit 0
fi

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

  if [[ ${#covered[@]} -eq 0 ]]; then
    FRESH="${FRESH}  - ${domain}"$'\n'; n_fresh=$((n_fresh+1)); continue
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
