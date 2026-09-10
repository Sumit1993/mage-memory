# What enforces the ten decisions, clause by clause

Method: one Sonnet worker per decision split `Decision` and `Forbids` into testable clauses and answered, per clause, what would enforce it, whether that exists (file:line, verified with `sed`), and what happens today on a violation: `blocked`, `fails-test`, `warns` or `silent`. I read every table against the attach-point inventory and the code where a claim looked wrong; corrections are marked `[seat]`. Rows already covered by `OUT-contradictions.md` cite the row id.

Per-ADR tables first, then the totals and what they mean.

## 0050 mage turns a repeated failure into enforcement

| id | clause | enforcer | exists? | outcome | row |
|---|---|---|---|---|---|
| D1 | mage is the loop that turns a repeated failure into a guard | definition | n/a | silent | |
| D2 | streams feed observe events | the hook table | `settings.ts:80-101` | silent: hooks fail open, nothing checks a stream kept flowing | B5 |
| D3 | code narrows on first sight | deterministic distill, no model | `src/distill/reader.ts`, no LLM import | silent | |
| D4 | counts rank the digest | sort then slice | `src/grooming/promote.ts:117-120` | silent | |
| D5 | counts never gate it | same path must not filter | violated: `promote.ts:99-102` drops a note below `graduateSessions` before ranking; tests assert the gate as correct | silent, green CI on the forbidden pattern | B4 |
| D6 | at most three proposals per pass | a cap of 3 | mismatched: `thresholds.ts:65 promotionBudget: 5`; `stagingBudget: 3` caps drafts, not proposals | silent | |
| D7 | the agent judges the highest rung | hook output offering a rung | nothing; `rung` in code is the old scratch/notes/skills ladder (name collision) | silent | |
| D8 | the fix lands by pull request | push and PR code | nothing in `src/` | silent | B11 |
| D9 | a ledger counts how often it fires | a ledger module | nothing | silent | B12 |
| D10 | what never fires is proposed for deletion | a stale-guard scan | nothing | silent | |
| D11 | mage has no model | dependency allowlist | none; `package.json` has no LLM SDK today, nothing stops adding one | silent | |
| D12 | mage never judges | same | nothing | silent | |
| D13 | a hook makes the agent judge | hook contract: data, not verdict | consistent in `nudge.ts`, unasserted | silent | |
| D14 | five words and no others | vocabulary lint over decisions | nothing | silent | |
| D15-D19 | definitions of guard, rung, fire, proposal, unit | n/a | n/a | silent | A16 |
| D20 | plans and evidence live in the issue tracker | AGENTS.md line plus a path check | weaker: `AGENTS.md:28-30`; violated live: `git ls-files mage/work` lists 15 tracked plan files | silent | A2, B1 |
| D21 | decisions and notes live in the knowledge base | doctor KB structure | `kb-checks.ts:233` | warns | |
| D22 | a decision fits on one screen | line count over `decisions/*.md` | nothing | silent | A5 |
| F1 | a threshold or recurrence count that gates | same as D5 | violated, `promote.ts:99-102` | silent | B4 |
| F2 | a reasoner in the CLI | dependency allowlist | nothing | silent | |
| F3 | a hook that reasons | same | nothing | silent | |
| F4 | coordination primitives between agents | import check | nothing | silent | |
| F5 | depending on another memory product's engine | dependency allowlist | nothing | silent | |
| F6 | spec-driven-development skills | skill inventory check | nothing; `skills/` has five, none SDD | silent | |
| F7 | a plan or task list committed as a repo file | pre-commit path check on `mage/work/**` | nothing; violated live, 15 files | silent | A2, B1 |
| F8 | the banned words outside the observe schema | grep in doctor or CI | nothing; violated live in `src/agents-md.ts:85,87,124,126` ("Capture lessons", "stage", "wing/room") and identifiers across `kb-checks.ts` | silent | A17 |

Decision 22, Forbids 8. blocked 0, fails-test 0, warns 1, silent 29. `[seat]` D20 and F7: `mage/work` contains 15 tracked files in this worktree at `a945759`; the AGENTS.md sentence says the directory is retired. The charter's own repo violates its Forbids twice, live, and the worker found it by running `git ls-files`, which the brief did not ask for.

## 0059 versions are mechanical; the release is named by two counts

| id | clause | enforcer | exists? | outcome | row |
|---|---|---|---|---|---|
| D1 | release-please mints versions from conventional commits | the action plus the required title check | `release-please.yml:26`; `governance.json:107-110` requires "Validate PR title" | blocked | |
| D2 | a breaking marker mints 0.1.0 | config field | `release-please-config.json:3 bump-minor-pre-major: true` | silent on a hand-edited version | |
| D3, D4 | no version is reserved; none is a milestone | nothing can | nothing | silent | C1 |
| D5 | the announcement quotes two counts from the ledger | a notes template step | nothing; release-please fills notes from commits | silent | |
| D6 | `prevented` is a guard firing | a counter over guard events | nothing here; stopgap is the kit's transcript miner | silent | B5, C6 |
| D7 | prevented above zero, three guards, rungs 1-3 | a release gate reading the ledger | nothing | silent | C8 |
| D8 | one guard on another unit | same gate, needs `unit` | nothing | silent | A16 |
| D9, D10 | `left the queue` counted, above zero | a ledger writer | weaker: `reconcile.ts:99-245` tracks keep/edit/discard, not "climbed" | silent | |
| D11, D12 | ledger derived from observe events per unit | aggregation | nothing; `observe/types.ts:10-17` has no guard event | silent | B5 |
| D13 | nothing new is committed | gitignore | `.gitignore:18 mage/.mage/`; `git add -f` bypasses | blocked | A4 |
| D14 | docs generated from code with a drift test | vitest drift test in required CI | `generated-data.test.ts:15-19`, `ci.yml:56` | fails-test | |
| D15 | no page states a number it did not derive | same test | covers three generated tables only; prose pages unchecked | fails-test for the tables, silent elsewhere | |
| D16 | dogfood on a real KB before a release | nothing | weaker: the note `dogfood-before-release` | silent | |
| F1 | a breaking marker on a deprecation | semantic review | `pr-title.yml` checks syntax only | silent | |
| F2 | an evidence ADR per release | nothing can | nothing | silent | |
| F3 | a version reserved for a milestone | nothing | nothing | silent | C1 |
| F4 | a hand-typed load-bearing number in the docs | drift test | three tables only | silent for prose | |
| F5 | a committed ledger | gitignore | `.gitignore:18` | blocked | A4 |
| F6 | emojis in release notes | a lint on notes or CHANGELOG | weaker: the note `no-emojis-in-releases` | silent | |

Decision 16, Forbids 6. blocked 3, fails-test 2, warns 0, silent 17.

## 0052 streams and the observe schema

| id | clause | enforcer | exists? | outcome | row |
|---|---|---|---|---|---|
| D1 | a stream is anything that emits observe events | definition; the type union | `src/observe/types.ts:9-16` | silent | |
| D2-D4 | envelope is v1, additive; types appended; never reopened | a reader-tolerance test | weaker: comment only, `types.ts:2-4` | silent | A14 |
| D5 | there is no `seq` | type shape | `store.ts:88` comment; no field | silent | |
| D6 | built-in streams: the eight Claude Code hooks | the hook table | `settings.ts:80` wires 7 of 8; PreToolUse goes to `mage memory-hook`, not `observe` | silent | B5 |
| D7 | operator corrections as a stream | derived adjacency | weaker: `src/distill/reader.ts:111`, no event type, no rule id | warns | |
| D8 | kit hooks reporting `guard_fired` | union entry plus wiring | nothing; `guard_fired` absent | silent | C12 |
| D9 | one review-findings puller | a puller | nothing | silent | C10 |
| D10 | `tool_attempt` and `tool_use` carry the invocation id | event field | nothing; no `tool_attempt` | silent | B5 |
| D11 | an attempt with no use is a prevented call | counting | nothing | silent | C6 |
| D12 | every stream writes through `mage observe` so Gate-1 scrubs it | wiring plus `scrubField` | `observe.ts:22,211,232,309,316,328`; `observe.test.ts:396` | fails-test for wired paths; silent for a new stream that bypasses | |
| D13 | nothing appends to `.mage/learnings/` directly | import boundary | weaker: `observe.ts` is the sole importer of `store.ts`; no lint | silent | |
| D14 | streams carry no weights | absence of a field | nothing asserts it | silent | |
| D15 | narrowing is deterministic | a test | weaker: `digest.test.ts` covers dedup and order, not determinism | warns | |
| D16 | the digest is chronological | sort plus test | `digest.ts:339`; `digest.test.ts:72` | fails-test | |
| F1 | an event written by anything but `mage observe` | same as D13 | sole-importer convention | silent | |
| F2 | a schema change a v1 reader cannot skip | same as D2 | comment | silent | A14 |
| F3 | a producer-specific weight | same as D14 | nothing | silent | |
| F4 | a digest sorted by count | same as D16 | `digest.ts:339`, test | fails-test | |
| F5 | storing a copy of tool output beyond the scrubbed detail | type shape plus scrub path | `types.ts:109-110`, `observe.ts:309`, `observe.test.ts:396` | fails-test | |

Decision 16, Forbids 5. blocked 0, fails-test 4, warns 2, silent 15.

## 0053 redaction: two gates, one engine

| id | clause | enforcer | exists? | outcome | row |
|---|---|---|---|---|---|
| D1 | one engine at two boundaries | architecture | weaker: both sites import one module, `scrub.ts:7`, `staged-scan.ts:30` | silent | |
| D2, D3 | Gate-1 scrubs every event and never blocks | test | `observe.ts:73-76`; `observe.test.ts:348` | fails-test | |
| D4 | Gate-2 runs `mage redact --check --staged` over KB paths | pre-commit body plus scope test | `git-hooks.ts:46`; `staged-scan.test.ts:94` | fails-test | |
| D5 | Gate-2 blocks the commit on a likely live secret | exit code plus hook | `cli-program.ts:365 exit(2)`; `git-hooks.ts:46-48` | blocked | |
| D6 | Gate-2 scoped to the knowledge base | scope filter plus test | `staged-scan.test.ts:94` | fails-test | |
| D7 | `connect` installs the hook | code | `connect.ts:447`; no test found for the install path | silent `[seat]` (worker said blocked; installing is not a violation outcome) | |
| D8 | `connect` gitignores the sinks | `ensureGitignored`, fail-open | `connect.ts:434` | warns | |
| D9 | `doctor` reports both | doctor checks | `kb-checks.ts:719` (skipped when `kb.kind !== "repo"` at `:712`); `:382` | warns in repo mode, silent for hub and external | B8 |
| D10 | the allowlist lives in `metadata.json` | reader scoped to `metadata.redact` | `migrate.ts:240,253` | silent | |
| F1 | bypassing Gate-2 with git's verify-skip flag | nothing can | `git-hooks.ts:6,48` documents `--no-verify` as the intended escape hatch, against the Forbids | silent | |
| F2 | bypassing Gate-2 by disabling the hook | doctor absence check | `kb-checks.ts:719-745` | warns | |
| F3 | a Gate-2 scan outside the knowledge base | scope filter plus test | `staged-scan.test.ts:94` | fails-test | |
| F4 | an allowlist file outside `metadata.json` | reader | `staged-scan.ts readRedactConfig` | silent | |
| F5 | a detector without a fixture test | a DETECTORS-to-POSITIVES completeness test | none; `POSITIVES` is hand-maintained; `gitlab-token` and `openai-key` have no per-kind assertion, only `redact.test.ts:177` | silent | |

Decision 10, Forbids 5. blocked 1, fails-test 5, warns 3, silent 6 (after the D7 correction).

## 0054 files in the repo, no runtime, no server, nothing leaves the machine

| id | clause | enforcer | exists? | outcome | row |
|---|---|---|---|---|---|
| D1 | a visible `mage/` with `notes/`, `decisions/`, later `guards/` | doctor KB-structure | weaker: `kb-checks.ts:233` always pushes `ok:true`, validates nothing | silent | |
| D2 | Obsidian opens it | link integrity | `link-checks.ts:24` | warns | |
| D3 | the graph is not a goal | intent | n/a | silent | |
| D4, D5 | transient state under one gitignored `.mage/`; no new top-level entry | `STATE_DIR` plus the state-layout check | `paths.ts:39`; `kb-checks.ts:841` (`optional:true`) | warns; `.gitignore` still carries four legacy top-level state dirs | |
| D6-D8 | no server, no daemon, no model | dependency or grep test | nothing; none present today | silent | |
| D9 | automation rides the host's hooks and the agent's judgement | intent | n/a | silent | |
| D10 | generated views are never served | consequence of D6 | nothing | silent | |
| D11 | egress is doctor's opt-in probe | opt-in flag on the sole `fetch` | `doctor.ts:189,193` | blocked for that call; a new `fetch` elsewhere is unchecked | B10 |
| D12 | plus reads and writes to the user's own forge | operator-invoked `gh` | not built; PR #182 | silent | A8, B11 |
| D13 | note shape isolated in `src/adapters/claude-code/` | import-boundary test | nothing; `environment-guard.test.ts` constrains env branching only | silent | |
| D14 | no adapter interface until a second harness | absence test | nothing; `HarnessAdapter` absent today | silent | |
| F1 | durable content under a hidden directory | `.gitignore` plus doctor self-heal | `.gitignore:15-18`; `kb-checks.ts:370-393` | blocked | |
| F2 | a second home for transient state | same as D4 | `kb-checks.ts:841` | warns | |
| F3-F5 | a watcher, a daemon, a hosted service in the core | grep or dependency test | nothing | silent | |
| F6 | usage or content sent anywhere by default | same as D11 | `doctor.ts:189` | blocked | B10 |
| F7 | a background network call | absence-of-scheduler test | nothing; `observation-digest.yml` cron is CI, temporary | silent | |
| F8 | a `HarnessAdapter` before the second harness | same as D14 | nothing | silent | |

Decision 14, Forbids 8. blocked 3, fails-test 0, warns 4, silent 15. `[seat]` D1: the worker read `kb-checks.ts:233` and found the structure check is a constant `ok:true`. That is a doctor check that reports health without checking anything, the same shape as `soak-monitor-blind-spots` blind spot 2.

## 0057 a guard lands by pull request; the human merges

| id | clause | enforcer | exists? | outcome | row |
|---|---|---|---|---|---|
| D1 | the only way a guard lands is a branch and a pull request | branch ruleset | weaker: `governance.json:89,91` (generic, not guard-specific; no PR code in `src/`) | blocked | |
| D2 | opened only when invoked (`groom --propose`) | the flag | nothing; `groom` has no `--propose` (`cli-program.ts:295-321`) | silent | |
| D3 | never as a side effect of a hook | a check on hook paths | nothing; no PR code exists to misuse | silent | |
| D4, D5 | landing scopes; an org workflows repo later | scope allowlist in the applier | nothing; no applier | silent | |
| D6 | consent is the committed `landing` key | config reader | nothing; `src/grooming/config.ts:31-40` has no `landing` | silent | B12 |
| D7 | never a machine-local carrier | consent reader | nothing | silent | |
| D8 | writable when consent present and repo reachable | consent plus reachability | weaker: probe at `doctor.ts:192-211`, unwired | silent | |
| D9-D12 | guard types; rung matches type; a hook carries a test; a check lands as an issue | applier validation | nothing; no guard vocabulary in `src/` | silent | |
| D13 | `landed` only when the inventory finds the CI job | inventory checker | nothing | silent | A19 |
| D14 | one applier is the single writer | architecture | weaker: `src/index.ts:304-306` names the dream applier for notes, not guards | silent | |
| D15 | it mints `<scope>/<kind>/<slug>` | id minting | nothing | silent | |
| D16 | stamps provenance | `stampProvenance` | weaker: `provenance.ts:57` exists, no guard path calls it | silent | |
| D17-D21 | refuses missing skipped, illegal pair, hook without test, note without trigger and pointer, delete without target | applier refusals | nothing; D20 weaker as an AGENTS.md sentence | silent | |
| D22 | one committed file per id, `guards/<id>.md` beside `notes/` | scanned path | nothing; no `guards/` handling in `src/` | silent | A20 |
| D23 | the six carriers are outputs of landing | taxonomy | n/a | silent | |
| D24 | the compiled table under `.mage/` is a cache | gitignore plus scan skip | `.gitignore:18`; `scan.ts:38-45` | blocked | |
| D25 | autonomy sets how much the agent drains alone | autonomy ladder | weaker: `autonomy-ladder.ts:14-90` is mandate text for note grooming | warns | |
| D26 | the merge is the human gate at every level | ruleset forcing a human merge | weaker: `governance.json:93 required_approving_review_count: 0`, `:9 allow_auto_merge: true`; a PR can merge with no human click | warns | |
| D27 | a skill is one output rung, measured by firing | context-match metric | `skills-cmd.ts:145`, advisory | warns | |
| D28 | never a note promoted by usage count | absence of such a path | violated: `promote.ts:18-21` graduates by chapters-read count | warns `[seat]`: silent; nothing reports the violation | |
| F1 | committing to a default branch | ruleset | `governance.json:88,89,91` | blocked | |
| F2 | pushing outside the proposal branch | branch-scope check | nothing | silent | |
| F3 | deleting on disk | delete routes through a PR | nothing | silent | |
| F4 | a proposal without skipped reasons | applier | nothing | silent | |
| F5 | marking a check landed on issue closure alone | inventory | nothing | silent | A19 |
| F6 | consent from an env var or a local file | consent reader | nothing | silent | |
| F7 | a threshold in the proposer | none in the guard proposer | nothing; `crownThreshold` is a live threshold in the sibling proposer, `config.ts:38-39` | silent | |
| F8 | guard files under transient `.mage/` | rejection | nothing; such a file would be invisible, not refused | silent | |

Decision 28, Forbids 9. blocked 3, fails-test 0, warns 3, silent 31 (after the D28 correction). `[seat]` D26 is the finding of this table: the ADR's title claim, "the human merges", is not what the ruleset says. Zero required approvals plus auto-merge means a green PR merges itself. The worker flagged it as a doubt; it is not a doubt.
