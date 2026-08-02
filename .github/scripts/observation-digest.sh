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

# Fetch a paginated REST array as ONE json array.
#
# `gh api --paginate` may emit one array per page; `-s add` normalises that to a
# single array whether it emitted one document or many. review-evidence.sh does
# the same thing — this is deliberately the identical shape so the two scripts do
# not drift on the one detail that silently truncates results to page 1.
#   rc 0 = json array on stdout, rc 1 = could not fetch
api_array () { # api_array <path>
  local raw
  raw=$(gh api --paginate "$1" 2>/dev/null) || return 1
  jq -s 'add // []' <<<"$raw" 2>/dev/null || return 1
}

# --- read prior digests once, failing loudly ------------------------------
# A 404 here (wrong issue, wrong repo) must not be mistaken for "no prior
# digests" — that would silently restart the day counter and post duplicates.
comments=$(api_array "repos/$REPO/issues/$ISSUE/comments?per_page=100") || {
  say "ERROR: cannot read comments on $REPO#$ISSUE — is ISSUE correct and in THIS repo?"; exit 1; }

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

# Deliberately NOT paginated: sorted by updated desc, so the first 100 cover any
# window this repo can fill in WINDOW_DAYS. Paginating would walk every PR ever
# opened on each daily run and grow without bound. If the page turns out not to
# reach back past `since`, the window is truncated and the digest says so.
prs=$(gh api "repos/$REPO/pulls?state=all&sort=updated&direction=desc&per_page=100" 2>/dev/null) \
  || { say "ERROR: cannot list PRs"; exit 1; }
oldest=$(jq -r 'if length>0 then (.[-1].updated_at) else "" end' <<<"$prs")
TRUNCATED=0
[ -n "$oldest" ] && [[ "$oldest" > "$since" ]] && TRUNCATED=1

# Narrow to the window once; every count below derives from this set.
scope=$(jq --arg since "$since" '[ .[] | select(.updated_at >= $since) ]' <<<"$prs")

opened=$(jq --arg d "$yday" '[.[]|select(.created_at >= $d)]|length' <<<"$scope")
merged_ids=$(jq -r --arg d "$yday" '.[]|select(.merged_at != null and .merged_at >= $d)|.number' <<<"$scope")
merged_total=$(jq --arg d "$yday" '[.[]|select(.merged_at != null and .merged_at >= $d)]|length' <<<"$scope")

# --- classify each merge by the evidence that let it through ---------------
#
# `direct` vs `exemption` is the coverage claim: exemption-path merges (bot,
# release) were never reviewed by anything, by design. If most merges arrive that
# way, the lane is not actually reviewing much and the headline benefit is not
# being delivered — which volume counts alone would never show.
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
direct=$(( by_cli + by_review ))
if [ "$merged_total" -gt 0 ]; then
  coverage=$(( direct * 100 / merged_total ))
else
  coverage="n/a"
fi

# --- ROUNDS PER MERGED PR — the unit of spend -------------------------------
#
# The core unknown. A review vouches for one SHA, so fixing what a review found
# invalidates it and costs another. That multiplier is imposed by the GATE and
# applies in every lane, which is why it must be measured as a distribution
# rather than assumed to be 2.
#
# Proxy: count of evidence markers posted on the PR. cr-evidence.sh posts one per
# reviewed SHA, so the marker count is the number of CLI rounds that PR consumed.
# Online rounds are counted separately as formal reviews.
rounds_detail=""; rounds_total=0; rounds_prs=0; rounds_max=0
for n in $merged_ids; do
  cm=$(api_array "repos/$REPO/issues/$n/comments?per_page=100") || continue
  cli_rounds=$(jq '[.[]|select(.body|test("<!-- cr-cli-review: "))]|length' <<<"$cm")
  rv=$(api_array "repos/$REPO/pulls/$n/reviews?per_page=100") || rv='[]'
  on_rounds=$(jq '[.[]|select(.user.login=="coderabbitai[bot]")]|length' <<<"$rv")
  r=$(( ${cli_rounds:-0} + ${on_rounds:-0} ))
  [ "$r" -eq 0 ] && continue
  rounds_total=$(( rounds_total + r )); rounds_prs=$(( rounds_prs + 1 ))
  [ "$r" -gt "$rounds_max" ] && rounds_max=$r
  rounds_detail="$rounds_detail #$n:$r"
done
if [ "$rounds_prs" -gt 0 ]; then
  rounds_avg=$(awk -v t="$rounds_total" -v p="$rounds_prs" 'BEGIN{printf "%.1f", t/p}')
else
  rounds_avg="n/a"
fi

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
  # `gh api --jq` takes exactly one filter and does NOT accept jq's --arg, so the
  # interpolation has to happen in a separate jq. The previous form was silently
  # invalid and reported 0 for every PR.
  revs=$(api_array "repos/$REPO/pulls/$n/reviews?per_page=100") || continue
  c=$(jq --arg d "$yday" '[.[]|select(.user.login=="coderabbitai[bot]" and .submitted_at >= $d)]|length' <<<"$revs")
  online=$(( online + ${c:-0} ))
  sha=$(jq -r --argjson n "$n" '.[]|select(.number==$n)|.head.sha' <<<"$scope")
  e=$(gh api "repos/$REPO/commits/$sha/status" \
      --jq '[.statuses[]?|select(.context=="review-evidence" and .state=="error")]|length' 2>/dev/null)
  errors=$(( errors + ${e:-0} ))
done

# --- STALL MINUTES — the felt cost --------------------------------------
# Not PRs/hour. What actually hurts is waiting for counter capacity while a PR
# sits un-mergeable. Proxy: for each merged PR, minutes between the first
# review-evidence failure and the evidence marker that cleared it.
stall_total=0; stall_n=0; stall_max=0
for n in $merged_ids; do
  sha=$(jq -r --argjson n "$n" '.[]|select(.number==$n)|.head.sha' <<<"$scope")
  first_fail=$(gh api "repos/$REPO/commits/$sha/statuses?per_page=100" \
    --jq '[.[]|select(.context=="review-evidence" and .state=="failure")]|if length>0 then (.[-1].created_at) else empty end' 2>/dev/null)
  cleared=$(gh api "repos/$REPO/commits/$sha/statuses?per_page=100" \
    --jq '[.[]|select(.context=="review-evidence" and .state=="success")]|if length>0 then (.[0].created_at) else empty end' 2>/dev/null)
  [ -n "$first_fail" ] && [ -n "$cleared" ] || continue
  m=$(( ( $(date -u -d "$cleared" +%s) - $(date -u -d "$first_fail" +%s) ) / 60 ))
  [ "$m" -lt 0 ] && continue
  stall_total=$(( stall_total + m )); stall_n=$(( stall_n + 1 ))
  [ "$m" -gt "$stall_max" ] && stall_max=$m
done
if [ "$stall_n" -gt 0 ]; then stall_avg=$(( stall_total / stall_n )); else stall_avg="n/a"; fi

rl_json=$(api_array "repos/$REPO/issues/comments?per_page=100&since=$yday") || rl_json='[]'
ratelimited=$(jq '[.[]|select(.user.login=="coderabbitai[bot]" and (.body|test("rate limited by coderabbit")))]|length' <<<"$rl_json")

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
[ "$TRUNCATED" = "1" ] && clip_note="
> ⚠️ The PR listing did not reach back past the ${WINDOW_DAYS}-day window, so counts
> may be incomplete. Raise \`per_page\` or narrow \`WINDOW_DAYS\` in the script.
"
[ "$CLIPPED" = "1" ] && clip_note="$clip_note
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
| **Rounds per merged PR** | **$rounds_avg** (max $rounds_max) | **the unit of spend — is the multiplier 2, or worse?** |
| Merged-head coverage | ${coverage}% | share reviewed directly vs waved through by exemption |
| Stall minutes (avg / max) | $stall_avg / $stall_max | the felt cost — waiting on capacity, not PRs/hour |
| Gate \`error\` states | $errors | false reds blocking legitimate work |
| Rate-limit events | ${ratelimited:-0} | did starvation just move rather than resolve? |

$verdict

<details><summary>Rounds per PR — raw</summary>

\`\`\`
${rounds_detail:- (none)}
\`\`\`
A round is one review that vouched for one SHA. Fixing what a review finds
invalidates it, so a PR with findings costs at least two. That multiplier is
imposed by the gate and applies in every lane — measured here rather than assumed.
</details>
$clip_note
<sub>Window: $yday → now. Auto-generated. Decision this serves: promote the CLI-first lane to \`prismalens\` and \`sreforge\`, or land \`ci/cli-first-valve-REVERT\`. Context: prismalens/prismalens#301</sub>
EOF
)

if [ "$DRY" = "--dry-run" ]; then printf '%s\n' "$body"; exit 0; fi
gh api -X POST "repos/$REPO/issues/$ISSUE/comments" -f body="$body" --silent \
  && say "posted day $DAY digest to $REPO#$ISSUE" \
  || { say "ERROR: failed to post digest"; exit 1; }
