---
type: decision
tags: [mage/decisions]
created: "2026-06-02"
updated: "2026-06-02"
last_reviewed: "2026-06-02"
status: active
provenance:
  repo: mage-memory
  work: hub-indexing-grill
sources:
  - src/scan.ts
  - src/commands/index-cmd.ts
  - src/dream.ts
---

# 0011 — A hub is one vault; the scanner recurses; projects are wings

Two real hubs had their project notes invisible to the hub index: **sreforge-memory** showed **0 of 18** notes, **prismalens-docs-hub** **5 of 79+**. Root cause: the scanner (`src/scan.ts`) is **allow-list** — it walks only `notes/`, `decisions/`, `work/` at one resolved docs root and explicitly skips `projects/`. That contradicts mage's own principle ([CONVENTIONS §4](../../CONVENTIONS.md): "folders are conventions") and split the product: the registry (`metadata.json` / `list` / `verify`) knew projects existed, but `index` / `dream` / `skills` refused to look inside them. The per-project `metadata.json` anchor added as a stopgap (see [field notes](../notes/migration-field-notes.md)) was the smell. A grill-with-docs session (2026-06-02) resolved the design.

## Decision

1. **A hub is one Obsidian vault.** `projects/<name>/` are sub-scopes *within* the single vault (one `.obsidian`, one registry, no nested vaults), surfaced as **wings**. The container-of-independent-vaults model is rejected — it fragments the graph and orphans cross-project notes (an `engine ↔ platform` relationship belongs to neither sub-vault).
2. **The scanner recurses (deny-list), not allow-lists.** `scanNotes` walks the whole vault and indexes every `.md` **except** a fixed skip-set: `.obsidian/`, `.git/`, `node_modules/`, `artifacts/`, `.learnings/`, `archive/`, and generated index files (`INDEX.md`, `_index.*.md`) anywhere. `notes/`/`decisions/`/`work/` lose privileged status — they become pure human convention. This makes "folders are conventions" literally true and picks up `projects/` + any custom dir for free.
3. **The index is registry-enriched, never registry-dependent.** Notes are found and grouped by **tag/wing** alone (works with no registry at all). Where a wing matches a registered project, the index *decorates* it with the code-repo pointer. The registry is a decorator, not a dependency.
4. **Projects are wings, not containers.** A project's index is **tag-defined**: the existing per-wing `_index.<wing>.md` at the hub root *is* the per-project index (a note tagged `engine/x` indexes under `engine` wherever it physically sits). All generated indexes live at the vault root; `projects/<name>/` holds only notes.
5. **`archive/` stays excluded; `status: archived` is the in-place alternative.** Two tiers of "dead": `archive/` (a deny-list member — out of sight, never scanned) and `status: archived` (scanned, flagged, still in the graph).
6. **Retire the per-project scaffolding + flatten the layout.** `projects/<name>/mage/metadata.json` anchors and nested `.obsidian/` are deleted; `projects/<name>/mage/{notes,…}` flattens to `projects/<name>/{notes,…}` — a project looks like the hub it lives in, not like a code-repo `mage/`. One-time migration of existing hubs.
7. **Light drift signals.** `dream` / `verify` add info-level findings (never failures) for a registered project with **0 indexed notes** (the silent-empty-index trap that triggered this) and a `projects/<name>/` dir **not in the registry**. Tag-vs-folder mismatch is deferred.

Consistency is free: `index`, `skills`, and `dream` already share `scanNotes` (`src/dream.ts` calls it), so the deny-list change propagates to all three from one place.

## Considered options

- **Allow-list, just bigger** (add `projects/` + register extra dirs) — rejected: keeps contradicting "folders are conventions"; same bug class, smaller.
- **Container of per-project vaults** (each self-indexes; hub aggregates) — rejected: fragments the one navigable graph, orphans cross-project notes, forced the anchor workaround.
- **Location-defined project index** (`projects/<name>/INDEX.md` by folder) — rejected: re-elevates folder over tag; a note in `projects/engine/` tagged `shared/util` should follow the tag.
- **Index `archive/` / drop the skip-set** — rejected: bloats the always-loaded index with retired content; a deny-list is *allowed* to name dirs.
- **Registry-dependent index** — rejected: a typo or unregistered dir would silently drop notes; breaks files-as-truth.

## Consequences

- The hub index finally reflects the whole hub: sreforge shows its 18 notes; prismalens shows engine + platform wings, each decorated with its code repo.
- The **per-project entry point changes** from `projects/<name>/mage/INDEX.md` to `<hub>/_index.<project>.md`. The external-mode `AGENTS.md` written for the prismalens code repos must be repointed, and the planned `writeAgentsMd` `external` kind must emit the new path.
- **Migration:** existing hubs need a one-time `mv projects/<name>/mage/* projects/<name>/` + deletion of the anchors and nested `.obsidian/`. Pre-1.0, cheap.
- **Correctness now rides the skip-set** — a wrong entry would index `.obsidian` junk or generated files. Fixed for 0.2; a `.mageignore`-style override is a future nicety.
- Closes the roadmap gaps "index hub-owned projects" and "`mage link` writes external awareness."

## Relations

- refines [ADR-0006 — two-layer recall](0006-two-layer-recall-per-wing-skills.md)
- depends_on [ADR-0008 — visible mage/ dir](0008-visible-mage-dir-for-obsidian.md)
- bounded_by [ADR-0004 — capture insight, not copies](0004-capture-insight-not-copies.md)
- realizes [migration field notes](../notes/migration-field-notes.md)
- informs [mage roadmap](../notes/roadmap.md)
