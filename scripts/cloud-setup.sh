#!/bin/bash
# Claude Code cloud-session bootstrap — no-op outside cloud VMs. #175 tracks
# the full ephemeral-VM story (capture hooks stay unavailable in cloud).
set -u
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

# gh is not in Ubuntu's default apt sources; install via GitHub's official repo
# (https://github.com/cli/cli/blob/trunk/docs/install_linux.md#debian).
if ! command -v gh >/dev/null 2>&1; then
  (
    (type -p wget >/dev/null || (sudo apt update && sudo apt install wget -y)) \
      && sudo mkdir -p -m 755 /etc/apt/keyrings \
      && out=$(mktemp) && wget -nv -O"$out" https://cli.github.com/packages/githubcli-archive-keyring.gpg \
      && cat "$out" | sudo tee /etc/apt/keyrings/githubcli-archive-keyring.gpg > /dev/null \
      && sudo chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg \
      && sudo mkdir -p -m 755 /etc/apt/sources.list.d \
      && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | sudo tee /etc/apt/sources.list.d/github-cli.list > /dev/null \
      && sudo apt update \
      && sudo apt install gh -y
  ) || echo "cloud-setup: gh install FAILED — GitHub CLI unavailable this session" >&2
fi
command -v mage >/dev/null 2>&1 || npm install -g mage-memory@latest >/dev/null 2>&1 || true
exit 0
