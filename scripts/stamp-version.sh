#!/bin/sh
# Stamp build info into version.json
# Installed via tracked hooks: git config core.hooksPath .githooks
#
# The commit hash will be one-behind (HEAD at pre-commit time), but the build
# number is what matters for identifying deployed versions. The hash is a bonus.

REPO_ROOT="$(git rev-parse --show-toplevel)"
COUNT="$(git rev-list --count HEAD 2>/dev/null || echo 0)"
COUNT=$((COUNT + 1))
HASH="$(git rev-parse --short HEAD 2>/dev/null || echo 'initial')"
DATE="$(date -u +%Y-%m-%d)"
LATEST_CHANGE_JSON="$(node "$REPO_ROOT/scripts/latest-changelog-entry.mjs")"

printf '{"build":%s,"commit":"%s","date":"%s","latestChange":%s}\n' \
    "$COUNT" "$HASH" "$DATE" "$LATEST_CHANGE_JSON" > "$REPO_ROOT/version.json"

git add "$REPO_ROOT/version.json" 2>/dev/null
