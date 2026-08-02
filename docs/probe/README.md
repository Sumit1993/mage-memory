# CodeRabbit valve probe

Throwaway artifact for measuring three CodeRabbit behaviours that the review-lane
design depends on and that are not documented:

1. **Suppression** — with `auto_review.enabled: false` and a positive `labels` match,
   does opening a PR start no review at all?
2. **Bot-applied admission** — does a `review-ready` label applied by a workflow using
   `GITHUB_TOKEN` start a review? GitHub's anti-recursion rule means token-created
   events do not trigger *workflows*; CodeRabbit is an external app on its own webhooks,
   so it should be unaffected — but that is an assumption, not a fact.
3. **Re-review cost** — after admission, does a second push spend another review, or
   does `auto_pause_after_reviewed_commits: 1` hold?

Delete this branch once the three observations are recorded.

<!-- probe: second push, testing incremental re-review cost -->
