#!/usr/bin/env bash
#
# sync-repo-governance.sh — apply repository governance (settings, labels, and a
# branch-protection ruleset) from a declarative config, idempotently, via `gh api`.
#
# This is the "way to automate the rules and settings": edit .github/governance.json,
# then run this script (locally with an admin `gh auth`, or from the governance
# workflow with a PAT). Re-running is safe — settings are PATCHed, labels are
# upserted, and the ruleset is created-or-updated by name.
#
# Usage:
#   scripts/sync-repo-governance.sh [--repo owner/name] [--config path] [--dry-run]
#
#   --repo     owner/name to apply to (default: the repo of the current directory)
#   --config   path to the governance JSON (default: .github/governance.json)
#   --dry-run  print what would change; perform no mutations (read calls still run)
#
# Requirements: gh (authenticated), jq. Managing rulesets/settings needs admin on
# the repo; in CI use a PAT with "Administration: read/write" (not GITHUB_TOKEN).
# NOTE: repository rulesets require GitHub Pro (or a public repo) for PRIVATE repos.
set -euo pipefail

REPO=""
CONFIG=".github/governance.json"
DRY_RUN="false"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo) REPO="$2"; shift 2 ;;
    --config) CONFIG="$2"; shift 2 ;;
    --dry-run) DRY_RUN="true"; shift ;;
    -h|--help) sed -n '2,30p' "$0"; exit 0 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

command -v gh >/dev/null || { echo "error: gh not found on PATH" >&2; exit 1; }
command -v jq >/dev/null || { echo "error: jq not found on PATH" >&2; exit 1; }
[[ -f "$CONFIG" ]] || { echo "error: config not found: $CONFIG" >&2; exit 1; }

if [[ -z "$REPO" ]]; then
  REPO="$(gh repo view --json nameWithOwner -q .nameWithOwner)"
fi

bold() { printf '\033[1m%s\033[0m\n' "$*"; }
info() { printf '  %s\n' "$*"; }
warn() { printf '\033[33m  ! %s\033[0m\n' "$*" >&2; }

# Run a MUTATING gh call, or just print it under --dry-run. In dry-run we still
# drain any piped stdin (so the upstream jq/echo doesn't take SIGPIPE and trip
# `pipefail`) and print the preview to stderr (callers redirect stdout to /dev/null
# to hide gh's JSON response in real mode).
mutate() {
  if [[ "$DRY_RUN" == "true" ]]; then
    [[ -t 0 ]] || cat >/dev/null 2>&1 || true
    printf '\033[2m  [dry-run] gh %s\033[0m\n' "$*" >&2
    return 0
  fi
  gh "$@"
}

bold "Repository: $REPO   (config: $CONFIG${DRY_RUN:+ , dry-run=$DRY_RUN})"
IS_PRIVATE="$(gh api "repos/$REPO" --jq .private 2>/dev/null || echo "unknown")"

# ---------------------------------------------------------------------------
# 1. Repository settings
# ---------------------------------------------------------------------------
bold "Settings"
if jq -e '.settings' "$CONFIG" >/dev/null; then
  jq -c '.settings' "$CONFIG" | mutate api --method PATCH "repos/$REPO" --input - >/dev/null \
    && info "applied repository settings" \
    || warn "settings PATCH failed (need admin?)"
else
  info "no .settings in config — skipped"
fi

# ---------------------------------------------------------------------------
# 2. Labels (upsert: create if missing, else update color/description)
# ---------------------------------------------------------------------------
bold "Labels"
label_count="$(jq '.labels | length' "$CONFIG" 2>/dev/null || echo 0)"
for ((i = 0; i < label_count; i++)); do
  name="$(jq -r ".labels[$i].name" "$CONFIG")"
  enc="$(jq -rn --arg s "$name" '$s|@uri')"
  body="$(jq -c ".labels[$i]" "$CONFIG")"
  if gh api "repos/$REPO/labels/$enc" >/dev/null 2>&1; then
    echo "$body" | mutate api --method PATCH "repos/$REPO/labels/$enc" --input - >/dev/null \
      && info "updated label: $name" || warn "failed to update label: $name"
  else
    echo "$body" | mutate api --method POST "repos/$REPO/labels" --input - >/dev/null \
      && info "created label: $name" || warn "failed to create label: $name"
  fi
done

# ---------------------------------------------------------------------------
# 3. Branch-protection ruleset (create-or-update by name)
# ---------------------------------------------------------------------------
bold "Ruleset"
if jq -e '.ruleset' "$CONFIG" >/dev/null; then
  rs_name="$(jq -r '.ruleset.name' "$CONFIG")"
  rs_body="$(jq -c '.ruleset' "$CONFIG")"
  if [[ "$IS_PRIVATE" == "true" ]]; then
    warn "repo is PRIVATE — rulesets require GitHub Pro; the call may 403."
  fi
  # Existing ruleset id by name (empty if none / not readable).
  rs_id="$(gh api "repos/$REPO/rulesets" --jq ".[] | select(.name==\"$rs_name\") | .id" 2>/dev/null || true)"
  if [[ -n "$rs_id" ]]; then
    echo "$rs_body" | mutate api --method PUT "repos/$REPO/rulesets/$rs_id" --input - >/dev/null \
      && info "updated ruleset: $rs_name (#$rs_id)" || warn "failed to update ruleset: $rs_name"
  else
    echo "$rs_body" | mutate api --method POST "repos/$REPO/rulesets" --input - >/dev/null \
      && info "created ruleset: $rs_name" || warn "failed to create ruleset: $rs_name (Pro required for private repos)"
  fi
else
  info "no .ruleset in config — skipped"
fi

bold "Done."
