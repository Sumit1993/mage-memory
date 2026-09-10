# Retrofit reality check: `trigger:`, `pointer:`, `skipped:` on three real notes

ADR-0051 says a note carries all three and `mage index` rejects one without them (#231 adds the check). No note has any of them today. Below, three notes my routing keeps as notes for now, with the fields written for real, then what the full retrofit costs and whether `skipped:` can be honest after the fact.

"Keeps" here means the note stays in `mage/notes/` until its higher-rung guard lands. Under my routing only one note is a rung-5 guard for good (#32). The other two are on a higher rung with the guard unmerged, so they sit in `notes/` and #231's check would reject them the day it lands.

## 1. replay-gate-methodology (rung: note)

```yaml
trigger: "before shipping or default-enabling a new narrowing rule over observe events (a digest filter, a lens, a scorer)"
pointer: "mage/decisions/0052-streams-and-the-observe-schema.md §Why; the corpus and harness are author-local at ~/ai-context/mage-prove-20260619/ and are not a source"
skipped:
  impossible: "a methodology for judging a mechanism has no config or deny form"
  check: "the gate is a pre-registered bar plus a judged run; the bar could be a test but the judging cannot"
  hook: "no tool call marks 'about to ship a narrowing rule'"
  rule: "one line cannot carry the bar, the control corpus and the three calibration traps; a rule would say 'run the replay gate' and point here anyway"
```

What was hard: `pointer:` wants a source and the only real one is a directory under `~/ai-context/`, which the house rules define as not a source. The honest pointer is a decision's Why section, which is a summary, not the evidence. The note's `sources:` already lists 0052 three times, which is the same problem showing through the old schema.

## 2. harness-memory-layer-rewrites-mage-frontmatter (rung: hook, guard dead, PR #259)

```yaml
trigger: "an Edit on a file under mage/ fails with 'string not found' against text you just read, or `grep -rl 'node_type: memory' mage/` returns a tracked file"
pointer: "src/adapters/claude-code/flatten.ts; src/adapters/claude-code/cc-note.ts:107 (isCcShaped); issue #200; PR #259"
skipped:
  impossible: "pointing autoMemoryDirectory away from mage/ removes the rewrite but breaks 0051's one-store design"
  check: "`mage index` rejecting `name: \"\"` frontmatter is a backstop, not a fix; it fires at index time, after the damage"
  hook: "NOT skipped. The PostToolUse flatten at settings.ts:116 is the rung. It is landed and dead (OUT-contradictions B7). This note exists because the hook does not work."
  rule: "'author KB files via shell' is the workaround the note already gives; it is a rule that exists only because the hook is broken"
```

What was hard: `skipped:` has no value for "the right rung exists and is broken". The schema assumes a note sits below rungs that were ruled out, not below a rung that was chosen and failed. This is the common case in this corpus (ten "landed" rows in OUT-routing.md, one of them dead). A `skipped:` map with four keys cannot say "hook: landed, dead, #200".

## 3. npx-mage-runs-the-published-release (rung: rule; ADR-0051's own example)

```yaml
trigger: "deciding which mage binary a verify command, a hook, or an index regeneration runs"
pointer: "package.json bin; `readlink -f $(which mage)`; src/git-hooks.ts:44 (the pre-commit resolves `mage` from PATH)"
skipped:
  impossible: "npx resolution and npm link are the host's behaviour; no config in this repo changes them"
  check: "a doctor check printing the resolved binary and warning when it is not this tree is cheap (src/commands/doctor.ts:153 already checks npx exists); not written yet"
  hook: "a PreToolUse on Bash matching `npx mage` would deny a legitimate command when the published binary is what you want"
  rule: "NOT skipped. One AGENTS.md line: 'Verify local changes with `pnpm build && node dist/cli.js`, never `npx mage`.' Not written yet. This note is the rule's holding pattern."
```

What was hard: ADR-0051's Example routes this note to rung 5 with "four skipped rungs with reasons". Writing the four reasons for real, the rule rung does not skip. The ADR's own worked example is a routing I disagree with, and the disagreement only showed up when I had to fill the field.

## What retrofitting all survivors costs

Survivors under my routing: 41 minus 7 deletes minus 10 rows whose guard is landed (delete on confirmation) leaves 24 notes that need the three fields, plus the two new ones which already read like the schema wants (`Why` and `How to apply`) but lack the keys.

Per note, the work is not typing three lines. It is:

- `trigger:` 2 minutes. Most notes already say when they apply, in a "How to apply" or "The tell" paragraph. Lift it.
- `pointer:` 5 minutes when the source is in `src/` (about half the corpus); 15 minutes and a judgement call when the source is an issue, a PR, a session id, or `~/ai-context/`. Twelve notes cite `cc-session:` ids, which are not sources anyone can open.
- `skipped:` this is the routing itself. Doing it honestly for one note took me the reading of the note, a grep of `src/` for an existing test, and the attach-point inventory (one Sonnet run, 32 tool calls). Ten minutes per note with the inventory in hand, forty without it.

Total: roughly four hours of one careful pass with the inventory pre-built, which is what this run was. Done by the seat between other work, more like two days of drift. A Sonnet worker can lift `trigger:` and `pointer:` from the body; it cannot write `skipped:` (see OUT-orchestration.md for why).

Sequencing fact that matters more than the hours: the day #231 merges, `mage index` rejects all 41 notes and `MEMORY.md` cannot regenerate. The retrofit or the deletes must land before #231, or #231 must grandfather notes without the fields and warn. Either is fine; landing #231 first is not.

## Can `skipped:` be honest after the fact?

Partly, and the part that is honest is the cheap part.

Honest after the fact: the rungs that are plainly not applicable ("no tool call to intercept", "no config removes this"). These read the same whenever they are written, because they are facts about the failure's shape.

Not honest after the fact: the rung that was *close*. For #24 the check rung is close (a doctor check) and the rule rung is closer, and which one you write as "skipped" depends on which one you have already decided to build. Written post hoc, `skipped:` is a justification of the routing, not a record of it. Every `skipped:` block I wrote above was written after I had chosen the rung, and I could feel the reasons bending to fit.

At capture time the writer has one thing a retrofitter lacks: the failure is fresh and they know what would have stopped it. They lack the other thing: the attach-point inventory. Nobody at capture time knows that `settings.ts:109` already matches `Write|Edit` or that `doctor.ts:153` already checks npx. So a capture-time `skipped:` is honest about the failure and wrong about the repo.

Ruling on whether the field is worth building: yes, with two changes to the schema the ADR states.

1. `skipped:` records what was *checked*, not what was ruled out. A value is one of `n/a`, `not built: <one line>`, `landed: <file:line>`, `landed, broken: <issue>`. The four-keys-with-prose form invites rationalization; the enum form invites a grep.
2. The hook that returns the ladder also returns the attach-point inventory for this repo (the pre-commit body, the hook matchers, the doctor checks, the CI jobs). Without it, the agent writing `skipped:` at capture time is guessing about a codebase it has not surveyed, and the field records the guess. With it, `skipped: check: landed: src/staged-scan.test.ts:41` is a claim the next reader can falsify with `sed`.

Without change 2, `skipped:` is prose that makes a note look routed. That is worse than no field.
