<!-- salvaged from subagent transcript agent-a832121587f5c095b.jsonl, spawned 2026-09-10T08:44:31.399Z; the parent planner was killed by the session limit at 08:52 -->

# Task

Read-only comparison task. Do not write any file. Do not modify anything.

Two files:
- A: /home/sumit/ai-context/notes-probe/baseline-2026-09-03.md (a prior routing of 39 notes to a rung; rungs are impossible, check, hook, rule, note, and some rows say delete/deletion)
- B: /home/sumit/ai-context/notes-probe/OUT-routing.md (today's routing of 41 notes; column `rung` in the table)

Produce, in this order:

1. The exact rung vocabulary A uses (list each distinct rung word and how many rows carry it) and whether A has any extra columns (mechanism, reason, disposition). Quote A's header row verbatim.
2. A join table, one row per note filename stem (strip `.md`), columns: note | A rung | B rung | same? | A's mechanism (verbatim, one line) | A's reason (verbatim, one line, truncate at 160 chars). Order by note name. Notes present in only one file get "absent" in the other column. Match by filename stem; if A uses titles instead of filenames, map them by hand and say which mappings were uncertain.
3. Counts: notes in both; rows where rung is identical; rows where they differ; the agreement rate as identical / in-both, to one decimal place. Then a second rate that treats `delete` in either file as matching `delete` or `deletion`, and treats B's `check` rows whose `state` column says "landed" as equivalent to A's `delete`/`deletion` (report this second rate separately and label it clearly as the looser rate).
4. The list of the differing rows only, with both rungs.
5. Notes present i

# Final report

Both verification checks pass: `grep -c` on OUT-routing.md returns 41 (matches), and A's note-routing table parsed to exactly 39 rows (matches A's own summary-table total of 1+11+5+9+8+5=39). Report follows, all data machine-derived from the two files, no files modified.

## 1. A's rung vocabulary

Header (verbatim): `| rung | count |`

| rung | count |
|---|---|
| impossible | 1 |
| check | 11 |
| hook | 5 |
| rule | 9 |
| note | 8 |
| delete | 5 |

No "deletion" spelling anywhere in A; only "delete". A's note-routing table header (verbatim):
`| file | rung | mechanism (concrete: the check/hook/rule/deny you would write, one line) | where it lands (repo path, claude-kit, or harness settings scope) | trigger moment (only for rung=note, else blank) | why |`

Extra columns beyond file+rung: **mechanism**, **where it lands**, **trigger moment**, **why** (the reason column). No column literally named "disposition" — rung serves that role.

## 2. Join table (39 in both, 2 B-only → 41 rows, alphabetical by stem)

Full mechanism/why text is long; shown truncated where noted. `absent` = note not in that file.

| note | A rung | B rung | same? | A mechanism (verbatim) | A why (verbatim, ≤160 chars) |
|---|---|---|---|---|---|
| ad-hoc-measurement-scripts-are-code | rule | rule | same | AGENTS.md rule: "cross-check every number before it enters a decision with an independent method; print the derivation, not just the total" | No program can detect whether a measurement was cross-checked; the rule applies at ADR-drafting time where a human is always present. |
| agent-maintained-files-carry-standing-rules-only | rule | rule | same | AGENTS.md rule: "when editing CLAUDE.md or a skill, state rules in present tense; delete origin stories and one-off negative statements" | The failure is a writing-style choice at edit time; no linter can distinguish a rule from its backstory. |
| agentmemory-mining-map | delete | delete | same | Already compressed; full content in git history; decisions it drove (ADR-0007/0009/0010) are ratified and implemented. | The note itself says "re-verify against their CHANGELOG before acting on any verdict" -- the operational conclusions are owned by the ADRs it re... (160c) |
| agy-commit-message-compliance-is-unreliable | hook | check | diff | commit-msg hook that runs `git log -1 --format=%B` and diffs against the byte-exact expected message stored in a prompt-supplied reference | Calibration example: a commit-msg hook catches the exact failure at the moment the commit is made. |
| boundary-nudge-internals | note | check | diff | (no mechanism; this is implementation documentation) | The note describes internal wiring of a live component; the trigger is exactly "agent opens these files to modify them or diagnose unexpected nu... (160c) |
| connect-doesnt-ensure-ignores | check | check | same | Unit test: after calling `mage connect`, assert `git check-ignore -q .learnings/x .metrics/x` exits 0 for the connected KB | The gap is in connect's code; a test that calls connect and then asserts ensureGitignored ran is the concrete check, and the note documents the ... (160c) |
| context | delete | delete | same | Glossary and reference document; contains no single lesson to enforce -- it is the living terminology reference. | No single enforcement target: the file is authoritative reference prose, not a behavioural lesson with a trigger moment. |
| context-mode-blocks-files-outside-project-root | hook | impossible | diff | PreToolUse hook intercepts ctx_execute_file calls where the path resolves outside the project root and rewrites to ctx_execute with inline fs.readFileSync | Calibration example: a PreToolUse rewrite removes the failure at the moment the blocked tool is called. |
| delegation-prompts-must-name-real-commands | rule | rule | same | AGENTS.md rule: "before delegating, verify every command you name exists: node -e ...; distil repo house rules into the prompt" | No program can verify that a delegation prompt names only real commands before the prompt is written; the rule must be followed by the orchest... (160c) |
| dogfood-before-release | check | rule | diff | CI gate: pnpm test && pnpm run typecheck && pnpm build must be green before any tag; smoke-test procedure documented in plan-release-sequence.md | The pnpm test/typecheck/build portion is already a CI check; the CI gate is the concrete enforcement for the automatable portion. |
| gate2-blocks-own-redaction-fixtures | check | check | same | Unit test: scanStaged called with a staged set that includes src/*.test.ts fixtures must not flag them; assert only files under resolveDocsRoot are scanned | The scope bug is already fixed; the concrete enforcement is the test that proves scanStaged scoping holds for the fixture case. |
| gate2-fp-blocks-autonomy | rule | hook | diff | AGENTS.md rule: "never disable or remove the Gate-2 pre-commit hook to unblock yourself; report the exact blocked command and surface it for the human to run" | An autonomous agent's decision to remove a hook is purely behavioral; no hook can prevent itself from being removed by the agent managing it. |
| gemini-reindents-whole-files-with-tabs | check | check | same | Post-delegation verification: grep -c "^\t" <touched-files> -- any nonzero count on a 2-space repo fails; add to agy-delegate verification checklist | Calibration example: a diff-stat/tab-count check after every agy run catches the reindent before the commit. |
| harness-memory-layer-rewrites-mage-frontmatter | hook | hook | same | PostToolUse hook on Write/Edit tools: if the written file is under mage/ and contains "name: \"\"" or "node_type: memory" in frontmatter, run `mage flatten` | The damage happens the moment the Write/Edit tool completes; a PostToolUse hook is the earliest point at which the rewrite can be detected and... (160c) |
| harness-notifications-pollute-the-corrections-lens | check | impossible | diff | Unit test in distill: assert corrections-lens output excludes signals starting with `<task-notification>` or containing `<summary>Monitor event:`; fixture with both types | The durable fix is at capture (ADR-0015 territory); until it ships a test that proves the filter exists is the concrete enforcement. |
| link-harvests-must-genre-filter-sources | check | check | same | Unit test: any link-harvest function has a test asserting N fully cross-linked ADR-genre notes + k memory-genre sources yields exactly k harvested results | The failure was a code bug in the harvest filter; the regression test pinning it is the concrete check. |
| mage-integration-test-framework | note | check | diff | (no mechanism) | The note documents the test layout and the stdin-close gotcha; the trigger is exactly when an agent writes a new integration or live test. |
| mage-is-durable-memory | delete | delete | same | Charter/principle document; its lessons are expressed in ADRs 0004, 0005, and 0035 which are ratified and implemented. | A charter document defines terms; the specific behavioral lessons all point back to authoritative ADRs. No single enforcement moment exists. |
| mage-main-branch-protected | impossible | impossible | same | GitHub branch protection ruleset id 17441632 refuses direct pushes to main; no bypass actors; force-push and deletion blocked. | Calibration example: GitHub branch protection already refuses the push; nothing for an agent to remember. |
| mage-no-biome-2space | hook | check | diff | PreToolUse deny rule on bash commands matching biome or prettier targeting files in mage-memory | A deny rule on the bash tool prevents running biome/prettier at the moment the command is proposed, before any reformatting damage occurs. |
| mature-kb-emits-no-capture-terminals | note | delete | diff | (no mechanism) | The note describes a structural property of a mature KB that makes the gate report uncalibratable; the trigger is precisely "keep-rate gate de... (160c) |
| migration-field-notes | note | check | diff | (no mechanism) | The recipe and ADR-0004 clarification are only needed at migration time; the trigger is "agent is about to migrate a body of external notes." |
| no-emojis-in-releases | hook | check | diff | PreToolUse hook on bash commands containing "gh release create/edit": scan --notes/--notes-file for emoji codepoints and block | The failure occurs the moment the release command is run; a PreToolUse hook can reject the content before it is published. |
| notes-must-read-in-one-screen | absent | check | n/a | absent | absent |
| npx-mage-runs-the-published-release | note | rule | diff | (no mechanism) | The binary-resolution trap only matters at "I am about to verify my working-tree changes" -- exactly the question the agent asks before each v... (160c) |
| plan-v0.1-locks | delete | delete | same | Point-in-time planning document; all naming and lock decisions are implemented; superseded by the running codebase and ADR-0008. | All decisions in this file are resolved: package name, brand, MAP.md dropped, constitution promoted. Nothing actionable remains. |
| plugin-directory-source-copies-untracked-tree | rule | check | diff | AGENTS.md rule: "register the mage marketplace by GitHub source, never by local directory path; drop the cache before crediting skill behaviour" | No hook can intercept the /plugin marketplace add ./path UI command; the rule must be stated so the agent picks the right form at plugin-regis... (160c) |
| point-in-time-research-stays-private | absent | check | n/a | absent | absent |
| prefer-the-repos-lock-free-convention | rule | rule | same | AGENTS.md rule: "on any hook-invoked path, append one JSONL line and fold on read; never read-modify-write or compact in place; rotate instead" | The concurrency pattern choice cannot be detected by a linter; the rule guides design review when adding a new writer to a shared hook-invoked... (160c) |
| promote-folds-mechanical-tokens | note | delete | diff | (no mechanism) | The diagnosis (high volume + zero value = mechanism problem, not a backlog) only matters at that specific groom output; ADR-0038 owns the remedy. |
| redaction-anthropic-key-detector | check | check | same | src/redact.test.ts POSITIVES and RAW_SECRETS arrays must include a fixture with hyphens and underscores in the key body; the never-leak loop is the guard | The fix is in code; the regression test with a hyphen/underscore-containing body is the concrete check that must stay. |
| release-bump-touches-many-artifacts | delete | check | diff | The note itself says release-please now owns the bump and src/release-consistency.test.ts backstops it; the lesson is already enforced. | Calibration example: the note explicitly states release-please automates the bump and CI tests the consistency. |
| replay-gate-methodology | note | note | same | (no mechanism) | The replay-gate procedure is invoked exactly "before shipping or default-enabling any new detector/digest/capture heuristic" -- a precise trig... (160c) |
| route-memories-to-the-matching-store | rule | hook | diff | AGENTS.md rule: "before writing a note ask: future agents in this repo only, or in any repo? route repo-scoped to mage/notes/, user-scoped to global" | Routing scope is a judgment call at note-write time; no program can determine whether a lesson is repo-scoped or user-scoped. |
| soak-monitor-blind-spots | check | impossible | diff | soak-report.mjs: assert live-unit count matches soak-targets.md roster; falsify "not yet built" footers with find; exclude baseline:true from keep-rate | Three concrete verifiable checks are named; all are automatable in the monitor script. |
| soak-targets | note | delete | diff | (no mechanism) | The roster of soak targets must be consulted whenever a rollup is read; the trigger is "I am reading a soak rollup." |
| status-vocabulary-drift-undercounts-filters | check | check | same | Unit test: harvest filter test suite must include a fixture with status: active (legacy value) and assert it is included; pinned by extreme review finding | The bug is a code filter that missed a vocabulary variant; a test with the legacy value pinned to the filter is the concrete regression check. |
| stopped-background-workflows-leave-no-record | rule | rule | same | AGENTS.md rule: "any work expected to outlive a turn must write durable evidence (log + exit sentinel, artifact, or commit); never diagnose from absence" | No hook can intercept a UI-level TaskStop; the anti-stall doctrine is a design rule for how background work is structured. |
| test-files-were-excluded-from-typecheck | check | check | same | tsconfig.json must not list **/*.test.ts in exclude; CI pnpm typecheck then gates test-file type errors automatically | The fix is already applied; the check is the existing CI typecheck job that now covers test files. |
| unreachable-constant-reports-a-false-state | check | check | same | Unit test: for every default-parameter path, add a test variant that omits the parameter and asserts the default value is used | The lesson reduces to "add the test that omits the parameter"; that specific test shape is the concrete check. |
| weakening-a-test-can-delete-its-purpose | rule | rule | same | AGENTS.md rule: "when a behaviour change breaks a test, ask: would this test still fail if the feature it names were deleted?" | The judgment of whether an assertion is vacuous requires understanding intent; no linter can distinguish a tautology from a real assertion. |

No hand-mapping needed — both files use the same filename-stem vocabulary (B's row 41 even writes "context.md" literally in its `note` column, same as A's `file` value).

## 3. Counts

| metric | value |
|---|---|
| notes in both files | 39 |
| rows with identical rung | 21 |
| rows that differ | 18 |
| agreement rate (identical / in-both) | 21/39 = 53.8% |
| **looser rate** (delete≈deletion, and B check+state="landed" ≈ A delete) | 22/39 = 56.4% |

The looser rate adds exactly one match: `release-bump-touches-many-artifacts` (A=delete, B=check with state literally "landed"). One other diff row, `boundary-nudge-internals`, has B state "probably landed; verify" — hedged, not an exact "landed", so it was not folded into the looser count.

## 4. Differing rows (18)

| note | A rung | B rung |
|---|---|---|
| agy-commit-message-compliance-is-unreliable | hook | check |
| boundary-nudge-internals | note | check |
| context-mode-blocks-files-outside-project-root | hook | impossible |
| dogfood-before-release | check | rule |
| gate2-fp-blocks-autonomy | rule | hook |
| harness-notifications-pollute-the-corrections-lens | check | impossible |
| mage-integration-test-framework | note | check |
| mage-no-biome-2space | hook | check |
| mature-kb-emits-no-capture-terminals | note | delete |
| migration-field-notes | note | check |
| no-emojis-in-releases | hook | check |
| npx-mage-runs-the-published-release | note | rule |
| plugin-directory-source-copies-untracked-tree | rule | check |
| promote-folds-mechanical-tokens | note | delete |
| release-bump-touches-many-artifacts | delete | check |
| route-memories-to-the-matching-store | rule | hook |
| soak-monitor-blind-spots | check | impossible |
| soak-targets | note | delete |

## 5. Set differences

- In B, not A (2, as expected): `notes-must-read-in-one-screen`, `point-in-time-research-stays-private` — both untracked in git status, both routed by B to `check`.
- In A, not B: none. All 39 of A's files appear in B.
