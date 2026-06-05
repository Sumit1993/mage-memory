# Attributions

`mage` builds on the work of two open-source projects. This file lists
sources, what we adapted, what we depend on at runtime, and how attribution
is preserved.

## github/spec-kit  *(adapted, not depended on)*

- **Source:** https://github.com/github/spec-kit
- **License:** MIT
- **What was adapted:** the spec-driven-development *workflow conventions* —
  the phase chain (constitution → specify → clarify → plan → tasks → analyze →
  implement) and the structure of each phase's artifact. In mage these become
  carried skills that author a **work unit** (`mage/work/<slug>/{spec,plan,tasks}.md`)
  rather than spec-kit's `specs/<feature>/` layout, and the "constitution"
  becomes a `principle`-type note. Our
  `skills/{constitution,specify,clarify,plan,tasks,analyze,implement}/SKILL.md`
  files are inspired by spec-kit's command bodies but **hand-authored to fit
  mage's knowledge-base model** (notes, wings/rooms, capture-by-pointer) and
  its in-repo / external / hybrid modes.
- **What was NOT taken:** spec-kit's Python CLI, its template engine, its
  per-agent installer, its check scripts. We don't take a runtime dependency
  on spec-kit; users don't need to install it.
- **Form of attribution:** this file, plus a credit line in each affected
  `SKILL.md` (an HTML comment near the top stating the file is adapted from
  spec-kit and pointing here), plus a credit in [`README.md`](README.md).
- **Sync cadence:** none. We adopted spec-kit's conventions at the moment of
  authorship once and maintain the SKILL.md files ourselves going forward.

## vercel-labs/skills  *(historical — install method through 0.0.2)*

- **Source:** https://github.com/vercel-labs/skills
- **License:** Apache License 2.0
- **How we used it:** through 0.0.2, users installed mage's skills with
  `npx skills add github:Sumit1993/mage-memory`. As of **0.0.3**, mage's skills
  ship as a **Claude Code plugin** (`/plugin marketplace add Sumit1993/mage-memory`
  then `/plugin install mage@mage`), so mage no longer depends on
  vercel-labs/skills. mage never wrapped or shelled out to their CLI; this credit
  is retained for the earlier releases that relied on it.
- **Form of attribution:** this file, plus a credit in [`README.md`](README.md).

---

If either project updates in ways that warrant adopting their changes, the
process is:

- **spec-kit**: manual re-survey of their command bodies; update affected
  `skills/<name>/SKILL.md` files directly. Commit with a clear "sync to
  spec-kit @ <ref>" message. No automated sync.
- **vercel-labs/skills**: no longer a dependency as of 0.0.3 (skills ship as a
  Claude Code plugin). Retained above as historical attribution.
