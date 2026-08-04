#!/usr/bin/env bash
# Promote ONE queued pull request into CodeRabbit's online review lane, then
# confirm what actually happened.
#
# WHY THIS EXISTS
# ---------------
# The valve (`.coderabbit.yaml`: auto_review.enabled=false + labels:[review-ready])
# means online review is opt-in. Something has to do the opting-in, and it cannot
# be the authoring agent: with parallel agents every agent believes its own PR
# deserves review, so author judgement degenerates to "review everything" — the
# problem the valve was closed to solve (#301).
#
# So admission is mechanical. Some other producer applies `cr:queue` on an
# independent signal (risk paths, unresolved CLI findings); this script is only
# the *drip* — it decides WHEN, never WHETHER.
#
# ONE PROMOTION PER TICK, CONFIRMED. NEVER BATCHED.
# The CodeRabbit OSS limit is per DEVELOPER, undocumented, and variable, so a
# ledger would measure against an unknown denominator and produce confident
# numbers that drift into lies. Backpressure instead: promote one, watch what
# happens, let the next tick discover whether there is more capacity. A failed
# attempt costs a label edit, and a label edit is free.
#
# WHAT IT WILL NOT DO
# -------------------
# It will not send `@coderabbitai review`. That verb runs regardless of labels
# and therefore spends an online review directly, and it is still UNVERIFIED
# (#301, step-5 test: deliberately not exercised on the probe). An unattended
# script must not be the thing that discovers what it costs. A `paused` outcome
# is recorded for an attended human instead.
#
# OUTCOME → ACTION. The whole state machine, in one place.
#
#   outcome       what it means                     labels after      requeued?
#   ------------  -------------------------------   ---------------   ---------
#   started       CodeRabbit engaged or delivered    review-ready      no
#   paused        engaged, then stopped short        review-ready      no  (1)
#   skipped       refused the PR after admission     review-ready      no  (2)
#   rate_limited  admission blocked by the counter   cr:queue          YES (3)
#   none          no reaction inside the window      review-ready      no  (4)
#   unknown       the API would not answer us        review-ready      no  (5)
#
#   (1) Retrying would re-spend engagement that already happened, and the only
#       documented recovery is `@coderabbitai review` — see below. A human calls it.
#   (2) A refusal is deterministic. Requeueing would promote, be refused, and
#       requeue again, forever.
#   (3) THIS is the backpressure. A blocked attempt costs a label edit, so the
#       next tick simply tries again, and capacity is discovered by attempting.
#   (4) Silence is ambiguous — a review may still land. Requeueing risks paying
#       for the same PR twice, so it stays admitted and the `review-evidence`
#       gate keeps the PR red until something actually reviews it.
#   (5) "We could not ask" is not "CodeRabbit ignored us". Nothing is inferred
#       from a failed lookup, and nothing is undone on the strength of one.
#
# Tracked in prismalens/prismalens#301.
#
# Usage:
#   REPO=owner/name ./review-drip.sh            # promote one, confirm outcome
#   REPO=owner/name DRY_RUN=1 ./review-drip.sh  # select and report, label nothing
set -uo pipefail

REPO="${REPO:?REPO must be set (owner/name)}"

# DRY_RUN is normalised rather than compared against "1", and the asymmetry is
# deliberate: the two mistakes are not equally expensive. Reading a truthy value
# as false promotes a PR for real and may spend a review from a scarce counter;
# reading it as true costs a wasted run. So anything that plausibly means yes
# means yes. The workflow passes a literal 1/0 and never relies on this — it is
# here for the human running it by hand, who is the one who will type `true`.
case "$(printf '%s' "${DRY_RUN:-0}" | tr '[:upper:]' '[:lower:]')" in
  1|true|yes|on) DRY_RUN=1 ;;
  *)             DRY_RUN=0 ;;
esac

# ---------------------------------------------------------------------------
# Policy constants.
#
# These live here, not read out of `.coderabbit.yaml`: the drip must not have to
# parse another tool's config format to learn its own policy — the same rule
# `review-evidence.sh` follows, for the same reason (#301). Where a constant
# below deliberately MIRRORS a CodeRabbit setting, it says so, because a mirror
# that drifts is the failure mode.
# ---------------------------------------------------------------------------

# The queue. `cr:queue` marks "an online review is wanted here"; `review-ready`
# is what CodeRabbit's `auto_review.labels` actually admits on. Promotion is the
# swap between them, so a PR is in exactly one of the two states and the queue
# cannot double-count a PR already admitted.
QUEUE_LABEL="${QUEUE_LABEL:-cr:queue}"
ADMIT_LABEL="${ADMIT_LABEL:-review-ready}"

# Reservation recovery: a priority label sorts ahead of age. Optional — if the
# label does not exist in the repo, every PR simply falls through to age order.
PRIORITY_LABEL="${PRIORITY_LABEL:-cr:priority}"

# Whose comments and reviews are read as CodeRabbit's answer. EXACT logins,
# never a substring match: on a public repo anyone can register `coderabbit-fan`,
# and a comment from it must not be able to tell this script that a review
# started (or that it was rate limited). Same allowlist discipline as the gate.
REVIEWER_LOGINS="${REVIEWER_LOGINS:-coderabbitai[bot]}"

# MIRRORS `.coderabbit.yaml` reviews.auto_review.ignore_title_keywords.
# A WIP-titled PR is not auto-reviewed even when labelled, so promoting one
# spends a tick and admits nothing. Excluded here rather than discovered as a
# `none` outcome — but excluded LOUDLY: every queued-and-excluded PR is named in
# the run summary, because a silent permanent exclusion is how a PR sits in the
# queue forever with nobody able to say why.
IGNORE_TITLE_RE="${IGNORE_TITLE_RE:-(^|[^a-z])wip([^a-z]|$)}"

# ---------------------------------------------------------------------------
# Outcome detection.
#
# CodeRabbit's comment strings are undocumented and can change, which makes
# these patterns the softest part of this script. That is survivable because of
# how the unmatched case is handled: no match means `none`, and `none` never
# requeues and never spends anything. A pattern going stale degrades the record,
# not the behaviour.
#
# The precedence below is deliberate: rate_limited and paused are terminal facts
# about this attempt, and both can arrive AFTER a "processing" notice (measured:
# #139 started at 08:51:30Z and paused 32s later). So a later terminal signal
# must beat an earlier optimistic one, not the other way round.
#
# `started` deliberately sits ABOVE `skipped`, and a CLI review argued for the
# reverse. Rejected, because of how the skip comment actually behaves here: on a
# valve-gated repo every PR opens with "Review skipped — required labels:
# review-ready", and on admission CodeRabbit EDITS THAT SAME COMMENT into the
# processing notice (measured, #139). A body carrying both strings is therefore
# a comment caught mid-transition into a review that IS starting. Ranking
# skipped higher would report the single most common healthy promotion on this
# repo as a refusal.
# ---------------------------------------------------------------------------

# "Review rate limit exceeded" / "Please wait N minutes ... before requesting
# another review". NOT the benign tip that merely mentions rate limits and then
# says reviews are available now — matching that would report every healthy
# promotion as blocked.
PAT_RATE_LIMITED="${PAT_RATE_LIMITED:-rate limit exceeded|before requesting another review}"

# Auto-pause: CodeRabbit engaged and then stopped without submitting.
PAT_PAUSED="${PAT_PAUSED:-reviews? paused|paused the review|resume the review}"

# Engagement: the walkthrough/summary comment, an in-flight notice, or a posted
# verdict. Any of these means the label was accepted and the counter was touched.
PAT_STARTED="${PAT_STARTED:-currently processing|walkthrough|actionable comments posted|review in progress}"

# Refusal: the label did not admit this PR (config, draft, title, path filters).
PAT_SKIPPED="${PAT_SKIPPED:-review skipped}"

# Bounded in-run wait. Measured timings on this repo: skip-comment edit to
# "Currently processing" 40s after the label; auto-pause 32s after that;
# a delivered review 10 min after admission. Confirming DELIVERY would mean
# holding a runner for ten minutes to learn something the `review-evidence`
# gate already reports for free — so this waits only long enough to classify
# ADMISSION, and exits early the moment the answer is terminal.
CONFIRM_TIMEOUT_S="${CONFIRM_TIMEOUT_S:-300}"
CONFIRM_INTERVAL_S="${CONFIRM_INTERVAL_S:-20}"
# Once `started` is seen, keep watching this much longer before calling it:
# the pause arrived 32s after the start on the one case ever observed.
PAUSE_SETTLE_S="${PAUSE_SETTLE_S:-120}"

# Every constant above is overridable, which means every one of them is a way to
# break this script from the environment — and the two failure modes are silent.
# A CONFIRM_INTERVAL_S of 0 never advances `waited`, so the confirm loop spins
# until the job timeout kills it mid-flight, which is the one state this design
# most wants to avoid. An empty PAT_* makes `grep -qEi ""` match every body, so
# the first empty pattern in precedence order swallows every promotion — an
# blank PAT_RATE_LIMITED would requeue healthy PRs forever. Refuse both at the
# door, where the message can still say which knob is wrong.
#
# The blank test is for WHITESPACE, not just emptiness: `${VAR:-default}` already
# turns an empty override back into the default, so the reachable mistake is
# `PAT_STARTED=" "` — which is not empty, matches every body containing a space,
# and therefore matches everything.
for _v in CONFIRM_TIMEOUT_S CONFIRM_INTERVAL_S PAUSE_SETTLE_S; do
  case "${!_v}" in
    ''|*[!0-9]*) echo "ERROR: $_v must be a non-negative integer (got '${!_v}')" >&2; exit 2 ;;
  esac
done
[ "$CONFIRM_INTERVAL_S" -gt 0 ] || { echo "ERROR: CONFIRM_INTERVAL_S must be > 0" >&2; exit 2; }
# A timeout shorter than one interval means the confirm loop never runs a single
# check, and every promotion reports `none` having waited zero seconds — a lie
# that looks exactly like CodeRabbit ignoring us, on a PR that was really never
# given a chance to answer.
[ "$CONFIRM_TIMEOUT_S" -ge "$CONFIRM_INTERVAL_S" ] || {
  echo "ERROR: CONFIRM_TIMEOUT_S ($CONFIRM_TIMEOUT_S) must be >= CONFIRM_INTERVAL_S ($CONFIRM_INTERVAL_S)" >&2
  exit 2; }
for _v in PAT_RATE_LIMITED PAT_PAUSED PAT_STARTED PAT_SKIPPED IGNORE_TITLE_RE \
          QUEUE_LABEL ADMIT_LABEL PRIORITY_LABEL REVIEWER_LOGINS; do
  case "${!_v}" in
    ''|*[!$' \t']*) : ;;   # empty is impossible (see above); non-blank is fine
    *) echo "ERROR: $_v must not be blank (got '${!_v}')" >&2; exit 2 ;;
  esac
done

# ---------------------------------------------------------------------------

say () { echo "$@" >&2; }

SUMMARY="${GITHUB_STEP_SUMMARY:-/dev/stdout}"
emit () { printf '%s\n' "$*" >>"$SUMMARY"; }

# PR titles are arbitrary text pasted into a markdown table; an unescaped pipe
# silently shifts every column after it.
md_cell () { printf '%s' "${1//|/\\|}"; }

# Ask the API a question whose answer is a string, distinguishing THREE outcomes:
# a match, no match, and "could not tell". Conflating the last two would let this
# script report `none` — "CodeRabbit ignored us" — when the truth is "we failed
# to ask". Those two demand opposite responses, so they are never merged.
#   rc 0 = answered (value on stdout, may be empty for "no match")
#   rc 2 = could not determine
api_query () { # api_query <path> <jq filter> [jq args...]
  local path="$1" filter="$2"; shift 2
  local body
  body=$(gh api --paginate "$path" 2>/dev/null) || return 2
  # --paginate emits one array per page on older gh and a single merged array on
  # newer; `-s add` normalises both to one array.
  body=$(jq -s 'add // []' <<<"$body" 2>/dev/null) || return 2
  jq -r "$@" "$filter" <<<"$body" 2>/dev/null || return 2
}

# --- selection -------------------------------------------------------------
#
# Emits one record per line: number, reason, priority(0|1), created_at, sha,
# title — separated by US (\x1f), NOT tabs. `reason` is empty for an eligible PR,
# and bash `read` treats tab as IFS *whitespace*, which collapses runs of it and
# silently shifts every field after an empty one. US is not IFS whitespace, so
# an empty field stays an empty field.
#
# PRs not carrying the queue label are dropped entirely; everything else is kept
# WITH its exclusion reason so the summary can account for every queued PR it
# did not promote.
select_candidates () {
  gh api --paginate "repos/$REPO/pulls?state=open&per_page=100" 2>/dev/null \
  | jq -s -r --arg q "$QUEUE_LABEL" --arg a "$ADMIT_LABEL" \
             --arg p "$PRIORITY_LABEL" --arg wip "$IGNORE_TITLE_RE" '
      (add // [])
      | map(select([.labels[].name] | index($q)))
      | map({
          number, created_at,
          # Flatten anything that would break the one-record-per-line contract.
          # The separator is stripped with `split`, which takes a LITERAL string:
          # jq regexes are Oniguruma, which does not understand `\u001f` and
          # silently reads it as the characters u, 0, 1, f — which quietly ate
          # letters and digits out of PR titles until it was caught.
          title: (.title | split("\u001f") | join(" ") | gsub("[\\r\\n]"; " ")),
          sha: .head.sha,
          prio: (if ([.labels[].name] | index($p)) then 0 else 1 end),
          reason:
            (if ([.labels[].name] | index($a)) then "already carries \($a)"
             # Bot-authored PRs are INVISIBLE to label admission — measured on
             # #85: label applied, zero CodeRabbit activity, not even a skip
             # comment. Promoting one burns a tick for a guaranteed silence.
             # Harmless to exclude: bot PRs take the gate exemption anyway.
             elif .user.type == "Bot" then "bot-authored (\(.user.login))"
             # CodeRabbit does not auto-review drafts by default, so a draft
             # promotion is admission into a lane that will not run.
             elif .draft then "draft"
             elif (.title | test($wip; "i")) then "title matches ignore_title_keywords"
             else "" end)
        })
      | sort_by(.prio, .created_at)
      | .[]
      | [ (.number|tostring), .reason, (.prio|tostring), .created_at, .sha, .title ]
      | join("\u001f")'
}

# --- outcome classification ------------------------------------------------
#
# `since` is the instant the label was applied. Comments are matched on
# updated_at, NOT created_at, because CodeRabbit EDITS its existing comment in
# place rather than posting a new one — measured on #139, where the "Review
# skipped — required labels" comment became "Currently processing new changes in
# this PR" without a new comment ever appearing. Keying on created_at would have
# read that promotion as silence.
#
# updated_at also protects the other direction: a stale skip comment from before
# the promotion is excluded, so a promotion is not instantly misread as skipped.
#
# echoes one of: started|paused|skipped|rate_limited|none   rc 2 = cannot determine
classify () { # classify <pr> <sha> <since-iso>
  local n="$1" sha="$2" since="$3" bodies delivered rc

  # A submitted review at this head is the strongest possible `started`: not
  # merely admitted, actually delivered. DISMISSED/PENDING excluded for the same
  # reason the gate excludes them — a withdrawn or unsubmitted review is not a
  # verdict.
  #
  # BOTH conditions, not either. A PR can be reviewed, then requeued at the same
  # head (a reviewer asks for another pass), and an `or` would let that earlier
  # review answer for THIS promotion — reporting `started` without CodeRabbit
  # having done anything, which is exactly the "confident answer nobody computed"
  # failure this lane exists to prevent. A genuinely new review satisfies both.
  delivered=$(api_query "repos/$REPO/pulls/$n/reviews?per_page=100" '
        ($logins | split(" ")) as $allowed
        | [ .[]
            | select(.user.login as $u | $allowed | index($u))
            | select(.state != "DISMISSED" and .state != "PENDING")
            | select(.commit_id == $sha and .submitted_at >= $since)
          ] | if length > 0 then "yes" else empty end' \
      --arg sha "$sha" --arg since "$since" --arg logins "$REVIEWER_LOGINS")
  rc=$?; [ $rc -eq 2 ] && return 2
  [ -n "$delivered" ] && { echo started; return 0; }

  bodies=$(api_query "repos/$REPO/issues/$n/comments?per_page=100" '
        ($logins | split(" ")) as $allowed
        | [ .[]
            | select(.user.login as $u | $allowed | index($u))
            | select(.updated_at >= $since)
            | .body
          ] | join("\n")' \
      --arg since "$since" --arg logins "$REVIEWER_LOGINS")
  rc=$?; [ $rc -eq 2 ] && return 2

  # Precedence, terminal-first. See the note above the patterns.
  if   grep -qEi "$PAT_RATE_LIMITED" <<<"$bodies"; then echo rate_limited
  elif grep -qEi "$PAT_PAUSED"       <<<"$bodies"; then echo paused
  elif grep -qEi "$PAT_STARTED"      <<<"$bodies"; then echo started
  elif grep -qEi "$PAT_SKIPPED"      <<<"$bodies"; then echo skipped
  else echo none
  fi
}

confirm () { # confirm <pr> <sha> <since-iso>  -> final outcome on stdout
  local n="$1" sha="$2" since="$3"
  local waited=0 started_at=-1 outcome=none last=none

  while [ "$waited" -lt "$CONFIRM_TIMEOUT_S" ]; do
    sleep "$CONFIRM_INTERVAL_S"
    waited=$(( waited + CONFIRM_INTERVAL_S ))

    outcome=$(classify "$n" "$sha" "$since")
    if [ $? -eq 2 ]; then
      # Cannot determine is NOT `none`. Say so and stop: guessing here is how a
      # rate-limited attempt gets recorded as "CodeRabbit ignored us".
      echo unknown; return 0
    fi
    [ "$outcome" != "$last" ] && say "    t+${waited}s: $outcome"
    last="$outcome"

    case "$outcome" in
      rate_limited|paused|skipped) echo "$outcome"; return 0 ;;
      started)
        # Do not exit here. A pause lands seconds after the start, and calling it
        # `started` early would record a review that never arrives.
        [ "$started_at" -lt 0 ] && started_at=$waited
        if [ $(( waited - started_at )) -ge "$PAUSE_SETTLE_S" ]; then
          echo started; return 0
        fi
        ;;
    esac
  done

  # Timed out. `started` here means it started and never paused within the
  # window, which is the good case.
  [ "$started_at" -ge 0 ] && { echo started; return 0; }
  echo none
}

# --- label moves -----------------------------------------------------------

promote () { # promote <pr>
  gh pr edit "$1" --repo "$REPO" \
     --add-label "$ADMIT_LABEL" --remove-label "$QUEUE_LABEL" >/dev/null 2>&1
}

# Put a PR back in the queue so the NEXT tick retries it. Used only where a
# retry is the right answer: a blocked admission. Never for `paused` (CodeRabbit
# already engaged — retrying would re-spend), never for `skipped` (a
# deterministic refusal that would loop forever), never for `none` or `unknown`
# (a late-arriving review would then be paid for twice).
requeue () { # requeue <pr>
  gh pr edit "$1" --repo "$REPO" \
     --add-label "$QUEUE_LABEL" --remove-label "$ADMIT_LABEL" >/dev/null 2>&1
}

# --- attended follow-up ----------------------------------------------------
#
# The run summary is the record for EVERY tick (see the workflow header for
# why). A PR comment is written only for the two outcomes that cannot resolve
# themselves — `paused` and `skipped` — because those need a human, and the
# place a human looks is the PR, not a run summary from three days ago.
# Idempotent per head SHA: pushing new commits is a new situation and earns a
# new note; re-running against the same SHA does not.
comment_for_human () { # comment_for_human <pr> <sha> <outcome> <detail>
  local n="$1" sha="$2" outcome="$3" detail="$4"
  local marker="<!-- drip-outcome: $sha -->"
  local existing
  existing=$(api_query "repos/$REPO/issues/$n/comments?per_page=100" '
        [ .[] | select(.body | contains($m)) ] | length' --arg m "$marker")
  [ $? -eq 2 ] && { say "    WARNING: cannot check for an existing note — not commenting"; return 1; }
  [ "${existing:-0}" != "0" ] && { say "    note already present for ${sha:0:8}"; return 0; }

  gh pr comment "$n" --repo "$REPO" --body "$marker
**Online review admission: \`$outcome\`** for \`${sha:0:8}\`.

$detail

This PR was promoted from \`$QUEUE_LABEL\` to \`$ADMIT_LABEL\` by the review drip, and the
promotion did not result in a review. The drip deliberately does **not** send
\`@coderabbitai review\` to recover: that verb runs regardless of labels, spends an
online review from a scarce per-developer counter, and is still unverified
(prismalens/prismalens#301). Recovering this one is an attended decision." >/dev/null 2>&1 \
    || { say "    WARNING: failed to post follow-up note"; return 1; }
  say "    posted follow-up note on #$n"
}

# ---------------------------------------------------------------------------

main () {
  local listing
  listing=$(select_candidates) || {
    say "ERROR: cannot list open PRs — nothing promoted"
    emit "## Review drip — ERROR"; emit "Could not list open pull requests. Nothing was promoted."
    return 1; }

  # US (\x1f) throughout — see select_candidates for why not tab.
  local US=$'\x1f'
  local eligible=() excluded=()
  while IFS="$US" read -r num reason prio created sha title; do
    [ -z "${num:-}" ] && continue
    if [ -z "$reason" ]; then eligible+=("$num$US$prio$US$created$US$sha$US$title")
    else excluded+=("$num$US$reason$US$title"); fi
  done <<<"$listing"

  emit "## Review drip — $(date -u +'%Y-%m-%dT%H:%M:%SZ')"
  emit ""
  emit "Queue \`$QUEUE_LABEL\` → \`$ADMIT_LABEL\`, one promotion per tick."
  emit ""

  if [ ${#excluded[@]} -gt 0 ]; then
    emit "### Queued but not eligible"
    emit ""
    emit "| PR | Reason |"
    emit "|---|---|"
    for row in "${excluded[@]}"; do
      IFS="$US" read -r num reason title <<<"$row"
      emit "| [#$num](https://github.com/$REPO/pull/$num) $(md_cell "$title") | $(md_cell "$reason") |"
    done
    emit ""
  fi

  if [ ${#eligible[@]} -eq 0 ]; then
    say "Queue empty — nothing to promote."
    emit "**Nothing to promote.** ${#excluded[@]} queued PR(s) were not eligible."
    return 0
  fi

  # One per tick. The rest of the queue is reported, not touched.
  local num prio created sha title
  IFS="$US" read -r num prio created sha title <<<"${eligible[0]}"

  emit "### Selected"
  emit ""
  emit "[#$num](https://github.com/$REPO/pull/$num) — $title"
  emit ""
  emit "- head \`${sha:0:8}\`, opened \`$created\`, priority: $([ "$prio" = "0" ] && echo yes || echo no)"
  emit "- waiting in queue behind it: $(( ${#eligible[@]} - 1 ))"
  emit ""

  if [ "$DRY_RUN" = "1" ]; then
    say "DRY RUN: would promote #$num ($QUEUE_LABEL -> $ADMIT_LABEL) at ${sha:0:8}"
    emit "**DRY RUN — no labels were changed.**"
    emit ""
    emit "Would have run: \`gh pr edit $num --add-label $ADMIT_LABEL --remove-label $QUEUE_LABEL\`,"
    emit "then confirmed the outcome for up to ${CONFIRM_TIMEOUT_S}s."
    return 0
  fi

  # Timestamp BEFORE the label edit: anything CodeRabbit does in response is
  # necessarily at or after this instant, and a window that opens late would
  # miss a fast reaction (40s was the measured best case).
  local since
  since=$(date -u +'%Y-%m-%dT%H:%M:%SZ')

  say "Promoting #$num at ${sha:0:8} ..."
  promote "$num" || {
    say "ERROR: failed to promote #$num"
    emit "**Promotion FAILED** — the label edit did not succeed. Queue state unchanged."
    return 1; }

  say "  labelled at $since; confirming outcome (max ${CONFIRM_TIMEOUT_S}s) ..."
  local outcome; outcome=$(confirm "$num" "$sha" "$since")

  # Head moving mid-confirm does not invalidate the outcome — admission is about
  # the PR, and the gate is what keys on SHAs — but it explains a `none`, so it
  # is recorded rather than silently absorbed.
  local head_now
  head_now=$(gh api "repos/$REPO/pulls/$num" --jq '.head.sha' 2>/dev/null)
  local moved=""
  [ -n "${head_now:-}" ] && [ "$head_now" != "$sha" ] && moved=" (head moved to ${head_now:0:8} during the wait)"

  say "  outcome: $outcome$moved"
  emit "### Outcome: \`$outcome\`$moved"
  emit ""

  local rc=0
  case "$outcome" in
    started)
      emit "CodeRabbit accepted the admission. \`$ADMIT_LABEL\` stays; the \`review-evidence\` gate"
      emit "takes it from here."
      ;;
    paused)
      emit "CodeRabbit engaged and then paused without submitting. **Left admitted, not retried** —"
      emit "it already spent engagement, and the documented recovery (\`@coderabbitai review\`) runs"
      emit "regardless of labels and costs a scarce online review, so it is an attended decision."
      comment_for_human "$num" "$sha" paused \
        "CodeRabbit started and then paused — commonly \"branch under active development\"." || rc=1
      ;;
    skipped)
      emit "CodeRabbit refused the PR after admission. That is deterministic and would repeat, so"
      emit "**not requeued** — requeueing would loop forever. Left admitted for an attended look."
      comment_for_human "$num" "$sha" skipped \
        "CodeRabbit posted a skip. The label did not admit this PR — check \`.coderabbit.yaml\` filters against it." || rc=1
      ;;
    rate_limited)
      emit "Admission was blocked by the per-developer rate limit. **Requeued** — this is the"
      emit "backpressure: the next tick retries, and capacity is discovered by attempting."
      requeue "$num" || { say "    WARNING: requeue failed"; emit ""; emit "> ⚠️ Requeue FAILED — this PR needs \`$QUEUE_LABEL\` reapplied by hand."; rc=1; }
      ;;
    none)
      emit "No reaction within ${CONFIRM_TIMEOUT_S}s. **Left admitted, not requeued**: a late review is"
      emit "still possible and requeueing would risk paying for the same PR twice. If it stays silent,"
      emit "the \`review-evidence\` gate keeps this PR red — which is the loud failure, by design."
      ;;
    unknown)
      emit "**Could not determine the outcome** — the GitHub API did not answer. The PR is admitted"
      emit "and was NOT requeued; nothing here is safe to infer from a failed lookup."
      rc=1
      ;;
  esac

  emit ""
  emit "_Rate-limit retryability is still unverified (#301). This tick is one data point._"
  return $rc
}

main "$@"
