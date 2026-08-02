#!/usr/bin/env bash
# Publish a `review-evidence` commit status for one or more pull requests.
#
# WHY THIS EXISTS
# ---------------
# CodeRabbit is not a required check on this repo, and its own rate-limit check
# "passes by design so it never blocks merging on protected branches". So a PR
# that was never reviewed is indistinguishable, at the merge gate, from one that
# was reviewed and found clean. This status makes that distinction, and it is
# keyed to the CURRENT head SHA so a review of an earlier commit does not vouch
# for later pushes.
#
# Tracked in prismalens/prismalens#301.
#
# Usage:
#   REPO=owner/name ./review-evidence.sh 126 127     # specific PRs
#   REPO=owner/name ./review-evidence.sh --all-open  # sweeper
#   DRY_RUN=1 ...                                    # evaluate, publish nothing
set -uo pipefail

REPO="${REPO:?REPO must be set (owner/name)}"
STATUS_CONTEXT="${STATUS_CONTEXT:-review-evidence}"
DRY_RUN="${DRY_RUN:-0}"

# ---------------------------------------------------------------------------
# Policy constants.
#
# These live here, not in a shared config file: the gate must not have to parse
# another tool's config format to learn its own policy, and a schema shared
# across repos is an API commitment that has not been earned yet (#301).
# ---------------------------------------------------------------------------

# Whose formal review counts as evidence. Matched case-insensitively as a substring
# of the reviewer's login.
REVIEWER_PATTERN="${REVIEWER_PATTERN:-coderabbit}"

# PR authors exempt from needing review evidence.
#
# This is not a hole: `CI gate` is separately a required check, so exempting these
# authors does not let unreviewed *code* merge. It lets machine-generated
# dependency bumps merge, which is the intent — nobody reviews them, and without
# this branch the auto-merge workflow would be permanently blocked by a gate that
# can never go green.
BOT_AUTHORS="${BOT_AUTHORS:-dependabot[bot] github-actions[bot]}"

# Machine-generated PRs that are NOT bot-authored.
#
# release-please runs with RELEASE_PLEASE_TOKEN — a PAT — so its PRs are authored
# by the repo owner and are indistinguishable from hand-written ones by author
# alone. Measured, not assumed: #122 is authored by `Sumit1993`.
#
# Two factors are required together, because either alone is weak. The label is
# forgeable by anyone with write access; the branch name is set by the tool and
# would not be produced incidentally. Given merges stay attended, that is enough
# here — but it is the softest branch in this gate, so it is deliberately narrow.
GENERATED_PR_LABELS="${GENERATED_PR_LABELS:-autorelease: pending
autorelease: tagged}"
GENERATED_PR_BRANCH_RE="${GENERATED_PR_BRANCH_RE:-^release-please--}"

# Marker left by a local CodeRabbit CLI review.
#
# STUBBED. Nothing writes this yet — `cr-preview.sh` must be taught to post it
# before the CLI-first valve is flipped, or every CLI-only PR is permanently red.
# That ordering is tracked as a blocking step in #301.
# Format:  <!-- cr-cli-review: <full head sha> -->
CLI_MARKER_PREFIX="${CLI_MARKER_PREFIX:-<!-- cr-cli-review:}"

# Comment authors whose CLI marker is trusted. An unauthenticated "evidence"
# comment from an arbitrary account must not satisfy the gate.
CLI_MARKER_AUTHORS="${CLI_MARKER_AUTHORS:-Sumit1993}"

# ---------------------------------------------------------------------------

in_list () { # in_list <needle> <space-separated haystack>
  local needle="$1" hay="$2" item
  for item in $hay; do [ "$item" = "$needle" ] && return 0; done
  return 1
}

publish () { # publish <sha> <state> <description>
  local sha="$1" state="$2" desc="${3:0:140}"
  if [ "$DRY_RUN" = "1" ]; then
    printf '    would publish: %s — %s\n' "$state" "$desc"
    return 0
  fi
  gh api -X POST "repos/$REPO/statuses/$sha" \
    -f state="$state" \
    -f context="$STATUS_CONTEXT" \
    -f description="$desc" \
    --silent || { echo "    ERROR: failed to publish status" >&2; return 1; }
  printf '    published: %s — %s\n' "$state" "$desc"
}

evaluate_pr () { # evaluate_pr <number>
  local n="$1" pr sha author state draft head_ref labels

  pr=$(gh api "repos/$REPO/pulls/$n" 2>/dev/null) || {
    echo "  PR #$n: cannot fetch, skipping" >&2; return 0; }

  sha=$(jq -r '.head.sha'      <<<"$pr")
  author=$(jq -r '.user.login' <<<"$pr")
  state=$(jq -r '.state'       <<<"$pr")
  draft=$(jq -r '.draft'       <<<"$pr")
  head_ref=$(jq -r '.head.ref' <<<"$pr")
  labels=$(jq -r '.labels[].name' <<<"$pr")

  printf '  PR #%s  head=%s  author=%s  branch=%s  state=%s  draft=%s\n' \
         "$n" "${sha:0:8}" "$author" "$head_ref" "$state" "$draft"

  if [ "$state" != "open" ]; then
    echo "    closed — not evaluated"; return 0
  fi

  # --- branch B1: bot-authored --------------------------------------------
  if in_list "$author" "$BOT_AUTHORS"; then
    publish "$sha" success "Bot-authored ($author); CI gate applies separately"
    return 0
  fi

  # --- branch B2: machine-generated release PR (label AND branch) ----------
  if [[ "$head_ref" =~ $GENERATED_PR_BRANCH_RE ]] \
     && grep -Fxq -f <(printf '%s\n' "$GENERATED_PR_LABELS") <<<"$labels"; then
    publish "$sha" success "Generated release PR ($head_ref); CI gate applies separately"
    return 0
  fi

  # --- branch A: a formal review AT THE CURRENT HEAD -----------------------
  # `commit_id` is the commit the review was actually made against, so this is
  # exact: a review of an earlier commit does not satisfy a later head.
  local reviewer
  reviewer=$(gh api "repos/$REPO/pulls/$n/reviews?per_page=100" 2>/dev/null \
    | jq -r --arg sha "$sha" --arg pat "$REVIEWER_PATTERN" '
        [ .[]
          | select(.user.login | ascii_downcase | contains($pat))
          | select(.commit_id == $sha)
        ] | if length > 0 then .[-1].user.login else empty end')

  if [ -n "$reviewer" ]; then
    publish "$sha" success "Reviewed by $reviewer at ${sha:0:8}"
    return 0
  fi

  # --- branch C: CLI review marker for this head (STUBBED) -----------------
  local marker_author
  marker_author=$(gh api "repos/$REPO/issues/$n/comments?per_page=100" 2>/dev/null \
    | jq -r --arg sha "$sha" --arg pre "$CLI_MARKER_PREFIX" --arg authors "$CLI_MARKER_AUTHORS" '
        ($authors | split(" ")) as $allowed
        | [ .[]
            | select(.user.login as $u | $allowed | index($u))
            | select(.body | contains($pre + " " + $sha))
          ] | if length > 0 then .[-1].user.login else empty end')

  if [ -n "$marker_author" ]; then
    publish "$sha" success "CLI review evidence from $marker_author at ${sha:0:8}"
    return 0
  fi

  # --- no evidence ---------------------------------------------------------
  publish "$sha" failure "No review evidence for ${sha:0:8} — silence is not a review"
}

main () {
  local targets=()
  if [ "${1:-}" = "--all-open" ]; then
    echo "Sweeper: evaluating all open PRs in $REPO"
    mapfile -t targets < <(gh api "repos/$REPO/pulls?state=open&per_page=100" --jq '.[].number')
  else
    targets=("$@")
  fi

  if [ ${#targets[@]} -eq 0 ]; then echo "No PRs to evaluate."; return 0; fi

  local rc=0
  for n in "${targets[@]}"; do evaluate_pr "$n" || rc=1; done
  return $rc
}

main "$@"
