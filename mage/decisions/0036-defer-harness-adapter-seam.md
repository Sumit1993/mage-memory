---
type: decision
tags:
  - mage/decisions
created: "2026-06-28"
updated: 2026-06-28
last_reviewed: 2026-06-28
status: accepted
provenance:
  repo: mage-memory
  work: adr-0036-defer-harness-adapter-seam
sources:
  - decisions/0032-capture-redirect-native-memory.md
  - decisions/0035-decouple-harness-memory-from-notes.md
  - decisions/0009-no-runtime-automation-rides-host-hooks.md
  - src/adapters/claude-code/cc-note.ts
  - src/dream.ts
  - cc-session:3d5696e5-20a5-44f2-9c17-b92d71da8528
keywords:
  - harness-adapter
  - seam
  - defer
  - hypothetical-seam
  - one-adapter
  - cc-note
  - neutral-core
  - multi-harness
  - premature-abstraction
  - second-harness
  - capture
---

# 0036 — Defer the `HarnessAdapter` seam until a second harness exists; consolidate CC note-shape into one named module now

> **Status: accepted.** Output of a 2026-06-28 architecture review of PR #45 (the
> `/improve-codebase-architecture` grill). Records a deliberate *non*-decision — what we are
> NOT building yet — so a future review does not re-suggest it. Implements the deepening this
> grill DID accept (the `cc-note` adapter; see [[mage-is-durable-memory]] and
> [ADR-0035](0035-decouple-harness-memory-from-notes.md)).

## Context

ADR-0035 §6 names a future shape: "a new harness = teach the scanner its shape, emit its recall
index, and (optionally) add a PostToolUse-flatten." Read as a standing instruction, that invites a
`HarnessAdapter` interface (`isShaped?` / `recover` / `recall-emit`) the neutral core depends on,
with Claude Code registered behind it as one adapter of many.

The PR #45 architecture review surfaced the friction that would *seem* to justify building it now:

- **The neutral core reached into the CC adapter.** `dream.ts` imported the CC capture predicate
  (`isCaptureInboxNote`) straight from `inbox.ts`, and `scan.ts` carried its own private
  CC-tolerant read — so harness-specific knowledge had leaked into harness-neutral modules.
- **CC note-shape knowledge was smeared** across `scan.ts`, `flatten.ts`, `inbox.ts`, and the old
  `schema-map.ts` — the same "recover mage's fields from a restamped note" rule written three times.

But there is **exactly one harness adapter today** (`src/adapters/claude-code/`). Per the project's
architecture vocabulary ([CONTEXT.md](../../CONTEXT.md)) and the deepening principle it follows:
**one adapter is a *hypothetical* seam; two adapters make it real.** Building a `HarnessAdapter`
abstraction for a single concrete implementation is speculative generality — an interface designed
against one example tends to encode that example's accidents and pay abstraction cost for leverage
that does not yet exist.

## Decision

1. **Do NOT build a `HarnessAdapter` interface yet.** It is deferred until a *second* harness
   (e.g. an OpenAI/Codex- or Cursor-style native-memory adapter) actually lands. At that point the
   two concrete adapters reveal the genuinely shared interface, and the seam is extracted from two
   examples, not guessed from one. This honors [ADR-0009](0009-no-runtime-automation-rides-host-hooks.md)'s
   per-harness-adapter posture without prematurely reifying it.

2. **Consolidate CC note-shape into one named module now** — `src/adapters/claude-code/cc-note.ts`
   (grown from `schema-map.ts`). It owns the CC discriminator predicate (`isCcShaped`), the
   preservation recovery (`recoverCcFrontmatter`), the native→mage vocab map, and the capture-identity
   key. This is the deepening the review accepted: one home for "what a CC note is and how to read
   mage out of it," so the rule changes in one place.

3. **Keep the harness-neutral read in the neutral core.** The generic "surface nested `metadata.*`
   to the top, top-level wins" rule lives in `note.ts` (`effectiveFrontmatter`), with **no** harness
   vocab — so `scan`/`dream`/`groom` stay vocab-free (the ADR-0035 §6 neutral-core posture). The
   `cc-note` adapter layers CC vocab on top of it.

4. **The remaining core→adapter edge is accepted, and pointed at the one named place.** `dream.ts`
   needs to skip a transiently-restamped note; that "is this currently a harness-restamped capture?"
   knowledge is genuinely CC-specific today, so `dream` imports `isCcShaped` from `cc-note.ts` (the
   single named module) rather than reaching into `inbox.ts`. The edge is a *deferred* coupling, not
   a permanent one: when the second harness arrives, this import becomes the first caller of the
   neutral `HarnessAdapter` seam.

## Revisit trigger

Reopen this ADR — and build the `HarnessAdapter` interface — when **a second harness adapter is
added**. Two adapters make the seam real; that is the signal, not a calendar date or a refactor urge.
Until then, treat "we should add a `HarnessAdapter` abstraction" as already-considered-and-deferred.

## Consequences

- No speculative abstraction: the adapter layer stays a concrete `cc-note` module, cheap to read and
  change, until a real second example justifies the interface.
- The neutral core (`scan`/`dream`/`note`) depends on the *named* CC adapter at exactly one edge
  (`dream → cc-note.isCcShaped`), down from a scattered set of reach-ins. That edge is the documented
  seed of the future seam.
- CC note-shape duplication is gone: recovery lives once in `recoverCcFrontmatter`, the neutral read
  once in `effectiveFrontmatter`, the capture-identity key once in `cc-note`.

## Relations

- builds_on [ADR-0035 — notes are memories; embrace at rest, normalize at the durable boundary](0035-decouple-harness-memory-from-notes.md) (§6 names the future harness seam this ADR scopes)
- constrained_by [ADR-0009 — no runtime; per-harness adapters](0009-no-runtime-automation-rides-host-hooks.md)
- relates_to [ADR-0032 — capture-redirect into the git-durable pipeline](0032-capture-redirect-native-memory.md) (the CC adapter this consolidates)
