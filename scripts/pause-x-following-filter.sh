#!/usr/bin/env bash
set -euo pipefail

LABEL="com.lban.ai-content.x-following-filter"
PLIST="$HOME/Library/LaunchAgents/${LABEL}.plist"
DOMAIN="gui/$(id -u)"

if [[ ! -f "$PLIST" ]]; then
  echo "not installed: $PLIST"
  exit 0
fi

launchctl bootout "$DOMAIN" "$PLIST" 2>/dev/null || true
launchctl disable "${DOMAIN}/${LABEL}" 2>/dev/null || true

echo "paused: ${LABEL}"
