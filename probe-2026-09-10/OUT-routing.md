# Blind routing of the 41 notes through the ADR-0051 ladder

Routed 2026-09-10 by hand, before opening `baseline-2026-09-03.md`. Corpus: 39 notes in the worktree at `a945759` plus the two untracked notes in the main checkout (`notes-must-read-in-one-screen`, `point-in-time-research-stays-private`).

Rungs as ADR-0051 states them: impossible, check, hook, rule, note. A sixth disposition, `delete`, is the ADR's own "delete proposal when its trigger stops occurring". `State` says whether the guard for that rung is already landed, still to build, or lives outside this repo (the KB doubles as the user store, so a user-level note routes to claude-kit or user settings).

Read counts were not used. See `read-evidence.md`.

## The table

| # | note | rung | mechanism (one line) | lands | state | why the higher rungs are out; trigger if note |
|---|---|---|---|---|---|---|
| 1 | ad-hoc-measurement-scripts-are-code | rule | "A number quoted in a decision or issue names the command that produced it and a second method that agrees." | `AGENTS.md`, one line | to build | impossible: no config stops a wrong number. check: nothing mechanical can tell a wrong figure from a right one. hook: no tool call to intercept; the number arrives as prose. |
| 2 | agent-maintained-files-carry-standing-rules-only | rule | "CLAUDE.md, skills and AGENTS.md carry present-tense rules only; no dates, no origin stories." | claude-kit `dotfiles/AGENTS.md` | out of repo, largely landed (§Writing, §Code comment budget) | impossible: no. check: a date-regex over CLAUDE.md is possible but the file is in another repo; a rule already there does the job. hook: none. This note is a user-level preference misfiled here; the note itself says so. |
| 3 | agentmemory-mining-map | delete | Trigger stopped. The conclusions are 0050 Forbids ("Depending on another memory product's engine", "Coordination primitives") and 0054 (no server). | none; git history keeps it | landed as decisions | Every rung above note is already occupied by the two decisions. Nothing left for a note to guard. |
| 4 | agy-commit-message-compliance-is-unreliable | check | After every agy run the runner diffs `git log -1 --format=%B` against the requested message and `git status --porcelain` for scratch files, and fails the run report on mismatch. | claude-kit `agy-delegate` / `agy-runner` post-run step | out of repo, to build | impossible: agy is a black box; cannot make it comply. hook: no PreToolUse fires inside agy. A script comparing two strings is a check. The repo-side half (PR-title conventional-commit check) exists in `.github/workflows/pr-title.yml`. |
| 5 | boundary-nudge-internals | check | A test: appending a `session_end` line to one session file changes `scratchFingerprint` even when the directory mtime does not. The rest of the note is a map of `nudge.ts` and is derivable from the file. | `src/adapters/claude-code/nudge.test.ts` | probably landed; verify | impossible/hook: n/a, it is a code map plus one gotcha. The two-channel fact (systemMessage vs additionalContext) is a three-line comment at the site, which the ladder has no rung for. Note body: delete once the test is confirmed. |
| 6 | connect-doesnt-ensure-ignores | check | `connect` calls `ensureGitignored` and `doctor` runs `git check-ignore` on the sinks; a test pins both. | `src/commands/connect.test.ts`, `src/doctor/kb-checks.ts:382` (gitignore check, `--fix` self-heals) | landed | Bug fixed; trigger stopped. The general lesson ("guarantee the sink at the moment you start writing") is the code, not a note. Delete. |
| 7 | context-mode-blocks-files-outside-project-root | impossible | `permissions.allow: ["Read(/home/sumit/ai-context/**)"]` in user settings, the fix the error message itself prints. | `~/.claude/settings.json` | out of repo, to build | Config removes the failure; nothing lower needed. User-level; misfiled here. |
| 8 | delegation-prompts-must-name-real-commands | rule | "Verify commands are `pnpm typecheck` and `pnpm test`. There is no lint or format script. Never run biome." | `AGENTS.md` in this repo (agy reads it; it does not read the KB) | to build | impossible: cannot stop a prompt naming a bad command. check: the kit could grep a prompt for `pnpm run X` against `package.json` scripts; cheap, but the AGENTS.md line reaches every delegate without kit changes. hook: none fires on prompt authoring. |
| 9 | dogfood-before-release | rule | "Before `npm publish`, run the new command in this repo's own KB with a planted secret and malformed stdin." | release procedure (AGENTS.md or the kit's release skill); 0059 §Decision is the gate | to build | impossible: publish is manual by design. check: nothing mechanical proves a human dogfooded. hook: no tool call. |
| 10 | gate2-blocks-own-redaction-fixtures | check | `scanStaged` scopes to the docs root; a test asserts a staged `src/*.test.ts` fixture is not scanned. | `src/staged-scan.test.ts` | landed | Bug fixed, test exists (the note says "now fixed"). The test-isolation sibling (connect writes the hook into real cwd) is a test-harness rule, one line in the test helper. Delete. |
| 11 | gate2-fp-blocks-autonomy | hook | PreToolUse on Edit/Write of `.claude/settings.local.json`: deny when the resulting file has fewer `mage:*` hook ids than the current one. | `src/adapters/claude-code/settings.ts:109` (the existing PreToolUse Write/Edit matcher) | to build | impossible: a `deny Edit(.claude/settings.local.json)` blocks connect itself. check: too late, the hook is already gone when the commit runs. The operator corrected twice: a real repeat. The rule form ("never disable a gate to unblock") is the fallback. |
| 12 | gemini-reindents-whole-files-with-tabs | check | CI step or test: `grep -rl $'^\t' src/ test/` must be empty. | `.github/workflows/ci.yml` or `src/indentation.test.ts` | to build | impossible: no editorconfig stops biome. hook: agy runs outside the harness. A grep is a check. Covers #19 too. |
| 13 | harness-memory-layer-rewrites-mage-frontmatter | hook | PostToolUse flatten repairs CC-shaped frontmatter after every Write/Edit under `mage/`. | `src/adapters/claude-code/flatten.ts`, PR #259 (#200) | landed but dead (`isCcShaped` keys on a field the harness no longer stamps; OUT-contradictions B7) | impossible: pointing autoMemoryDirectory elsewhere breaks 0051's one-store design. check: `mage index` could reject `name: ""` frontmatter as a backstop. Keep as note until #200 lands; then delete. |
| 14 | harness-notifications-pollute-the-corrections-lens | impossible | `observe` skips a user_prompt whose text starts with `<task-notification>` or contains `<summary>Monitor event:`. | `src/commands/observe.ts` | to build; the lens itself retires in PR #256 | Fix at capture removes the noise. Lower rungs would make every reader filter by hand, which the note says is the cost. |
| 15 | link-harvests-must-genre-filter-sources | check | Test: N cross-linked decisions plus k memory-linked notes harvest exactly k. | `src/commands/skills-cmd.test.ts` | probably landed; `skills` retires in #256 | The note names the regression shape itself. Delete once the test is confirmed or the command is gone. |
| 16 | mage-integration-test-framework | check | CI runs `pnpm test:integration` (deterministic tier) on every PR. | `.github/workflows/ci.yml`, PR #254 (#243) | to build; one integration test red since 2026-07-29 | The layout description is `test/integration/README.md`'s job. The stdin gotcha is in `harness.ts` already. Delete note. |
| 17 | mage-is-durable-memory | delete | 0050 is the charter now and says the opposite ("memory is the queue, not the product"). | none | superseded | A principle note that disagrees with the governing decision is worse than none. The presence-not-clock half survives in #34's fix. |
| 18 | mage-main-branch-protected | impossible | GitHub ruleset 17441632: PR required, `CI gate` required, force-push blocked. `scripts/sync-repo-governance.sh` applies it from `.github/governance.json`. | github.com repo settings | landed | The enforcement is the ruleset; the note describes it. The branch-PR-merge procedure is in the global AGENTS.md. Delete. |
| 19 | mage-no-biome-2space | check | Same leading-tab check as #12, plus the AGENTS.md line from #8. | see #12, #8 | to build | Fold into #12. |
| 20 | mature-kb-emits-no-capture-terminals | delete | keep-rate, crownThreshold and the a1-bake gate are all gone (0057, 0059; verbs retire in #256). | none | superseded | Trigger stopped. |
| 21 | migration-field-notes | check | Test: `mage migrate` leaves the imported body byte-identical (`diff` after stripping frontmatter). | `src/commands/migrate.test.ts` | unknown; verify | The recipe was "reuse until the bulk import exists"; 0055 folds adopt into migrate. If the test exists, delete; if not, the test is the guard, not the recipe. |
| 22 | no-emojis-in-releases | check | PR-title workflow rejects a title containing a character in the emoji ranges; release-please builds the changelog from those titles. | `.github/workflows/pr-title.yml` | to build | impossible: n/a. hook: none on `gh release`. A regex is a check. User-level preference too; the kit could carry the rule for other repos. |
| 23 | notes-must-read-in-one-screen | check | `mage index` rejects a note over 40 lines. | `src/commands/index-cmd.ts`, #253 | to build (#253 is the check) | The note says "prefer a check; #253 is that check". Delete when it lands. |
| 24 | npx-mage-runs-the-published-release | rule | "Verify local changes with `pnpm build && node dist/cli.js`, never `npx mage`." | `AGENTS.md`, one line | to build | impossible: cannot change how npx resolves. check: `doctor` could print `readlink -f $(which mage)` and warn when it is not this tree; cheaper as a rule. hook: a PreToolUse on Bash matching `npx mage` is possible but heavy for a one-line rule. |
| 25 | plan-v0.1-locks | delete | Naming is in `package.json` `bin`; visible `mage/` is 0054; MAP.md and constitution are gone. | none | landed | History. |
| 26 | plugin-directory-source-copies-untracked-tree | check | `doctor`: warn when `~/.claude/plugins/cache/mage` has a directory source or exceeds 10 MB. | `src/commands/doctor.ts:237` (the existing `skills` plugin check) | to build | impossible: cannot change how Claude Code copies. hook: none. The README already teaches the GitHub source (rule form, landed). |
| 27 | point-in-time-research-stays-private | check | Pre-commit or CI fails when a path under `docs/plans/` is staged (0050 forbids a committed plan file). | `src/git-hooks.ts:42` (the pre-commit body) or `.github/workflows/ci.yml` | to build | The "research" half is semantic and stays a rule in the kit. The path half is mechanical. This note stopped a page going into #262 today, so the check earns its place. |
| 28 | prefer-the-repos-lock-free-convention | rule | "Concurrent-writer state is append-only JSONL folded on read. Rotate, never rewrite in place. See `src/observe/store.ts`." | `AGENTS.md`, one line | to build | impossible: no. check: a lint forbidding `writeFileSync` on `.mage/**` is possible but brittle. hook: none. The four-round saga is history. |
| 29 | promote-folds-mechanical-tokens | delete | promote is retired (0057); the surviving lesson is 0050 Forbids ("A threshold or recurrence count that gates"). | none | superseded | Trigger stopped. |
| 30 | redaction-anthropic-key-detector | check | The never-leak loop in `redact.test.ts`; add a test that every `DETECTORS` entry has a `POSITIVES` fixture. | `src/redact.test.ts:21` | landed (loop), one assertion to add | The detector-order rule is a table order with a test. Delete note. |
| 31 | release-bump-touches-many-artifacts | check | `release-consistency.test.ts` plus release-please. | `src/release-consistency.test.ts`, `release-please-config.json:10` | landed | The PAT fact belongs in a docs page. Delete note. |
| 32 | replay-gate-methodology | note | trigger: "before shipping a new narrowing rule over observe events". pointer: `~/ai-context/mage-prove-20260619/` is author-local, so the pointer is 0052 §Why. | `mage/notes/`, compressed | keep | impossible/check/hook: a methodology for evaluating a mechanism has no mechanical form. rule: too long for one line. Low confidence: if 0050 means no new narrowing rules ever, the trigger is dead and this is a delete. |
| 33 | route-memories-to-the-matching-store | hook | The ladder text the memory hook returns asks "which store: this repo, the user store, or a product idea" before the rung. | `src/adapters/claude-code/memory-hook.ts` (PR #258) | to build | impossible: no. check: too late. The hook already fires at the exact moment. Rule form in the kit as fallback. |
| 34 | soak-monitor-blind-spots | impossible | Blind spot 1: drop `code_repo_path` (#193, lane-193). Blind spots 2 and 3 are in a retired script outside the repo. | `src/paths.ts` via #193 | in flight | Once the field is gone the failure cannot recur. Delete note when #193 merges. |
| 35 | soak-targets | delete | The roster (prismalens, sreforge) belongs in the issue that gates on units (#215); the monitor is retired. | issue #215 | to move | A roster is not insight. Highest foreign-read count in the log, which is about the only place the list was findable, not about the note. |
| 36 | status-vocabulary-drift-undercounts-filters | check | `mage index` validates `status:` against a vocabulary and warns on any other value. | `src/commands/index-cmd.ts:654` (beside the existing caution-status list) | to build | impossible: no. hook: none. The census habit is what produced today's collapse evidence, but the mechanical form is an enum check. |
| 37 | stopped-background-workflows-leave-no-record | rule | The kit's `anti-stall` skill already says "key on evidence the work writes, never on harness liveness." | claude-kit `anti-stall` | out of repo, landed | User-level. Delete here. |
| 38 | test-files-were-excluded-from-typecheck | check | `tsconfig.json:41` now includes `test/**/*`; add an assertion that `exclude` never lists `**/*.test.ts`. | `src/release-consistency.test.ts` or a new one-liner | landed (CI typecheck at `ci.yml:50`), guard assertion to add | Delete note. |
| 39 | unreachable-constant-reports-a-false-state | check | `knip` (or `ts-prune`) in CI fails on an unused export. | `.github/workflows/ci.yml`, `package.json` | to build | impossible: TS has no flag for exported-but-unimported. hook: none. The "omit the parameter" test habit is a rule; the exported-dead-constant half is mechanical. |
| 40 | weakening-a-test-can-delete-its-purpose | rule | "When a deliberate change breaks a test, rebuild the fixture. Ask: would it still fail if the feature were deleted?" | `AGENTS.md` or the kit's `code-review` skill | to build | impossible: no. check: mutation testing (Stryker) is the mechanical form and too heavy for this repo. hook: none. |
| 41 | context.md | delete | 194 lines of vocabulary 0050 forbids (lesson, chapter, wing, room, staged, admitted, graduate). #248 fixed five words. | none | superseded | A glossary that contradicts the charter is a hazard, not a memory. |

## Tally

| rung | count | of which landed already |
|---|---|---|
| impossible | 4 | 1 (#18) |
| check | 18 | 6 (#6, #10, #30, #31, #38 landed; #5, #15 probably) |
| hook | 3 | 1 dead (#13) |
| rule | 8 | 2 (#2, #37, both in the kit) |
| note | 1 | 1 |
| delete | 7 | |

Notes that leave this repo either way (user-level, routed to claude-kit or user settings): #2, #4, #7, #37, and arguably #22, #40. Six of 41 were never this repo's memories.

"Landed" appears in 10 rows. Ten notes describe a guard that already exists; they survived because nothing deleted a note when its guard landed. That is the enforcement debt ADR-0051 names, in a form the ladder does not describe: not "should have been a check", but "became a check and the note stayed".

## Rows where the answer is not clean

Nine rows below have a stated alternative rung. They are the raw material for `OUT-pits.md`.

- #5, #15, #21: the rung depends on whether a test already exists. The note cannot tell you; `src/` can.
- #8, #24: rule versus check. Both are cheap; the choice is where the reader is (a delegate reads AGENTS.md, a doctor check reads nothing until run).
- #11: hook versus rule. Hook only if PR #258's hook framework makes a second matcher cheap.
- #13, #34: hook or impossible, but the guard is in an unmerged PR. The rung is right; the state is "wait".
- #27: two halves, one mechanical and one semantic. The row takes the mechanical half.
- #32: note versus delete, and it turns on how 0050's Forbids is read.

## Verified after the blind pass (not part of the routing; recorded so the table's "verify" cells resolve)

A Sonnet worker grepped `src/` after the table above was written. `pnpm test`: 88 files, 1,552 tests green.

- #5 landed: `src/adapters/claude-code/nudge-state.test.ts:32` pins the fingerprint on an appended `session_end`.
- #15 landed: `src/commands/skills-cmd.test.ts:278` pins the k-of-N harvest.
- #21 absent: no test asserts a byte-identical body after frontmatter is prepended; the recipe exists only in the note. Rung stays check, state "to build".
- #38 absent: nothing asserts `tsconfig.json` `exclude`; the fix is in place, untested.
- #14 absent: no `task-notification` string anywhere in `src/`. Rung stays impossible, state "to build".
- #30 partial: the never-leak loop exists (`src/redact.test.ts:213`, `:496`); no test iterates `DETECTORS`, which is not exported.
- #6 landed: `src/commands/connect.test.ts:327` and `src/commands/doctor.test.ts:245`; the ignore pattern is `mage/.mage/`, not `.learnings/`.
- #10 landed: `src/staged-scan.test.ts:84`.
