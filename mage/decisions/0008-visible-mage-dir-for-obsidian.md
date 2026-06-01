---
type: decision
tags: [mage/decisions]
created: "2026-06-01"
updated: "2026-06-01"
last_reviewed: "2026-06-01"
status: active
provenance:
  repo: mage-memory
  commit: 1ec8225
---

# 0008 — In-repo knowledge base lives in a visible `mage/` dir (not hidden `.mage/`)

v0.1 LOCKS #2 set the in-repo data dir to `.mage/` (hidden, tooling-like, grouped with `.git`/`.obsidian`). Dogfooding surfaced a direct conflict: Obsidian's "open folder as vault" picker hides dot-folders, so the in-repo knowledge base cannot be opened as a vault frictionlessly — which contradicts two founding values stated in the first line of [context & glossary](../notes/context.md): the base must be **discoverable** and **navigable as an Obsidian graph**. A hidden directory also quietly undercuts a *memory* tool — hidden things get forgotten, the very failure mode mage exists to prevent. We therefore **un-dot the in-repo store**: the knowledge base lives in a visible `mage/` directory. Brand, CLI, and schema are unchanged (`mage`, `mage.v1`); only the data dir changes: `.mage/` → `mage/`.

## Considered options

- **Keep `.mage/`, document the picker step** (reveal-hidden / paste the full path) — rejected: not frictionless, and it fights the "discoverable" founding value.
- **Route Obsidian users to external-hub mode** (already a non-dotted vault root) — rejected: it moves the base *out* of the code repo, abandoning in-repo co-location and the self-hosting dogfood.
- **Opt-in `--visible` flag, `.mage/` stays default** — rejected: doubles the detection / gitignore / test surface (candidate-list resolution) to support a "have both" convenience; mage values one deterministic name.
- **Symlink `mage → .mage`** — rejected: mage leans no-symlinks, and WSL↔Windows symlinks are fragile.
- **Visible `mage/` by default** (chosen) — one canonical name; the in-repo base opens in Obsidian out of the box.

## Consequences

- **Reverses v0.1 LOCKS #2** ("Data dir = `.mage/`"). The naming-authority note [plan-v0.1-locks](../notes/plan-v0.1-locks.md) is updated; the data dir is now `mage/`. The hub root was already non-dotted; the per-project nesting un-dots too, since it flows from the single `META_DIR` constant.
- **No back-compat, no migration tooling.** mage is pre-release (never pushed, never published) — there is no install base. The only `.mage/` in existence (the self-hosting dogfood) is migrated by **rewriting the unpushed v0.1 commit** so `mage/` is baked in from inception; `.mage` never enters history. If mage ever ships, *that* is when a migration path earns its keep — not before (YAGNI).
- `META_DIR` becomes `mage`; downstream literals update accordingly: gitignore patterns (`mage/**/artifacts/`, `mage/.learnings/`), the AGENTS.md `docsRel`, the awareness + per-wing skills, and user-facing strings.
- **Trade-off accepted:** a visible top-level `mage/` dir now appears in every adopter repo (mild clutter, comparable to `docs/`) in exchange for discoverability + frictionless Obsidian. Judged aligned with the founding values. Folders remain **conventions, not constraints** — a note's wing comes from its first tag, not its path — so `mage/` is a home, not a restriction.

## Relations

- supersedes [mage v0.1 locks — data-dir name](../notes/plan-v0.1-locks.md)
- realizes [mage — context & glossary](../notes/context.md)
- see_also [ADR-0003 — track work, ignore artifacts](0003-track-work-ignore-artifacts.md)
