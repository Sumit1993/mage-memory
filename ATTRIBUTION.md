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

## vercel-labs/skills  *(runtime dependency for skill install)*

- **Source:** https://github.com/vercel-labs/skills
- **License:** Apache License 2.0
- **How we use it:** at runtime, via direct user invocation. Users install
  the mage skill bundle with `npx skills add github:Sumit1993/mage-memory`
  (and remove with `npx skills remove github:Sumit1993/mage-memory`). mage
  itself does not wrap or shell out to `npx skills` — vercel-labs/skills owns
  the per-agent installation matrix end-to-end (Claude Code, Codex CLI,
  OpenCode, Cursor, Gemini CLI, and others). We don't ship the per-agent
  path knowledge ourselves; their package owns it. mage's skills live in the
  repo-root `skills/` directory so the CLI auto-discovers them.
- **Form of attribution:** this file, plus a credit in [`README.md`](README.md).
- **Apache 2.0 § 4 compliance:** as a runtime caller (not a redistributor of
  their source), the requirements are largely about preserving copyright
  notices and any NOTICE file when we DO redistribute their modified source.
  We don't redistribute their source; we invoke their published CLI via npx.
  This file documents the dependency for transparency.

---

If either project updates in ways that warrant adopting their changes, the
process is:

- **spec-kit**: manual re-survey of their command bodies; update affected
  `skills/<name>/SKILL.md` files directly. Commit with a clear "sync to
  spec-kit @ <ref>" message. No automated sync.
- **vercel-labs/skills**: zero work on our end. The next `npx skills add`
  invocation pulls the latest from their published package.
