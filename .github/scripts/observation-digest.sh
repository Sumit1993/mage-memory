#!/usr/bin/env bash
# Daily digest for the CLI-first observation week.
#
# WHY THIS AND NOT A REMINDER
# ---------------------------
# A reminder that fires in a week only tells you to go *find* the evidence, by
# which time the interesting events have scrolled past. This collects the
# evidence as it happens, so the decision at the end is made from numbers.
#
# The decision it exists to serve: promote the CLI-first lane to prismalens and
# sreforge, or revert it (branch ci/cli-first-valve-REVERT).
#
# No model, no subscription cost — gh api and jq only.
# Tracked in prismalens/prismalens#301.
#
# Usage:  REPO=owner/name ISSUE=<n> ./observation-digest.sh [--dry-run]
set -uo pipefail

REPO="${REPO:?REPO must be set}"
ISSUE="${ISSUE:?ISSUE must be set (digest target issue number in $REPO)}"
DRY="${1:-}"
TODAY=$(date -u +%F)
MARKER="<!-- obs-digest: $TODAY -->"
WINDOW_DAYS=8   # how far back to scan PRs; the week plus a day of margin

say () { echo "$@" >&2; }

# --- read prior digests once, failing loudly ------------------------------
# A 404 here (wrong issue, wrong repo) must not be mistaken for "no prior
# digests" — that would silently restart the day counter and post duplicates.
comments=$(gh api "repos/$REPO/issues/$ISSUE/comments?per_page=100" --paginate 2>/dev/null) || {
  say "ERROR: cannot read comments on $REPO#$ISSUE — is ISSUE correct and in THIS repo?"; exit 1; }
jq -e 'type == "array"' >/dev/null 2>&1 <<<"$comments" || {
  say "ERROR: unexpected response reading $REPO#$ISSUE (not an array) — refusing to guess"; exit 1; }

# --- idempotency -----------------------------------------------------------
# schedule events are delayed or dropped under load, so this may fire late or
# twice. One digest per calendar day, matched on the marker.
existing=$(jq -r --arg m "$MARKER" '[.[]|select(.body|contains($m))|.id]|if length>0 then .[0]|tostring else empty end' <<<"$comments")
if [ -n "$existing" ] && [ "$DRY" != "--dry-run" ]; then
  say "digest for $TODAY already posted (comment $existing) — nothing to do"; exit 0
fi

# --- day number, self-bootstrapping ----------------------------------------
# Day 1 is the first digest. No config and no stored start date to drift.
first_day=$(jq -r '[.[]|select(.body|test("<!-- obs-digest: "))|.created_at]|if length>0 then (.[0][0:10]) else empty end' <<<"$comments")
if [[ "$first_day" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]]; then
  DAY=$(( ( $(date -u -d "$TODAY" +%s) - $(date -u -d "$first_day" +%s) ) / 86400 + 1 ))
else
  DAY=1
fi

since=$(date -u -d "$WINDOW_DAYS days ago" +%FT%TZ)
yday=$(date -u -d "1 day ago" +%FT%TZ)

# --- observation floor ------------------------------------------------------
# Merges from BEFORE the gate existed must not be counted as gate failures.
# #127 is the worked example: it introduced the gate, and merged without a
# review-evidence status because `pull_request_target` cannot run until the
# workflow is on the base branch. Correct history, but it is not a hole — and a
# digest that cries wolf on day 1 will not be believed on day 7.
#
# Floor = when observation began: the first digest comment, or this run if none.
floor=$(jq -r '[.[]|select(.body|test("<!-- obs-digest: "))|.created_at]|if length>0 then .[0] else empty end' <<<"$comments")
if [ -z "$floor" ]; then floor=$(date -u +%FT%TZ); CLIPPED=1; else CLIPPED=0; fi
# Never look further back than the floor, however wide the 24h window is.
[[ "$yday" < "$floor" ]] && yday="$floor"

prs=$(gh api "repos/$REPO/pulls?state=all&sort=updated&direction=desc&per_page=100" --paginate 2>/dev/null) \
  || { say "ERROR: cannot list PRs"; exit 1; }

# Narrow to the window once; every count below derives from this set.
scope=$(jq --arg since "$since" '[ .[] | select(.updated_at >= $since) ]' <<<"$prs")

opened=$(jq --arg d "$yday" '[.[]|select(.created_at >= $d)]|length' <<<"$scope")
merged_ids=$(jq -r --arg d "$yday" '.[]|select(.merged_at != null and .merged_at >= $d)|.number' <<<"$scope")
merged_total=$(jq --arg d "$yday" '[.[]|select(.merged_at != null and .merged_at >= $d)]|length' <<<"$scope")

# --- classify each merge by the evidence that let it through ---------------
by_cli=0; by_review=0; by_bot=0; by_none=0; none_list=""
for n in $merged_ids; do
  sha=$(jq -r --argjson n "$n" '.[]|select(.number==$n)|.head.sha' <<<"$scope")
  desc=$(gh api "repos/$REPO/commits/$sha/status" \
         --jq '[.statuses[]?|select(.context=="review-evidence")][0].description // ""' 2>/dev/null)
  case "$desc" in
    *"CLI review evidence"*)   by_cli=$((by_cli+1)) ;;
    *"Reviewed by"*)           by_review=$((by_review+1)) ;;
    *"Bot-authored"*|*"Generated release PR"*) by_bot=$((by_bot+1)) ;;
    *)                         by_none=$((by_none+1)); none_list="$none_list #$n" ;;
  esac
done

# --- the escalation rate: how often an online review was actually wanted ---
escalated=0
for n in $(jq -r --arg d "$yday" '.[]|select(.created_at >= $d)|.number' <<<"$scope"); do
  if gh api "repos/$REPO/issues/$n/events?per_page=100" --paginate \
       --jq '.[]|select(.event=="labeled")|.label.name' 2>/dev/null | grep -qx 'review-ready'; then
    escalated=$((escalated+1))
  fi
done

# --- online reviews actually consumed, and gate health --------------------
online=0; errors=0
for n in $(jq -r '.[].number' <<<"$scope"); do
  c=$(gh api "repos/$REPO/pulls/$n/reviews?per_page=100" --paginate \
      --jq --arg d "$yday" '[.[]|select(.user.login=="coderabbitai[bot]" and .submitted_at >= $d)]|length' 2>/dev/null)
  online=$(( online + ${c:-0} ))
  sha=$(jq -r --argjson n "$n" '.[]|select(.number==$n)|.head.sha' <<<"$scope")
  e=$(gh api "repos/$REPO/commits/$sha/status" \
      --jq '[.statuses[]?|select(.context=="review-evidence" and .state=="error")]|length' 2>/dev/null)
  errors=$(( errors + ${e:-0} ))
done

ratelimited=$(gh api "repos/$REPO/issues/comments?per_page=100&since=$yday" --paginate \
              --jq '[.[]|select(.user.login=="coderabbitai[bot]" and (.body|test("rate limited by coderabbit")))]|length' 2>/dev/null)

# --- verdict line ----------------------------------------------------------
if [ "$by_none" -gt 0 ]; then
  verdict="🔴 **$by_none merge(s) with no review evidence:**$none_list — the gate has a hole. Investigate before anything else."
elif [ "$errors" -gt 0 ]; then
  verdict="🟠 **$errors gate error state(s)** — the gate could not determine evidence. False reds block legitimate work."
elif [ "$opened" -gt 0 ] && [ "$escalated" -eq "$opened" ]; then
  verdict="🟠 Every PR opened was escalated to \`review-ready\`. If this holds, the valve is buying nothing and should be reverted."
else
  verdict="🟢 Nothing anomalous."
fi

hdr="### Day $DAY — $TODAY"
[ "$DAY" -ge 7 ] && hdr="### Day $DAY — $TODAY · ⏰ DECISION DUE"

clip_note=""
[ "$CLIPPED" = "1" ] && clip_note="
> First digest: the window starts here, so counts are near-zero by construction.
> Merges from before the gate existed are deliberately excluded — #127 introduced
> the gate and merged without a status because \`pull_request_target\` cannot run
> until the workflow is on the base branch. Correct history, not a hole.
"

body=$(cat <<EOF
$MARKER
$hdr

| Metric | Last 24h | Decides |
|---|---:|---|
| PRs opened | $opened | baseline |
| PRs merged | $merged_total | baseline |
| ├ via CLI evidence | $by_cli | is the CLI lane carrying the load? |
| ├ via CodeRabbit review | $by_review | how often the scarce counter was spent |
| ├ via bot/release exemption | $by_bot | noise floor |
| └ **with NO evidence** | **$by_none** | **must stay 0 — non-zero means the gate has a hole** |
| \`review-ready\` escalations | $escalated | if this approaches "PRs opened", the valve buys nothing |
| Online reviews consumed | $online | pressure on the scarce counter |
| Gate \`error\` states | $errors | false reds blocking legitimate work |
| Rate-limit events | ${ratelimited:-0} | did starvation just move rather than resolve? |

$verdict
$clip_note
<sub>Window: $yday → now. Auto-generated. Decision this serves: promote the CLI-first lane to \`prismalens\` and \`sreforge\`, or land \`ci/cli-first-valve-REVERT\`. Context: prismalens/prismalens#301</sub>
EOF
)

if [ "$DRY" = "--dry-run" ]; then printf '%s\n' "$body"; exit 0; fi
gh api -X POST "repos/$REPO/issues/$ISSUE/comments" -f body="$body" --silent \
  && say "posted day $DAY digest to $REPO#$ISSUE" \
  || { say "ERROR: failed to post digest"; exit 1; }
