---
type: decision
tags: [mage/decisions]
created: "2026-06-14"
updated: "2026-06-14"
last_reviewed: "2026-06-14"
status: active
provenance:
  repo: mage-memory
  work: 0.0.10-coherence-flat-vs-nested
sources:
  - src/paths.ts
  - src/commands/init.ts
  - src/commands/link.ts
  - mage/decisions/0011-recursive-scan-hub-projects.md
  - mage/decisions/0012-wings-optional-convention-standalone-hubs.md
---

# 0023 — A hub keeps its own notes AND flat per-project subdirs (ratification)

A **hub is one repo** that is *both* a knowledge base in its own right — with its
own top-level `notes/`, `work/`, `decisions/`, `INDEX.md` — *and* an aggregating
registry of project knowledge bases under `projects/<name>/`. Reading the tree:

```
my-hub/
  metadata.json        # the registry: { name, projects: [{name, storage, code_repo_path, …}] }
  INDEX.md             # the hub's OWN index
  notes/  work/  decisions/   # the hub's OWN knowledge (cross-cutting)
  projects/
    engine/            # one hub-owned project's flat docs root (its notes live here)
    web/               # another
```

This layout has drawn a recurring "isn't that duplication?" worry — the hub has
`notes/` AND `projects/<name>/` that also hold notes. This ADR **ratifies the
layout and reframes the worry**, so the question stops being re-litigated.

## It is scope-separation, not duplication

The two locations hold knowledge at **different scopes**, and that separation is
the point:

- **The hub's own `notes/`** carry **cross-cutting** knowledge — what spans the
  whole system: the shared architecture, the conventions every project obeys, the
  decisions that govern the fleet. This is the hub-as-KB.
- **`projects/<name>/`** carries knowledge **scoped to one project** — the wing
  for that code repo. This is the hub-as-registry.

A note about "how the auth service retries" belongs to the `auth` project; a note
about "every service emits OpenTelemetry spans this way" belongs to the hub's own
notes. Neither is a copy of the other. A "workspace" of several connected repos is
**not a fourth KB flavor** — its cross-cutting knowledge simply *is* the hub's own
notes (see [ADR-0012](0012-wings-optional-convention-standalone-hubs.md) and the
in-repo / hybrid / external shapes).

## Flat, not nested

A project's docs root is **`<hub>/projects/<name>/`** directly — notes live at
`projects/<name>/notes/`, not `projects/<name>/mage/notes/`. There is no second
`mage/` directory nested inside the hub (the hub root already *is* the mage KB).
This was set by [ADR-0011](0011-recursive-scan-hub-projects.md); `resolveDocsRoot`
encodes it — an external-mode code repo resolves to
`{ root: <hub>/projects/<name>, kind: "hub", repo: <hub> }`. Flat keeps the path a
human (and an `obsidian://` deep-link) can predict, and keeps the registry a single
shallow scan.

## Consequences

- **Scaffolding alignment.** `init --hub` creates the hub's own `notes/` etc. +
  an empty `projects/`; `mage link` adds a project — a flat `projects/<name>/` stub
  for a **hub-owned** link, or just a registry entry for a **repo-owned** (hybrid)
  link whose docs stay in the code repo. Both paths now write the code repo an
  AGENTS.md that names the right shape (Decision 11A wired the hybrid block).
- **Labeling.** Surfaces that list notes across a hub (the dashboard, a hub
  `INDEX.md`) should **label hub-own vs project notes** so the scope is legible at
  a glance — the layout is only self-explanatory once the two scopes are named.
- **No migration.** This ratifies what already ships; nothing on disk changes.

## Alternatives considered

- **Nest each project as its own `mage/` KB inside the hub** (`projects/<name>/mage/`).
  Rejected: a second `mage/` root inside a repo that is itself a mage KB is the real
  duplication — two index scans, two `.obsidian/` configs, an ambiguous
  `resolveDocsRoot` walk. Flat is simpler and already shipped.
- **Forbid the hub from having its own `notes/`** (make it a pure registry).
  Rejected: cross-cutting knowledge would then have nowhere to live but a fake
  "project", which is exactly the confusion this ADR removes. Every flavor is a KB —
  including the hub itself.
