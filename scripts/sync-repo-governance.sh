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

need_value() { [[ $# -ge 2 ]] || { echo "error: $1 requires a value" >&2; exit 2; }; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo) need_value "$@"; REPO="$2"; shift 2 ;;
    --config) need_value "$@"; CONFIG="$2"; shift 2 ;;
    --dry-run) DRY_RUN="true"; shift ;;
    -h|--help) sed -n '2,30p' "$0"; exit 0 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

command -v gh >/dev/null || { echo "error: gh not found on PATH" >&2; exit 1; }
command -v jq >/dev/null || { echo "error: jq not found on PATH" >&2; exit 1; }
[[ -f "$CONFIG" ]] || { echo "error: config not found: $CONFIG" >&2; exit 1; }

# Reject malformed governance BEFORE any API call. Without this, a jq parse
# error or a wrong-shaped section is indistinguishable from "section absent",
# and the script silently skips it while still reporting success — the worst
# outcome for a tool whose job is to guarantee protection is applied.
jq -e . "$CONFIG" >/dev/null 2>&1 || { echo "error: $CONFIG is not valid JSON" >&2; exit 1; }
jq -e '
  ((has("settings") | not) or (.settings | type == "object"))
  and ((has("labels")  | not) or (.labels  | type == "array"))
  and ((has("ruleset") | not) or ((.ruleset | type == "object") and (.ruleset.name | type == "string")))
' "$CONFIG" >/dev/null 2>&1 || {
  echo "error: $CONFIG has a malformed section (.settings must be an object, .labels an array, .ruleset an object with a string .name)" >&2
  exit 1
}

if [[ -z "$REPO" ]]; then
  REPO="$(gh repo view --json nameWithOwner -q .nameWithOwner)"
fi

bold() { printf '\033[1m%s\033[0m\n' "$*"; }
info() { printf '  %s\n' "$*"; }
warn() { printf '\033[33m  ! %s\033[0m\n' "$*" >&2; }
# A governance sync that half-applies and still exits 0 is worse than one that
# fails: the repo looks synced and isn't. Every mutation and every lookup that
# decides create-vs-update goes through fail() on error.
fail() { printf '\033[31m  x %s\033[0m\n' "$*" >&2; exit 1; }

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
    || fail "settings PATCH failed (need admin?)"
  info "applied repository settings"
else
  info "no .settings in config — skipped"
fi

# ---------------------------------------------------------------------------
# 2. Labels (upsert: create if missing, else update color/description)
# ---------------------------------------------------------------------------
bold "Labels"
label_count="$(jq '(.labels // []) | length' "$CONFIG")"
if ((label_count > 0)); then
  # List labels ONCE, paginated. The previous per-label existence probe used
  # `gh api ... 2>/dev/null` and treated ANY failure — network, 403, rate limit —
  # as "label missing", falling through to create. It also never paginated.
  existing_labels="$(gh api --paginate "repos/$REPO/labels" | jq -s 'add // []')" \
    || fail "could not list labels for $REPO"

  for ((i = 0; i < label_count; i++)); do
    name="$(jq -r ".labels[$i].name" "$CONFIG")"
    enc="$(jq -rn --arg s "$name" '$s|@uri')"
    body="$(jq -c ".labels[$i]" "$CONFIG")"
    if printf '%s' "$existing_labels" | jq -e --arg n "$name" 'any(.[]; .name == $n)' >/dev/null; then
      echo "$body" | mutate api --method PATCH "repos/$REPO/labels/$enc" --input - >/dev/null \
        || fail "failed to update label: $name"
      info "updated label: $name"
    else
      echo "$body" | mutate api --method POST "repos/$REPO/labels" --input - >/dev/null \
        || fail "failed to create label: $name"
      info "created label: $name"
    fi
  done
fi

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
  # Resolve the existing ruleset by name. This lookup decides CREATE vs UPDATE,
  # so it must fail CLOSED: the old `|| true` turned any lookup error into
  # "none found" and fell through to CREATE, adding a SECOND overlapping ruleset
  # on the branch. Overlapping rulesets compose as a union of restrictions, so
  # that failure is silent, cumulative, and awkward to unpick. It also never
  # paginated — an existing ruleset beyond the first 30 was invisible.
  rs_list="$(gh api --paginate "repos/$REPO/rulesets" | jq -s 'add // []')" \
    || fail "could not list rulesets for $REPO — refusing to continue, since creating a duplicate is worse than doing nothing"
  rs_matches="$(printf '%s' "$rs_list" | jq --arg n "$rs_name" '[.[] | select(.name == $n)] | length')"
  ((rs_matches <= 1)) \
    || fail "found $rs_matches rulesets named \"$rs_name\" on $REPO — resolve by hand before syncing"
  rs_id="$(printf '%s' "$rs_list" | jq -r --arg n "$rs_name" 'first(.[] | select(.name == $n) | .id) // empty')"

  if [[ -n "$rs_id" ]]; then
    echo "$rs_body" | mutate api --method PUT "repos/$REPO/rulesets/$rs_id" --input - >/dev/null \
      || fail "failed to update ruleset: $rs_name (#$rs_id)"
    info "updated ruleset: $rs_name (#$rs_id)"
  else
    echo "$rs_body" | mutate api --method POST "repos/$REPO/rulesets" --input - >/dev/null \
      || fail "failed to create ruleset: $rs_name (Pro required for private repos)"
    info "created ruleset: $rs_name"
  fi
else
  info "no .ruleset in config — skipped"
fi

bold "Done."
