---
type: reference
tags: [mage/roadmap]
created: "2026-06-02"
updated: "2026-07-27"
last_reviewed: "2026-07-27"
status: active
provenance:
  repo: mage-memory
  work: external-migrations-field-test
sources:
  - src/scan.ts
  - src/commands/link.ts
keywords: [field-test, migration, bulk-import, byte-safe, onboarding, v0.2]
---

# Field notes — first external migrations (v0.1 dogfood)

First real-world migration of external KBs into mage (an in-repo KB of 15 notes + a 2-project
hub, byte-preserving; zero body drift, `verify` green, `dream` clean). The reusable residue is
the recipe below; the five v0.2 product gaps it surfaced (hub indexing, `link` awareness files,
bulk-import skill, orphan-check tuning, onboarding pointers) are tracked in the
[roadmap](../work/roadmap.md) — full detail in this file's git history (2026-06-02 version).

## Procedure — byte-safe migration recipe (reuse until the bulk-import skill exists)

- **Mirror** the source subtree under `notes/` (keep original filenames + subdirs) so intra-doc
  relative links stay valid; grouping comes from `#wing/room` tags, not folders.
- **Prepend frontmatter, keep the body byte-identical:**
  `{ printf -- '---\n…\n---\n\n'; cat "$src"; } > "$dst"` — the body is `cat`'d, never re-emitted.
- **Verify zero drift** per file: `diff <(tail -n +<N+1> "$dst") "$src"` (N = frontmatter lines).
- **`archive/` copies verbatim, no frontmatter** (it isn't scanned).
- **Finish** with `mage index` + `verify` + `dream`; expect dangling links only where the source
  was already broken.

## Insight — when a verbatim copy does NOT violate ADR-0004

Capture-by-pointer forbids duplicating a *linkable* source. When the prose docs ARE the canonical
originals (a backup with nothing external to link to), verbatim migration into mage is correct —
it gives an orphaned original a durable home, it doesn't duplicate one.

## Relations

- sharpens [mage roadmap](../work/roadmap.md)
- evidence_for [agentmemory mining map](agentmemory-mining-map.md)
- clarifies [ADR-0004 — capture insight, not copies](../decisions/0004-capture-insight-not-copies.md)
