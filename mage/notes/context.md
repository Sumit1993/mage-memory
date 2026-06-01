---
type: reference
tags: [mage/design]
created: "2026-05-29"
updated: "2026-06-01"
last_reviewed: "2026-06-01"
status: active
provenance:
  repo: mage-memory
  commit: 1ec8225
keywords: [knowledge-base, note, wing, room, index, tag, moc, skill, work-unit, artifact, note-types, glossary]
---

# mage — context & glossary

mage is a portable, file-based, self-maintaining knowledge base for software systems — durable git-backed **notes** that resist accidental loss, navigable as an Obsidian **graph**, usable by any AI coding agent. It exists because project knowledge (specs, decisions, how services connect, how to call them) scatters across in-repo/out-of-repo dirs and gets cleaned up or lost; mage gives it one durable, discoverable, portable home. mage stores **insight, procedure, and pointers** — how to act and where to look, so you do it faster next time — *not* copies of sources that already exist.

## Language

### Structure

**knowledge base**:
The whole memory for a system — the graph of notes plus its index. One per repo (in-repo) or one hub spanning many repos (the system "brain").
_Avoid_: docs, wiki, vault (as the product noun)

**Note**:
The atomic unit — one verbatim markdown file about one thing, with frontmatter (type, tags, provenance, lifecycle) and portable links to related notes.
_Avoid_: drawer, doc, memory (as a noun), entry

**Wing**:
The top-level scope a note belongs to — typically a project, repo, service, or person. Realized as a nested tag (`#wing/<name>`) and/or a MOC, **not** a mandatory folder.
_Avoid_: section, bucket

**Room**:
A topic within a wing — the second scoping level. Realized as a nested tag (`#wing/room`) and/or a topic MOC.
_Avoid_: category, folder

**Index**:
The compact, always-available pointer layer — one line per note (topic · keywords · → link), generated from the notes. An agent loads this to know what exists and decide what to open. (The "closet" of the memory palace.)
_Avoid_: closet, manifest, catalog

**Tag**:
A `#wing/room`-style nested label for emergent grouping. Tags carry the hierarchy; folders are avoided until a cluster is large and stable.

**MOC** (Map of Content):
A note whose body links a cluster of related notes — an emergent, optional navigation hub, added when a wing/room earns enough notes to deserve a map.

**Skill**:
The procedural/auto-loaded counterpart to a Note — a capability the agent loads when relevant (portable across skill-capable agents), carrying procedures/playbooks/gotchas and able to run scripts. mage keeps lifecycle skills (`learn`, `dream`, awareness) plus **one skill per Wing** (its auto-loaded entry point). Notes are recalled by navigation (pull); skills are pushed (auto-loaded). _Avoid_: command (as a synonym)

### Work & artifacts

**Work unit**:
A task-scoped container (`work/<slug>/`, open `type`: spec, investigation, incident, spike, …) holding the working notes for one piece of work — the *lab notebook* where work happens before durable knowledge is distilled into notes. Tracked in git; its `artifacts/` are not.
_Avoid_: ticket, task-folder

**Artifact**:
A generated or downloaded working material (PDF, profile, query output, repro script) in a work unit's `artifacts/`. Durable on disk — **never `/tmp`** — and citable from notes as evidence. An artifact is raw material; a note is distilled knowledge.
_Avoid_: attachment, temp file

### Note types (`type` frontmatter — a *suggested, open* vocabulary, never enforced)

**Spec / Plan / Tasks**: greenfield intent authored forward (the SDD path).
**Decision**: an ADR — a choice and why, and what it rules out.
**Principle**: a governing constraint (the constitution).
**Interface**: how to *use* a service/API — endpoints, useful params, auth, gotchas (verbatim).
**Tooling**: how a repo is wired to external tools — VCS, CI, security analysis, deploy, monitoring (a repo↔tool relationship).
**Topology**: architecture(s), deployment methods, environments across the system.
**Relationship**: a *governed* coupling between wings/services/repos worth tracking — carries `breaks_on`, contract-anchors, owners, review cadence. Lightweight ties are just links (edges); a Relationship note is a reified node.
**Playbook**: how to do X faster — a reusable procedure.
**Gotcha**: what *not* to do and why (e.g., a CLI flag that fails) — surfaced to prevent the repeat mistake.
**Pointer / Reference**: where a canonical source lives and when to go there (`sources:` — URL · ticket · `file:line`). A wayfinding note, never a copy.
**Trail**: the path that connected sources into understanding (ticket → PR → code → doc).
_Avoid_: cross-ref (as a directory)

**Source**:
A pointer to canonical external knowledge (URL, ticket, `file:line`) carried in a note's `sources:` — referenced, never copied. Snapshot to `artifacts/` only when the source itself is fragile.

### Lifecycle

**Remember / Recall**: write to / read from the knowledge base.
**Learn**: capture a new note from work in progress (the brownfield path) — draft → overlap-check → human-confirm → promote.
**Dream**: the maintenance pass that keeps memory latest+correct — flags staleness, supersedes contradictions, consolidates thin notes, archives, and re-verifies notes against changed source. Nothing is hard-deleted (git history + `archive/`).
**Promote**: move a draft from scratch into a durable note, gated by independent validation.
**Supersede**: replace a note's claim with a newer one, keeping the old linked + marked (never a silent overwrite).

## Flagged ambiguities

- **Wing vs Project**: in a multi-repo hub a wing usually *is* a project/repo — but a wing can also be a non-repo scope (a person, an external service). Wing = the memory-scope; Project = the registry entry. Often coincide, not always.
- **"Memory" the quality vs the noun**: knowledge has *durable memory*; we don't call a note "a memory."

## Example dialogue

**Dev:** I just figured out the payments service double-bills unless every charge carries an idempotency key.

**mage:** That's an **Interface** note about payments. Which **wing** — is `payments` its own wing, or a room under `billing`?

**Dev:** Room under `billing`. And it's tied to how the `web` repo calls it.

**mage:** Then the idempotency fact is an Interface note tagged `#billing/payments`, and the `web → payments` coupling is a **Relationship** note with `breaks_on: charge-schema, missing idempotency header`. I'll check the **index** for existing payments notes first, draft both, and ask you to confirm before they're promoted. The relationship becomes a graph edge between the `web` and `billing` wings.

## Relations

- defines_terms_for [mage roadmap](roadmap.md)
- defines_terms_for [mage v0.1 implementation plan](plan-v0.1.md)
- see_also [ADR-0004 — capture insight, not copies](../decisions/0004-capture-insight-not-copies.md)
