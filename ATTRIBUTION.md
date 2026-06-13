# Attributions

`mage` builds on the work of two open-source projects. This file lists
sources, what we adapted, what we depend on at runtime, and how attribution
is preserved.

## github/spec-kit  *(historical — the adapted SDD skills shipped through 0.0.9)*

- **Source:** https://github.com/github/spec-kit
- **License:** MIT
- **What was adapted:** the spec-driven-development *workflow conventions* — the
  phase chain (constitution → specify → clarify → plan → tasks → analyze →
  implement). mage carried these as seven hand-authored SKILL.md files
  (`skills/{constitution,specify,clarify,plan,tasks,analyze,implement}/`),
  inspired by spec-kit's command bodies but rewritten for mage's knowledge-base
  model. **These skills were removed in 0.0.10**
  ([ADR-0022](mage/decisions/0022-remove-sdd-skills.md)) — they were isolated
  from the memory loop and mage's identity is memory-first. This credit is
  **retained for releases 0.0.1–0.0.9**, which shipped the adapted work and for
  which the MIT attribution is required.
- **What was NOT taken:** spec-kit's Python CLI, its template engine, its
  per-agent installer, or its check scripts — mage never took a runtime
  dependency on it.
- **Form of attribution:** this file. (The per-`SKILL.md` credit lines went away
  with the skills in 0.0.10.)

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

- **spec-kit**: no longer applicable — the adapted skills were removed in 0.0.10
  (ADR-0022). Retained above as historical attribution for releases ≤ 0.0.9.
- **vercel-labs/skills**: no longer a dependency as of 0.0.3 (skills ship as a
  Claude Code plugin). Retained above as historical attribution.
