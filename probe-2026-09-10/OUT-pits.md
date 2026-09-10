# The pits: where the ladder gave no clear answer, and what a router would need

Written after routing 41 notes blind, comparing to the 09-03 baseline (53.8% agreement), and reading the ten decisions' enforcement tables. The routing is in `OUT-routing.md`; this file is about why it was hard.

## 1. Notes where the ladder gave no clear answer, and the fact that would have decided it

| note | rungs in play | the deciding fact | who has it |
|---|---|---|---|
| boundary-nudge-internals | note / check / delete | does `nudge-state.test.ts` already pin the fingerprint fact? (yes, `:32`) | `src/`, not the note |
| migration-field-notes | note / check | does `migrate.test.ts` assert a byte-identical body? (no) | `src/` |
| link-harvests-must-genre-filter-sources | check landed / delete | does the test exist (yes, `skills-cmd.test.ts:278`) and is `skills` being retired (PR #256)? | `src/` and an open PR |
| harness-memory-layer-rewrites-mage-frontmatter | hook / impossible | is the PostToolUse flatten alive? (no, OUT-contradictions B7) | an issue, #200 |
| soak-monitor-blind-spots | check / impossible | is `code_repo_path` being removed? (#193, lane open) | an open PR |
| route-memories-to-the-matching-store | rule / hook | will the memory hook return a ladder prompt at all? (PR #258) | an open PR |
| replay-gate-methodology | note / delete | does 0050's Forbids mean no new narrowing rule will ever be proposed? | the operator |
| dogfood-before-release | check / rule | which half of the note is being routed | the note has two guards |
| mage-no-biome-2space | hook / check | which actor is being guarded, Claude or agy | the note's incident says agy; the baseline routed for Claude |
| gate2-fp-blocks-autonomy | hook / rule | can a PreToolUse on `settings.local.json` stop an agent that has Bash? (no, it raises the bar) | the harness's permission model |
| npx-mage-runs-the-published-release | note / rule | none. Two readers, one of them the ADR's own Example, disagree on a one-line rule versus a note | judgement |
| agy-commit-message-compliance-is-unreliable | hook / check | where the expected message lives (the prompt, in the kit) | the kit |
| point-in-time-research-stays-private | check / rule | which half: `docs/plans/` paths (mechanical) or "research" (semantic) | two guards in one note |

Thirteen of 41 rows. In eleven of them the deciding fact is not in the note.

## 2. Inputs a router needs that mage does not capture today

Named by the event or field that would carry them.

- **The guard inventory.** For every rung, what already exists: the pre-commit body (`src/git-hooks.ts:42`), the hook matchers (`settings.ts:80-132`), the 24 doctor checks, the CI jobs, the release tests, the ruleset. Ten of 41 rows resolved to "landed"; none of those notes said so. 0057 D13 names a `GuardInventory` and nothing builds it. This is the single input that changes the most rows.
- **A `guard_landed` event with the file:line of the artifact.** When a test, hook or check lands for a failure a note describes, nothing records it, so the note lives on. Ten notes in this corpus are guards that already landed. The event that retires them does not exist.
- **The decisions at routing time.** Five of 18 divergences came from the decisions changing between 09-03 and 09-10. A routing carries no `decisions_at:` stamp (a commit of `mage/decisions/`), so nobody can tell a stale routing from a fresh one.
- **The actor the note guards.** Claude in the harness (hooks and deny rules reach it), agy outside it (only AGENTS.md and CI reach it), the human (only a ruleset reaches them). Three notes changed rung on this alone. No field says who the failure was.
- **Which store the note belongs to.** Six notes are user-level and were never this repo's. `provenance.repo` says where the note was written, not where it applies. The `route-memories` note is the rule for this and it is itself misfiled.
- **`tool_attempt`.** 0052 D10 and 0059 D6 depend on it; it is not in `observe/types.ts`. Without it a hook guard's `prevented` count is zero by construction, so a hook can never be shown to fire and the ledger cannot say which rung was right.

## 3. Rows that need knowledge outside the note

A router that reads only the note body cannot see:

- `src/` (does the test, the hook, the check exist): #5, #6, #10, #13, #15, #21, #30, #31, #38, #14. Ten rows.
- An open PR or issue (is the guard in flight, is the trigger being retired): #13, #16, #23, #33, #34, #20, #29, #15. Eight rows, overlapping three with the above.
- The current decisions (is the trigger dead): #3, #17, #20, #29, #41, #32. Six rows.
- The kit or user settings (is the rule already there): #2, #7, #37. Three rows.

Union: 22 of 41 rows. A note-only router gets at most 19 rows on the note's own evidence, and those 19 are mostly the easy rungs (rule, delete).

## 4. Which rungs are cheap to judge and which are expensive

| rung | cost to judge | why | replication in this run |
|---|---|---|---|
| delete (trigger dead) | cheap when the decision that retired the trigger is named; otherwise expensive | needs `decisions/` at routing time | 4/5 |
| rule | cheap | "can it be one sentence a reader applies without judgement" is answerable from the note | 6/9 |
| check | medium | cheap to name, expensive to place: needs the CI and test inventory to say whether it exists | 7/11 |
| hook | expensive | needs the hook matcher table, the fail-open boundary and the actor; hook versus check is a placement question | 1/5 |
| impossible | expensive | needs the config surface (permissions, rulesets, schema) and often a code change that is really "fix the bug" | 1/1, but the baseline's 1 was the only obvious one |
| note | cheapest to say, most often wrong | it is the fallback; 7 of the baseline's 8 notes moved up on a second pass | 1/8 |

An automation should attempt `rule` and `delete` and refuse the rest. It should never emit `note` as a default: in this corpus `note` was the least stable answer and the one ADR-0051 most wants to empty.

## 5. What makes a router confidently wrong, not uncertain

Uncertainty is recoverable; the operator reads the doubt. These are the cases where the router would emit a clean answer with no doubt attached.

1. **The note says the fix is done.** Ten notes contain "now fixed", "as of 0.0.11 the bump is automated", "the scope bug is now fixed". A router reads that and emits `check, landed, delete`. It cannot tell a note that describes a landed fix from a note whose fix was described and then rotted (#13: the flatten hook is landed and dead; the note reads as fixed). Confident, wrong, and the failure it guards comes back.
2. **The note names a rung.** `notes-must-read-in-one-screen` says "prefer a check; #253 is that check". `context-mode` says "add the allow rule". A router that trusts the note's own routing is right here and would be wrong on `npx-mage`, where ADR-0051's Example names `note` and a one-line rule is cheaper. Self-routing is a strong prior with no error signal.
3. **The decisions moved.** A router run on 09-03 emitted `note` for `mature-kb` and `promote-folds` with full confidence and a precise trigger. On 09-10 both triggers are dead. Nothing in the note changed. The router's answer is stamped with no decisions version, so it looks current forever. This is the same failure as `soak-monitor` blind spot 2: a stale claim reads as current fact.
4. **Two guards in one note.** `dogfood-before-release` is a landed CI check and an un-automatable smoke rule. A router picks one half, emits it confidently, and the other half is silently unrouted. Both passes did exactly this, in opposite directions.
5. **The actor is assumed.** A router that reads "biome reformatted the file" emits a PreToolUse deny on `biome`. The actor was agy, which no PreToolUse reaches. The deny lands, fires zero times, and the ledger reports the guard as never needed.
6. **The vocabulary collision.** `rung` in `src/grooming/autonomy-ladder.ts` and `dashboard/html.ts:617` is the old scratch/notes/skills ladder. A router grepping for existing "rung" handling finds it and reports the ladder as built.

The common shape: every confident-wrong case comes from trusting a claim in the note about the world outside the note. The fix is not a smarter router. It is the guard inventory from section 2, so every "landed" claim is a `file:line` a reader can falsify with `sed`, and a `decisions_at:` stamp so every routing shows its age.
