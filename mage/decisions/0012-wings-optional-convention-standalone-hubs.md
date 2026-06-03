---
type: decision
tags: [mage/decisions]
created: "2026-06-03"
updated: "2026-06-03"
last_reviewed: "2026-06-03"
status: active
provenance:
  repo: mage-memory
  work: hub-generalization-grill
sources:
  - src/commands/init.ts
  - src/commands/link.ts
  - src/scan.ts
  - src/paths.ts
---

# 0012 — A wing is an optional convention; hubs are standalone-first

mage was framed "for software systems," and its hub mechanics encode that: a "project" *requires* a code repo (`HubProject.code_repo_path`), and every hub is *born* from one (`init --external` registers the cwd repo as the hub's first project). A wings-examples ladder (minimal → robust, `~/ai-context/mage-wings-examples.html`) plus a grill-with-docs session (2026-06-03) tested whether the model generalizes to non-developers and to robust hubs, and surfaced nine gaps. [ADR-0011](0011-recursive-scan-hub-projects.md) (recursive scan; hub = one vault; project = a code-backed wing) already did most of the generalizing — the **wing** is the universal scope. This ADR resolves the rest.

## Decision

1. **A wing is an optional *convention*, not a necessity.** A note needs no wing — untagged notes are valid and index under "Cross-cutting" (graceful degradation, CONVENTIONS §1). A wing is the tool you reach for when a base spans **more than one top-level scope**, never a tax on every note. So mage neither **imposes** nor **infers** a wing: the first tag segment is *always* the wing, everywhere — consistent, and multi-wing-safe (an in-repo KB can itself span several wings, e.g. the repo + the external services it calls, so a "default wing = project" inference would mis-file `[stripe]` as a room under the project).

2. **A hub is one graph (hub-owned) + pointers to satellites.** ADR-0011's "one vault" means a hub's Obsidian graph can only hold its **hub-owned** notes. A member with `storage: in-repo` keeps its notes in its own repo; the hub **cannot** put them in its graph. So the hub index lists an in-repo member as an explicit **pointer** — *"notes live in `<repo>/mage` → open its INDEX"* — visible, never silently empty. Cross-repo content/graph aggregation is rejected (incompatible with one-vault).

3. **Hubs are standalone-first; one detection-first `mage init`.** Hub creation is decoupled from code repos:
   - `mage init` (no name) → in a git repo, an **in-repo** KB; not a git repo, a **standalone hub** in the current dir.
   - `mage init <name>` → a **hub** at that location (bare name → `./<name>`; a path → that path, like `git init`/`npm init`); inside a git repo it *warns* about nesting.
   - `--in-repo` / `--hub` + `-y` are the explicit non-interactive forms (agents/CI). The word `--external` is **retired** (capability = `--hub`; its create-as-sibling magic is dropped). `mage link` is unchanged.
   - **`init` stays suggest-only** — it prints the exact commit command and **never runs git** (the "mage never runs git" invariant stays absolute; an agent must never land a surprise commit).

4. **The system is a wing** (hub-level notes). Cross-cutting hub notes — `relationship`s, hub-wide ADRs, the MAP/MOC — tag the **hub's own name** as their wing (`prismalens/relationships`, `prismalens/decisions`). No magic `_hub`/`meta` wing; the whole-system scope is just a wing. "Cross-cutting" remains the fallback for genuinely unscoped notes.

5. **Multi-home by tags.** A note is indexed under **every wing it is tagged with**; the *first* tag stays **primary** (sets `noteWing`, Obsidian color, ownership), additional tags **cross-list** it into those wings' indexes. This aligns mage with Obsidian (a note with `#a #b` is in both groups — today mage is the odd one out) and lets a cross-wing note (a `my-api → stripe` relationship, a shared util) be found from either wing's index — important for agents, who navigate by index, not graph.

6. **No level above wing (yet).** Tags stay 2-level (`wing/room`); the generated root INDEX stays a flat, sorted wing list. Curated grouping of wings into categories (products / clients / PARA) is a hand-written hub **MOC**, not a schema — generated index = mechanical, MOC = curated. Revisit a mechanism only if hubs routinely exceed ~20 wings.

7. **Gentle tag adoption; people are wings.** Because wings are a convention, `dream` *suggests* (never enforces) a `#wing/room` when a base has many untagged notes; the awareness skill teaches it. "A wing can be a person" stays — a person/stakeholder is a valid optional scope, no tooling.

## Considered options

- **Wing as a necessity / impose a default wing in-repo** — rejected: contradicts graceful degradation, and inference mis-files notes in a multi-wing in-repo KB.
- **Cross-repo aggregation for in-repo members** — rejected: incompatible with ADR-0011 one-vault (Obsidian can't span repos); links wouldn't be graph edges and break on move.
- **Forbid in-repo storage in hubs** — rejected: discards the legitimate "notes live with my code, but the hub knows I exist" hybrid; the pointer (decision 2) keeps it without the silent-empty failure.
- **`init` runs the commit (interactive)** — rejected: breaks "mage never runs git" and risks an agent landing a surprise commit.
- **A 3rd tag level / a `category` on wings** — rejected/deferred: wings are *emergent* (no object to hang a category on); a MOC covers curated grouping with zero schema.
- **Reserved `_hub`/`meta` wing** — rejected: a magic wing competes with "the system is just a wing named after itself."

## Consequences

- mage generalizes to non-developers **with no new core concept** — the wing already *is* the universal scope; this ADR mostly *names* that and adds the standalone entry point (`mage init`).
- **Build (0.0.2):** standalone-hub init + detection-first `mage init`; the in-repo-member **pointer** rendering in the hub index; **multi-home by tags** (`scan` emits all tag-wings; index/skills cross-list); the `dream` untagged-notes nudge; retire the `--external` word.
- `HubProject.storage: in-repo` becomes a first-class, **visible** state (a pointer), not a silent hole.
- The positioning *"mage — for software systems"* becomes a **choice**, not a constraint: the architecture serves any knowledge base; a wing is just an optional scope.
- No git-posture change: `init` stays suggest-only, so README's "mage never auto-commits" and AGENTS.md stay true as written.

## Relations

- extends [ADR-0011 — recursive scan; hub projects are wings](0011-recursive-scan-hub-projects.md)
- refines [ADR-0006 — two-layer recall](0006-two-layer-recall-per-wing-skills.md)
- see_also [ADR-0009 — no runtime; automation rides host hooks](0009-no-runtime-automation-rides-host-hooks.md)
- realizes [migration field notes](../notes/migration-field-notes.md)
- informs [mage roadmap](../notes/roadmap.md)
