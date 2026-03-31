#!/usr/bin/env bash
set -euo pipefail

LABEL="com.lban.ai-content.x-following-filter"
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SOURCE_PLIST="${REPO_ROOT}/ops/launchd/${LABEL}.plist"
TARGET_PLIST="$HOME/Library/LaunchAgents/${LABEL}.plist"
DOMAIN="gui/$(id -u)"

mkdir -p "$HOME/Library/LaunchAgents"
cp "$SOURCE_PLIST" "$TARGET_PLIST"

launchctl bootout "$DOMAIN" "$TARGET_PLIST" 2>/dev/null || true
launchctl bootstrap "$DOMAIN" "$TARGET_PLIST"
launchctl enable "${DOMAIN}/${LABEL}"
launchctl kickstart -k "${DOMAIN}/${LABEL}"

echo "resumed: ${LABEL}"
