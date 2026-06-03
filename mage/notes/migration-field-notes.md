---
type: reference
tags: [mage/roadmap]
created: "2026-06-02"
updated: "2026-06-02"
last_reviewed: "2026-06-02"
status: active
provenance:
  repo: mage-memory
  work: external-migrations-field-test
sources:
  - src/scan.ts
  - src/commands/link.ts
  - src/dream.ts
  - src/paths.ts
keywords: [field-test, migration, hub-indexing, link-awareness, bulk-import, dream, onboarding, v0.2]
---

# Field notes — first external migrations (v0.1 dogfood)

## Context
First real-world use of mage v0.1 on external data: migrated a real **in-repo** KB (15 notes)
and a real **external hub** (2 hub-owned projects, ~138 files plus existing hub content) out of
a predecessor's layout into mage, byte-preserving. Everything verified — zero body drift,
`verify` green, `dream` clean. The run surfaced concrete v0.2 gaps and a reusable recipe,
captured here so 0.2 planning starts from evidence, not memory. The raw migration is
author-local; this is the reusable residue.

## Gaps surfaced (→ v0.2)

1. **Hub-owned projects aren't indexed from the hub root.** `scanNotes` skips `projects/`
   (`src/scan.ts` `SKIP_DIRS`) and `index`/`dream` run on a single resolved docs root, so a hub's
   `mage index` covers only hub-level notes. Hub-owned project notes are *registered* (`list`,
   `verify`) but never indexed, and `resolveDocsRoot` can't descend into a project (no
   `metadata.json` there). **Workaround used:** drop a per-project `metadata.json` (mode in-repo)
   into `projects/<name>/mage/` so `mage index --dir projects/<name>` resolves it. **v0.2:** native
   hub indexing — recurse `projects/` (or `mage index --all` / an aggregate hub INDEX) so the
   anchor isn't needed.

2. **`mage link` leaves external code repos without awareness.** `link` writes the code repo's
   `mage/metadata.json` (mode external) and refreshes the hub registry, but writes **no**
   `AGENTS.md`/`CLAUDE.md` (`writeAgentsMd` has only `in-repo`/`hub` kinds). A fresh agent opening
   an external code repo gets no pointer to the hub. **v0.2:** add an `external` kind to
   `writeAgentsMd` and have `link` emit it, pointing at `<hub>/projects/<project>/mage/INDEX.md`.

3. **No bulk-migration path — the recipe was hand-rolled.** Moving a pile of existing prose into
   mage had to be done in shell. Sharpens the roadmap's `/learn --from <transcript>` into a
   `--from <dir>` prose-doc variant (a judgment skill, per ADR-0009). The byte-safe recipe is in
   *Procedure* below. **Capture-by-pointer caveat:** when the prose docs ARE the canonical
   originals (a backup, nothing external to link to), verbatim migration into mage is correct and
   does *not* violate ADR-0004 — that rule forbids duplicating a *linkable* source, not giving an
   orphaned original a durable home.

4. **`dream` held up on real data.** It caught genuine pre-existing dangling links in the source
   docs (siblings that never existed) and a self-inflicted one (a moved note's links), and flagged
   superseded/orphans correctly. **Tuning to consider:** a freshly-migrated KB of standalone
   `reference` docs trips the orphan check heavily — consider downgrading orphan severity, or
   skipping it for `reference`-type / archived notes.

5. **External-hub onboarding is manual.** Two friction points with no product support: "where do I
   point a new agent?" (answered by the per-project INDEX + the awareness file from gap 2) and
   needing a hand-written `.code-workspace` to make the external KB visible beside the code.
   **v0.2:** emit the onboarding pointer; optionally scaffold/refresh a multi-root workspace that
   includes the hub.

## Procedure — byte-safe migration recipe (reuse until the skill exists)
- **Mirror** the source subtree under `notes/` (keep original filenames + subdirs) so intra-doc
  relative links stay valid; grouping comes from `#wing/room` tags, not folders (CONVENTIONS §4).
- **Prepend frontmatter, keep the body byte-identical:**
  `{ printf -- '---\n…\n---\n\n'; cat "$src"; } > "$dst"` — the body is `cat`'d, never re-emitted.
- **Verify zero drift** per file: `diff <(tail -n +<N+1> "$dst") "$src"` (N = frontmatter lines).
- **`archive/` copies verbatim, no frontmatter** (it isn't scanned).
- **Convert** cross-refs → `relationship` notes; a constitution → a `principle` note.
- **Finish** with `mage index` + `verify` + `dream`; expect dangling links only where the source
  was already broken.

## Relations
- sharpens [mage roadmap](roadmap.md)
- evidence_for [agentmemory mining map](agentmemory-mining-map.md)
- informs [ADR-0009 — no runtime; automation rides host hooks](../decisions/0009-no-runtime-automation-rides-host-hooks.md)
- clarifies [ADR-0004 — capture insight, not copies](../decisions/0004-capture-insight-not-copies.md)
