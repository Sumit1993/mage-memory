# End to end: the three repos as one product

Written 2026-09-03 after the redirection was agreed. What remains, what gets built, what gets
decommissioned, across mage, claude-kit and gh-workflows.

## The three repos are the three scopes

| scope | repo | holds | lands there |
| --- | --- | --- | --- |
| project | each code repo and its KB (in-repo or hub) | notes, decisions, ledger, observe log, CI, lint, pre-commit, AGENTS.md | checks, repo hooks, rule lines, notes |
| user | claude-kit | AGENTS.md doctrine, process skills, plugin hooks with tests, settings fragment, installer | deny rules, harness hooks, skills, doctrine lines |
| org | gh-workflows | canonical workflows, review lanes, rulesets, review telemetry worker and dashboard | org-wide checks (reusable workflows), the review-findings stream, later the ledger view |

mage is the loop that moves a failure from where it was observed to the scope where the fix
belongs. It owns no scope itself. That is the product boundary, and it is why mage never has to
carry opinions: the opinions live in the kit, the checks live in the repos and the workflows.

## One failure, end to end

1. An agent in prismalens ships a changeset naming four packages the config ignores.
2. The review lane (gh-workflows, claude[bot]) leaves a finding. A puller turns it into an
   observe event in prismalens-kb. If a kit hook had blocked it instead, the hook would have
   emitted the event itself. If a tool had crashed, observe already has it.
3. Next session start, the digest lists it. The agent (mage:groom) judges the rung: a check,
   in the repo, "changeset packages must exist in config", as a test. It proposes it.
4. `mage groom --propose` opens the PR in prismalens (ADR-0046). The human merges.
5. The test fails on the next bad changeset. That failure is a "prevented" row in
   prismalens-kb's ledger, read from CI status.
6. Ninety days later, if the test never failed again, dream lists it as never-fired. It
   stays, because a check that never fires costs nothing. A rule line or a note in the same
   state gets a delete proposal.

The same story with a WebFetch redirect lands in the kit as a deny rule, and with a review
convention lands in gh-workflows as a reusable workflow. Same loop, different landing zone.

## mage: CLI

Keep as is: init, index, link, unlink, verify, list, status, autonomy, redact, footprint.
Keep, amended: connect (asks for the kit, installs the PreToolUse observe arm, never
commandeers), doctor (kit reachable, streams configured, ledger present, ladder hook installed),
migrate (the 0.0.x clearing), observe (gains tool_attempt), nudge (digest repointed to
repeats, proposals and stale), dream (health report gains never-fired fixes and silent
triggers), skills (generator plus the fire metrics; no graduation), groom --propose (gains
output types and landing scope; the PR path for every rung).
Decommission: distill, promote, flatten, stage, the dashboard HTML cockpit (Dashboard.md may
stay as a generated summary), adopt (fold its "import existing notes" half into migrate;
its "harvest native memory" half is replaced by the ladder hook at write time).
No new verbs. The ledger is a file that dream and doctor read. A stream is a file that observe
reads. The review puller is a script, not a verb, and lives in mage only as the OSS default;
a gh-workflows consumer gets the same events from the telemetry record instead.

## mage: skills

Three remain: guide (the ladder replaces "read INDEX, capture after"), learn (the admission
rule: trigger, pointer, expected exit; otherwise it proposes a rung instead of a note), groom
(judge the rung, propose under a budget, surface stale). graduate and optimize go; optimize's
reword-or-demote pass folds into groom's stale pass, driven by the same fire metrics.

## claude-kit

The kit already is the proof that enforcement works: delegate-check, organizer-seat, no-haiku,
no-broad-agy-kill, pr-created, release-docs-gate are rung-3 fixes written by hand for repeated
failures. What is missing is the count. Build first, before any mage code: a tiny shared
`hooks/lib/report.sh` that appends one observe event to the current repo's `.mage/learnings/`
when a kit hook blocks or rewrites. Every existing hook becomes measurable in one afternoon,
and "prevented" gets its first real rows without waiting for mage's loop.
Also in the kit: the deny list in the settings fragment grows as rung-1 fixes land (WebFetch
is the first); agy-delegate gains the diff-stat check (case 2); a commit-msg hook verifies
trailers (case 3, if it lands user-scope). Nothing in the kit is decommissioned by this plan.

## gh-workflows

Org scope. Build: the review telemetry record emits one event per review finding in the
observe schema, so a repo using the canonical workflows gets the review stream for free; the
canonical commit-lint gains "no breaking markers on a deprecation" if that proves worth
enforcing across repos. Later, after the telemetry ADR: a ledger panel in the dashboard and a
self-hostable telemetry worker for OSS users. Decommission: nothing. One rule for mage as a
consumer: use the canonical workflows unmodified; three quarters of mage's recent ci commits
were lane upkeep that should have been zero.

## Other aspects

- Hubs: prismalens-kb and sreforge-kb migrate first (ladder hook installed, state cleared), then their
  routing tables become issues in the code repos, then each hub gets a ledger.
- Docs site: rewrite around the loop; retired pages become stubs; the drift test is
  regenerated with every CLI change.
- npm and the marketplace: one deprecation release (0.0.19) where retired verbs print their
  replacement; description sentences updated; the marketplace reinstalled locally because a
  directory-source plugin serves a stale snapshot.
- Telemetry: local ledger in git until 0.1.0; ADR-0049 afterwards for opt-in export to a
  self-hosted worker, gh-workflows as the reference.
- The operator's own habit: when something is learned, the first question is "which rung",
  not "which note". The guide skill asks it; the learn skill enforces it.
- Measurement: two numbers, read by hand monthly until the nudge shows them. No other KPI.

## Order

1. Kit hooks report blocks (claude-kit, one afternoon). First real "prevented" rows.
2. P1 clearing in mage (migrate, deprecations, tool_attempt, nudge trim, drift regen).
3. P0 by hand (route to issues, three fixes with counts, kit contract).
4. P2 loop only if the counts moved.
5. P3 release, docs, 0.1.0 named. Telemetry ADR after.
