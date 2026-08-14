#!/bin/bash
# Claude Code cloud-session bootstrap — no-op outside cloud VMs. #175 tracks
# the full ephemeral-VM story (capture hooks stay unavailable in cloud).
set -u
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

command -v gh >/dev/null 2>&1 || { apt-get update -qq >/dev/null && apt-get install -y -qq gh >/dev/null; } || true
command -v mage >/dev/null 2>&1 || npm install -g mage-memory@latest >/dev/null 2>&1 || true
exit 0
