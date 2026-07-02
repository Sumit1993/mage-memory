---
type: decision
tags:
  - mage/decisions
created: "2026-06-28"
updated: 2026-07-01
last_reviewed: 2026-07-01
status: accepted
provenance:
  repo: mage-memory
  work: adr-0035-notes-are-memories-unified-store
sources:
  - decisions/0032-capture-redirect-native-memory.md
  - decisions/0033-recall-import-bounded-index.md
  - decisions/0034-adopt-preexisting-knowledge.md
  - decisions/0005-one-canonical-memory-others-are-feeders.md
  - decisions/0004-capture-insight-not-copies.md
  - decisions/0008-visible-mage-dir-for-obsidian.md
  - cc-session:3c5c8534-8611-4d9d-9087-9975da48dd44
keywords:
  - notes-are-memories
  - unified-store
  - harness-format
  - embrace-at-rest
  - normalize-at-commit
  - posttooluse-flatten
  - groom-as-curation
  - scanner-tolerance
  - hard-earned-knowledge
  - write-update-recall
  - future-proof
  - restamp
---

# 0035 — Notes are memories: one unified store; embrace the harness format at rest, normalize at the durable boundary

> **Status: accepted (ratified 2026-07-01 — impl on `main`, riding 0.0.12).** Amends [ADR-0032](0032-capture-redirect-native-memory.md). Output of the
> 2026-06-28 comparative study (18 harnesses + memory systems) and a grill that surfaced the
> load-bearing insight this ADR turns on: **a mage note and an agent memory are the same thing.**
> See the charter note [[mage-is-durable-memory]].

## Context

ADR-0032 unified mage with Claude Code's auto-memory by pointing `autoMemoryDirectory` at the KB —
the right instinct — but then tried to win the frontmatter **format** at write-time (Gate-0 maps CC's
shape to mage's flat schema). Dogfooding proved that futile: CC re-normalizes a memory file's
frontmatter *after* the hook, restamps any file in its memory directory the moment an agent writes it,
and — observed live — can even **empty** an authored file mid-write. This hit authored notes
(`decisions/0034`, `notes/future-thoughts`, and, fittingly, this ADR's own drafts). We first mistook it
for an attack and proposed *separating* the stores; a grill corrected the framing.

The load-bearing insight: **a note IS a memory.** mage notes — insight, procedure, gotchas, decisions,
pointers ([ADR-0004](0004-capture-insight-not-copies.md)) — are exactly what an agent "remembers." The
harness cannot tell a note from a memory because there is no difference (it stamped *this very ADR*
`node_type: memory`). So the agent's native memory and mage's notes are not two stores to bridge; they
are **one** store. Separating them would contradict both that insight and
[ADR-0005](0005-one-canonical-memory-others-are-feeders.md) (exactly one canonical durable memory).

Verified facts (unchanged): the harness owns the format of files in its memory dir and re-normalizes
them post-write (we cannot win at write-time); the memory tool is directory-scoped; there is no shared
cross-harness memory-frontmatter standard.

## Decision

1. **One unified store — notes are memories.** Keep ADR-0032's unification: the agent's memory store
   **is** mage's notes (`autoMemoryDirectory` resolves to the KB). This is not a feeder into a separate
   canonical store ([ADR-0005](0005-one-canonical-memory-others-are-feeders.md) clarified) — it **is**
   the one canonical store, made durable. mage's value is the four things native memory lacks:
   **durability** (git), **curation** (groom), **portability** (one neutral schema), **sharing** (team).

2. **Stop fighting the format at write-time.** Retire Gate-0's frontmatter-mapping — CC overrides it
   post-write regardless. Let the harness keep files in its own shape *while it owns them in the
   working tree*. Gate-0 narrows to its one irreplaceable job: **scrub secrets before they touch disk.**

3. **Normalize at the durable boundary, in two layers.**
   - **Primary — PostToolUse flatten (keeps the working tree clean):** the commandeer PostToolUse hook
     (already wired on `Write|Edit`) flattens a restamped note's frontmatter back to mage's flat schema
     immediately after the write. (Gated on a spike confirming the restamp lands *before* PostToolUse;
     if it lands later/async — as observed — this falls through to the backstop.)
   - **Backstop — commit-time flatten (git is always neutral):** a pre-commit step (beside the Gate-2
     redaction hook) flattens any harness-shaped frontmatter on a *tracked* note, guaranteeing the
     durable, shared layer is neutral no matter what slipped through.
   - **The scanner tolerates both shapes** (reads nested `metadata.*` as a fallback) so `index`/`dream`/
     `groom` work even on a transiently-restamped note.

4. **Groom is curation-maintenance, not a write-time gate.** Over the one store, `groom` dedupes,
   links, assigns wings, and enforces *never-a-copy* ([ADR-0004](0004-capture-insight-not-copies.md)) —
   periodically / at commit, not as a tollbooth in front of every memory write.

5. **Write / Update / Recall are native operations on the one store.**
   - **Write (new knowledge):** the agent remembers X = writes/updates a note. One act — no
     capture→inbox→note round-trip for the agent's *own* memories, because they already *are* notes.
   - **Update (existing knowledge):** edits the note (its memory) in place. Native. Restamp →
     PostToolUse-flatten (or commit-flatten) → neutral. (This is the path ADR-0032's write-time fight broke.)
   - **Recall:** the harness auto-loads the index mage emits (`MEMORY.md` / the `@import` of `INDEX.md`,
     [ADR-0033](0033-recall-import-bounded-index.md)) and reads notes natively.

6. **Neutral core = the lingua franca; per-harness specificity = format-tolerance + recall-emit only.**
   Committed notes stay flat and Obsidian/Dataview/grep-readable ([ADR-0008](0008-visible-mage-dir-for-obsidian.md)) —
   the shared layer across mixed harnesses and teammates. A new harness = teach the scanner its shape,
   emit its recall index, and (optionally) add a PostToolUse-flatten; **the notes never change**. If a
   future harness needs mage *inside* a structured store, the namespaced `mage:` key is the portable
   way in (the one extension primitive shared across mem0/Letta/Zep/LangMem and ignore-unknown-keys
   rule engines).

## Why this is future-proof

Safety does **not** depend on harnesses being inert (most are today — but Anthropic and OpenAI lead,
and others follow toward structured, file-rewriting memory). It rests on two structural invariants that
hold *regardless of how aggressive harness memory becomes*: (a) the durable layer is normalized at the
git boundary, so it is always neutral; (b) a per-harness PostToolUse-flatten keeps the working tree
neutral wherever the timing permits. The more the industry converges on per-harness structured memory,
the **more** valuable one neutral, durable, shared store + thin adapters becomes — it is the only layer
that stays portable across a team on mixed harnesses and across one person using several.

## Gate

- **Yield** — the crown of ADR-0030/0032/0034: does the loop produce useful, durable, *portable*
  notes? **KILL** if normalization mangles legitimate content, or if the scanner's dual-format
  tolerance proves unreliable.
- **First proof (a spike):** confirm whether CC's restamp lands before or after PostToolUse (decides
  whether PostToolUse-flatten is viable as primary); then confirm a note survives edit + session
  boundary and ends neutral via PostToolUse and/or commit.

## Consequences

- Amends ADR-0032: **keeps** unification, **replaces** "fight the format at write-time" with "embrace
  at rest + normalize at the durable boundary." Supersedes the earlier separation framing.
- Gate-0 narrows to secret-scrub only (no longer a frontmatter-mapper).
- New machinery: PostToolUse-flatten, commit-time flatten, scanner dual-format tolerance.
- Reaffirms and sharpens ADR-0005 (the harness store is not a rival/feeder — it is the one store, made
  durable); the charter note [[mage-is-durable-memory]] states the thesis.

## Open questions

- **PostToolUse timing** — does the restamp complete before PostToolUse fires? (the spike). Live
  evidence of an *async* restamp/empty suggests commit-flatten may have to be the real guarantee.
- **Do we need both flattens, or does one suffice?** (commit-flatten is the guarantee; PostToolUse is
  the working-tree-clean optimization).
- **Recall twin: committed or regenerated?** (`MEMORY.md` machine-local vs. the committed `INDEX.md`
  `@import` floor as the shared recall).

## Relations

- amends [ADR-0032 — capture-redirect into the git-durable pipeline](0032-capture-redirect-native-memory.md) (keeps unification; drops the write-time format fight)
- reaffirms [ADR-0005 — one canonical memory, others are feeders](0005-one-canonical-memory-others-are-feeders.md) (the harness store is the one store made durable, not a feeder into a separate one)
- builds_on [ADR-0004 — capture insight, procedure, pointers — not copies](0004-capture-insight-not-copies.md) (what makes a memory worth keeping; groom enforces it)
- companion [ADR-0033 — recall: `@import` the bounded index](0033-recall-import-bounded-index.md)
- relates [ADR-0034 — adopt: onboarding pre-existing knowledge](0034-adopt-preexisting-knowledge.md) (adopt = folding pre-existing memories into the one store)
- grounded_in [ADR-0008 — a visible `mage/` dir](0008-visible-mage-dir-for-obsidian.md)
