---
type: decision
tags: [mage/decisions]
created: "2026-05-29"
updated: "2026-06-01"
last_reviewed: "2026-06-01"
status: active
provenance:
  repo: mage-memory
  commit: 1ec8225
sources:
  - https://github.com/Sumit1993/specshub
---

# 0001 — A memory-first product (mage) supersedes specshub

specshub was framed as a spec-driven-development docs hub, but its founding purpose was really **durable, portable, cleanup-resistant memory** for software systems — of which spec-driven development is only one authoring path. Rather than contort a spec-named, spec-positioned repo around a memory-first identity, we start a clean product, **mage**: a knowledge base of notes navigable as an Obsidian graph. (Whether mage forks specshub's existing machinery — in-repo/external/hybrid modes, metadata-driven detection, hub registry, commit hygiene, skills — or starts greenfield is a separate decision, ADR-0002 pending.)

## Considered options

- **Reframe specshub in place** — keep the name/repo, change positioning. Rejected: the "spec" name actively misleads about a memory-first product, and specshub is days-old + barely used, so switching cost is near zero.
- **New product `mage`** (chosen) — a clean, accurate identity from day one.

## Consequences

- specshub gets `npm deprecate specshub "succeeded by mage"` (full `unpublish` only if still within npm's 72h window); its GitHub repo is **archived with a README pointer to mage** — left for reference, not deleted.
- mage starts its own ADR sequence at 0001 (this file). specshub's ADRs 0001–0005 stay with specshub; still-relevant ones (e.g. no-symlinks) are re-adopted in mage's decisions as needed.
- Name `mage-memory` (command `mage`) verified exact-free on npm; a publish-time similarity check is still required before first publish.

## Relations

- depends_on [ADR-0002 — fork and reorient specshub](0002-fork-and-reorient-specshub.md)
- see_also [mage language & glossary](../notes/context.md)
