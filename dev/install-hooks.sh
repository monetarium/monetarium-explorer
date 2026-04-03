#!/usr/bin/env bash
# Installs git hooks from dev/hooks/ into .git/hooks/.
# Run once after cloning: ./dev/install-hooks.sh

set -e

ROOT=$(git rev-parse --show-toplevel)
HOOKS_SRC="$ROOT/dev/hooks"
HOOKS_DST="$ROOT/.git/hooks"

if [[ ! -d "$HOOKS_SRC" ]]; then
  echo "No hooks found in $HOOKS_SRC"
  exit 1
fi

for hook in "$HOOKS_SRC"/*; do
  name=$(basename "$hook")
  dest="$HOOKS_DST/$name"
  cp "$hook" "$dest"
  chmod +x "$dest"
  echo "Installed: .git/hooks/$name"
done

echo "All hooks installed."
