# mage direction assessment, 2026-09-03

Inputs: the 2026-09-02 roadmap handoff, the 2026-09-01 recall audits, Theo's video
"Turn off Claude Code's Memory" (full transcript read), this repo's KB and commit history.
Nothing here is applied. Questions for the operator are at the end.

## 1. What the previous agent actually left

Not a validation. An order of work: a tracking-issue draft (#181, #182, release 0.0.18,
repoint the soak monitor, #201 as an ADR, #202, then campaign groups), one comment for #201,
two note edits, one new gotcha note. It assumed the answer to "are we on the right track" was
yes and planned the next quarter of the same work.

The real finding sits one file back, in `mage-recall-run-handoff.md` (2026-09-01):

- Recall is the problem, not capture. In this repo 3 of 126 closed chapters read any note.
  The best-read note reached 3 chapters against a graduate threshold of 5.
- prismalens, correctly wired the whole time: 18 note reads in 30 sessions. It applied two
  fact-titled notes unprompted, and in the same period wrote a changeset naming four packages
  the config ignores while the roster line with the right answer sat in its context.
- sreforge read zero notes for a month because its grant named a hub that did not exist.
  Nothing surfaced it.
- The 0.1.0 gate is "a keep-rate ledger from real use, read by a human". Nobody has read it
  in 33 days. The monitor pointed at two renamed hubs and reported both units as healthy.

## 2. Theo's argument, and mage against each claim

1. Code is truth. A separate memory goes stale and then misleads.
   mage's charter agrees (pointers not copies, `last_reviewed`, `stale-suspect`). But look at
   what the store holds: 24 of 39 notes are gotchas, and most of those are about the tooling
   around mage (soak monitor, agy, the harness memory layer, context-mode, release-please).
   The knowledge base is mostly knowledge about building the knowledge base.
2. His audit: 45 memories, 26 never read, writes outnumber reads 3 to 1.
   mage's own audit two days earlier: 79 of 86 notes never read. mage reproduced Theo's
   number on itself, worse, and the response was a tracking issue.
3. Fancy context systems lose to bash plus tools. Cursor abandoned its graph.
   mage has 47 ADRs, 1511 tests, hubs, machine bindings, a soak monitor, review lanes, a
   telemetry plan, a distill/promote/graduate pipeline. Since June: 303 commits here against
   224 in prismalens and 75 in sreforge. Three quarters of recent `ci:` commits were shared
   review-lane upkeep. The tool has more engineering in it than the work it serves.
4. What works is a hand-written AGENTS.md: what the thing is, values, direction, glossary,
   taste, a short "stop doing this" list.
   Your `claude-kit/dotfiles/AGENTS.md` is exactly that, and it is the part of your setup
   that visibly steers agents. It is not mage.
5. Lauren's ladder: eliminate the class by architecture, then a lint or CI check, then a
   skill or rule as a fallback, then a human. Memory is not on the ladder.
   mage lives on rung 3 and automates rung 3. Today's case: the context-mode WebFetch
   redirect. A gotcha note about the sibling failure (`ctx_execute_file` outside the project
   root) exists, its roster line was in my context, and I still called WebFetch and got
   redirected. You say hundreds of sessions have hit it. A note cannot fix a harness
   behaviour. A deny rule on WebFetch, or removing the redirect hook, fixes it once. That is
   rung 1, and mage never routed it there.

## 3. Where the alignment is real, and worth keeping whatever you decide

- Human ratification. ADR-0046 (branch plus PR is the only way knowledge lands), the autonomy
  ladder, no silent writes on a default branch. Theo's rage is at silent auto-memory; mage's
  gates are the direct counter to it.
- Decisions. ADRs have a done-state, get authored deliberately, and are the one genre Theo
  would keep. 47 is a lot, but the genre is right.
- Pointers, never copies.
- The fact-title finding: a roster line that states a fact gets acted on; one that names a
  topic does not. That is a real, cheap, measured lever.

## 4. Where I think it went off

The goal drifted from "an agent stops repeating my mistakes" to "capture and grooming are
autonomous and measurable". Soak units, keep-rate ledgers, distill, promote, graduate,
telemetry: all of it measures and automates the write side of a store that is not read.
Meanwhile the one fix the audit ranked first (a mid-task trigger, #201) is still an unwritten
ADR, and today's failure shows even that fix aims one rung too low.

Auto-memory is also not off here. `autoMemoryDirectory` points into `mage/`, so the exact
mechanism Theo turned off is live and writing into the KB (see the note on the harness layer
rewriting frontmatter). Theo's switch and mage's capture are two separate switches, and a
third is the plugin itself.

## 5. Options, not yet a recommendation

A. Turn it off. Disable auto-memory, stop capture, archive `mage/notes/`, keep
   `mage/decisions/` and AGENTS.md. Lose the two or three notes that demonstrably fired.
B. Shrink to what the evidence supports. Keep decisions and a hand-curated roster of at most
   15 fact-stating lines. Every gotcha that can be a check becomes a check and leaves the
   roster. Kill soak, distill, promote, graduate, telemetry. mage becomes an ADR and roster
   tool with a redaction gate.
C. Realign and continue. Replace the 0.1.0 gate ("keep-rate") with "a note prevented a
   repeat, N times, measured", build the mid-task trigger, and accept another quarter of
   infrastructure on an unproven premise.

Which one is right depends on the answers below. I will not pick without them.

## 6. Questions

1. Who is mage for? It is on npm at 0.0.17 with a docs site and a marketplace entry. Are
   there external users, or is it your own tool? "It doesn't work for me" is fatal for a
   personal tool and only a data point for a product.
2. Name one moment mage saved you, that you felt, not one the audit found. If you cannot,
   that is the answer to A versus the rest.
3. "Turn off memory everywhere" means which switch: Claude Code auto-memory, mage capture
   hooks, or the whole plugin? They are separate.
4. Are prismalens and sreforge the real products and mage the tool? Commit counts say mage
   got the most attention since June. Was that the plan?
5. The context-mode fetch redirect: fix it now at the config layer, independent of the big
   decision? It is small and it tests the rung-1 claim in section 2.
6. You said the last session recommended things you agreed with. The handoff only holds an
   order of work. What was the recommendation you liked? I do not want to rebuild it wrong.

## 7. Data points gathered 2026-09-03 (read-only, after the conversation)

Operator answers that shaped the direction: automation is the attachment, not the format.
mage becomes the loop that turns repeated failures into hooks, lints, rules and skills, landed
by PR, with a fire counter. Topology = wherever each harness lets config live. Telemetry gets
its own plan, phone-home included. Notes are a queue: admitted only with a named trigger, and
expected to leave (promoted to a check, or deleted).

### Repeat-failure census (observe logs, `ok`/`error_summary` on tool_use)

| unit | tool calls | failed | sessions | top repeats |
| --- | --- | --- | --- | --- |
| mage-memory | 22,630 | 351 (1.5%) | 66 | Read on missing path 34 ev / 5 sess; EISDIR 21 / 2; mage's own StructuredOutput capture schema mismatch 35 ev; npm auto-install-peers warn 9 / 4; ERR_MODULE_NOT_FOUND 12 / 4 |
| prismalens | 1,521 | 38 | 31 | nothing above 3 events |
| sreforge | 1,223 | 11 | 8 | nothing repeated |

Finding: the log records crashes, not mistakes. The prismalens changeset error (four ignored
packages) was a successful tool call. User corrections in prompts: 9 of 934, mostly "stop".
So the signal the product needs is not in mage's log today.

Where it is: review findings. PRs with bot review comments since 2026-07-01: mage-memory 20
(claude) / 93 (coderabbit); prismalens 67 / 190. sreforge rate-limited. mage has no feed from
the review lane. That feed is the seam with gh-workflows.

### Generated skills

`mage skills --metrics --json`: one skill, `mage-wing-mage`, hand-written, 4 loads. No
generated skill was ever minted. The graduate path has never run to completion.

### Fetch redirect, evidence

- Observe log: 0 WebFetch events in any unit. The PreToolUse redirect fires before the
  PostToolUse observer, so mage never saw the failure it is supposed to catch.
- Harness transcripts since 2026-08-01: 754. Sessions with the WebFetch redirect: 8, 24 events.
  All context-mode interceptions (file access blocked 99, redirect 24, search flood 10):
  133 events across 43 sessions, 6 percent of sessions.
- "Hundreds of sessions" was the feeling. 43 is the count. Both say the same thing: a repeat
  worth one config line. But without a counter, the feeling is all anyone had.

### What this changes in the plan

1. Instrument first. The observe hook must record blocked and redirected calls, or the
   product cannot see its own best example.
2. The failure signal has three sources, and tool errors are the weakest: review findings
   (largest), user corrections (thin but exact), tool errors (crashes only). The census script
   for review findings does not exist yet.
3. "Reuse the graduate path" is weaker than stated. It exists in code and has never produced
   a skill. Treat it as a design to borrow from, not a working pipeline.

## 8. The 39 notes routed through the ladder (agy on Sonnet 4.6, 2026-09-03)

Full table: `~/ai-context/mage-notes-ladder-routing-2026-09-03.md`.

| rung | count |
| --- | --- |
| impossible | 1 |
| check | 11 |
| hook | 5 |
| rule | 9 |
| note | 8 |
| delete | 5 |

17 of 39 become programs (impossible, check, hook). 9 become one-line rules. 5 die, including
the charter and context.md, which are docs rather than memory. 8 stay notes with a named
trigger, but 5 of those 8 are about soak, promote, keep-rate or the nudge internals, which the
redirection removes. Real survivors under the new direction: about 3 (which binary am I
running, where a CLI integration test goes, how to migrate external notes).

Read: the store was roughly 80 percent enforcement debt and docs, 10 percent memory.

Caveats: some hook proposals in the table are heavier than the lesson deserves (a commit-msg
diff against an expected message, an emoji scanner on release notes). Treat the rung as the
finding and the mechanism as a first draft.
