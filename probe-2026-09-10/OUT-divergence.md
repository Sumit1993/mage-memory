# Divergence: the 09-03 baseline against today's blind routing

Both passes used the same ladder text (impossible, check, hook, rule, note, plus delete). The baseline routed 39 notes on 2026-09-03; today's pass routed the same 39 plus two new ones, before reading the baseline. Join by filename stem; checked by a script and by a Sonnet worker independently, same numbers.

## The number

| metric | value |
|---|---|
| notes in both passes | 39 |
| same rung | 21 |
| different rung | 18 |
| agreement | 21/39 = 53.8% |
| agreement, counting "delete" and "check, guard landed" as the same disposition | 22/39 = 56.4% |

Two careful passes over one corpus with one rubric agree on about half the rows. That is the headline.

Per rung, taking the baseline's rung as the row and asking how often today's pass kept it:

| baseline rung | rows | kept today | kept rate |
|---|---|---|---|
| impossible | 1 | 1 | 1/1 |
| check | 11 | 7 | 64% |
| hook | 5 | 1 | 20% |
| rule | 9 | 6 | 67% |
| note | 8 | 1 | 13% |
| delete | 5 | 4 | 80% |

The two rungs ADR-0051 cares most about are the least stable. `hook` is the rung the ADR builds its product on; `note` is the rung it wants to empty. A second pass kept one of five hooks and one of eight notes.

## The 18 rows, sorted by why they moved

### A. The decisions changed between the two passes (5 rows)

The baseline was routed against 48 decisions; today against ten. Four notes lost their trigger when 0057 and 0059 retired promote, keep-rate and the a1 gate, and one gained a higher rung when 0051 mandated a ladder hook.

| note | 09-03 | today | which is right |
|---|---|---|---|
| mature-kb-emits-no-capture-terminals | note | delete | today. The gate the note guards no longer exists. The baseline was right on its day. |
| promote-folds-mechanical-tokens | note | delete | today, same reason. |
| route-memories-to-the-matching-store | rule | hook | today, conditional on PR #258. On 09-03 there was no ladder hook to attach to; the baseline's "no program can determine scope" is still true, and the hook does not determine it, it asks. |
| soak-monitor-blind-spots | check | impossible | today, conditional on #193. The baseline's three script checks are correct for a script that is now retired. |
| mage-integration-test-framework | note | check | today. OUT-contradictions B9 (integration tests never run in CI, one red since 07-29) was not on the table on 09-03. |

A router that reads only the note reproduces the 09-03 answer on all five and is wrong on all five today.

### B. Same mechanism, different rung label (4 rows)

| note | 09-03 | today | what happened |
|---|---|---|---|
| agy-commit-message-compliance-is-unreliable | hook | check | Both diff `git log -1 --format=%B` against the expected text. The baseline puts it in `.git/hooks/commit-msg`; today puts it in the kit's post-run step. Same two strings, compared at a different moment. |
| no-emojis-in-releases | hook | check | Both grep for emoji codepoints. Baseline: PreToolUse on `gh release`. Today: the PR-title workflow. |
| harness-notifications-pollute-the-corrections-lens | check | impossible | Both are the same code change in `observe` plus its test. The baseline names the test; today names the fix. |
| release-bump-touches-many-artifacts | delete | check (landed) | Identical disposition. The baseline says "delete, the check exists"; today says "check, landed, delete the note". |

The ladder's rung boundaries are not kinds of guard. hook/check is "when does the comparison run"; check/impossible is "do you name the fix or its test". Two routers naming the same artifact will disagree on the label, and the label is what the ledger counts.

### C. The note has two halves and each pass took a different one (2 rows)

| note | 09-03 | today | |
|---|---|---|---|
| dogfood-before-release | check | rule | The CI half (build, test, typecheck) is a landed check; the smoke-against-real-inputs half is a rule. The baseline routed the automatable half, today the un-automatable one. |
| mage-no-biome-2space | hook | check | A `Bash(*biome*)` deny reaches Claude; a leading-tab grep reaches agy, which runs outside the harness. The note's own incident was agy. Both are right about different actors. |

### D. The rung depends on whether an artifact already exists in `src/` (2 rows)

| note | 09-03 | today | |
|---|---|---|---|
| boundary-nudge-internals | note | check | If `nudge.test.ts` pins the fingerprint fact, the note is a code map and goes. Neither pass read the test. |
| migration-field-notes | note | check | If `migrate.test.ts` asserts body bytes unchanged, the recipe is redundant. Neither pass read the test. |

### E. Real disagreement between two readers (5 rows)

| note | 09-03 | today | ruling |
|---|---|---|---|
| context-mode-blocks-files-outside-project-root | hook | impossible | Today. The note's own item 4 is a permissions allow rule; config beats a rewrite hook. The baseline reached for the more elaborate rung. |
| gate2-fp-blocks-autonomy | rule | hook | Today, with the baseline's caveat intact: a PreToolUse on `settings.local.json` raises the bar, it does not make removal impossible (Bash can still do it). Two operator corrections earn more than a sentence. |
| npx-mage-runs-the-published-release | note | rule | Today, narrowly. One AGENTS.md line covers it. The baseline follows ADR-0051's own Example, which routes this note to rung 5. The ADR's worked example is the routing I would overturn. |
| plugin-directory-source-copies-untracked-tree | rule | check | Either. A doctor check is one function; the README rule already exists. Coin flip. |
| soak-targets | note | delete | Today. A roster is not insight; it belongs in the issue that gates on units (#215). The baseline's trigger ("reading a soak rollup") no longer occurs. |

## The two new notes

`notes-must-read-in-one-screen` and `point-in-time-research-stays-private` both route to check today (#253's 40-line index check; a `docs/plans/` path check in pre-commit or CI). Not counted above.

## Would an automated router have been stable here?

No, and the instability is not random.

- 5 of 18 disagreements came from the decisions changing under the corpus. A router that reads the note and the ladder text, and not the current `decisions/`, is frozen at the day of routing. In this repo the decisions changed completely in seven days.
- 4 came from the rung vocabulary itself. hook versus check versus impossible are not disjoint for a code fix with a test. Two routers will label the same guard differently and the ledger will count them as different guards.
- 2 came from notes that carry two guards. The router picks one and the other is lost silently.
- 2 needed a grep of `src/` for an existing test. A note-only router cannot do it.
- 5 were judgement. Of those, one is the ADR's own example going the other way.

The stable rungs are the ones that need the least judgement: delete when the trigger is plainly dead (4/5), rule when the mechanism is plainly a sentence (6/9). The unstable rungs are hook (1/5) and note (1/8). A router will pick `note` when it is unsure, because `note` is the ADR's floor. In this corpus, `note` is the answer most likely to be overturned by a second reader. The router's fallback is the rung with the worst replication.

So the premise of ADR-0051 survives (both passes agree the store was mostly enforcement debt: 33 of 39 rows leave the note rung in one pass or the other), but the specific count in its Why section does not replicate, and a program producing that count would be wrong about half the time without knowing which half.
