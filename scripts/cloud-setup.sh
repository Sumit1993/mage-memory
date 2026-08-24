#!/bin/bash
# Ephemeral-VM setup script for mage and GitHub CLI (#175).
set -u


# Root containers often ship without sudo; non-root sessions need it. With neither, the apt
# install below cannot succeed — skip it rather than warn and then fail loudly anyway. #176.
SUDO=""
CAN_INSTALL=yes
if [ "$(id -u)" -ne 0 ]; then
  if command -v sudo >/dev/null 2>&1; then
    SUDO="sudo"
  else
    CAN_INSTALL=no
  fi
fi

# gh is not in Ubuntu's default apt sources; install via GitHub's official repo
# (https://github.com/cli/cli/blob/trunk/docs/install_linux.md#debian).
if ! command -v gh >/dev/null 2>&1; then
  if [ "$CAN_INSTALL" = no ]; then
    echo "cloud-setup: need root or sudo to install gh — skipping" >&2
  else
    (
      (type -p wget >/dev/null || ($SUDO apt update && $SUDO apt install wget -y)) \
        && $SUDO mkdir -p -m 755 /etc/apt/keyrings \
        && out=$(mktemp) && wget -nv -O"$out" https://cli.github.com/packages/githubcli-archive-keyring.gpg \
        && cat "$out" | $SUDO tee /etc/apt/keyrings/githubcli-archive-keyring.gpg > /dev/null \
        && $SUDO chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg \
        && $SUDO mkdir -p -m 755 /etc/apt/sources.list.d \
        && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | $SUDO tee /etc/apt/sources.list.d/github-cli.list > /dev/null \
        && $SUDO apt update \
        && $SUDO apt install gh -y
    ) || echo "cloud-setup: gh install FAILED — GitHub CLI unavailable this session" >&2
  fi
fi
# Needs $SUDO like the gh path: a root-owned global npm prefix (the usual apt-Node layout)
# fails EACCES for a non-root session. Attempted even without sudo — a user-owned prefix
# succeeds — but never silently: this is the tool the hook exists to install. #176.
if ! command -v mage >/dev/null 2>&1; then
  $SUDO npm install -g mage-memory@latest >/dev/null 2>&1 \
    || echo "cloud-setup: mage install FAILED — mage-memory unavailable this session" >&2
fi
exit 0
