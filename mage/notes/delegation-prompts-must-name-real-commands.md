---
type: gotcha
tags: [mage/build]
created: "2026-07-19"
last_reviewed: "2026-07-19"
status: active
sources:
  - notes/mage-no-biome-2space.md
  - decisions/0039-context-footprint-measure-and-bound.md
provenance:
  repo: mage-memory
  work: adr-0039-context-footprint
keywords:
  - delegation
  - agy
  - prompt
  - verification-commands
  - nonexistent-script
  - house-rules
---
# Gotcha — a delegate sent after a command that does not exist will find the one you forbade

Naming a verification command in a delegation prompt **without checking it exists** is how a
capable delegate ends up doing the exact thing the knowledge base warns against.

**Hit 2026-07-19 (ADR-0039):** a prompt told an agy/Gemini run to verify with
`pnpm run lint`. This repo has **no `lint` script** — only `typecheck` and `test`. The delegate
went looking for a linter, found biome, and ran it. Biome's default config indents with
**tabs**, so a ~130-line change came back as a 472-line whole-file reformat — the precise
incident already documented in [mage-no-biome-2space](mage-no-biome-2space.md). The delegate had
never read that note; it was only in the orchestrator's context.

**Why it is worth a note of its own:** the existing note says *"don't run biome."* This one is
about the *causal path* — an underspecified prompt creates a gap, and the delegate fills it with
whatever the ecosystem suggests, which is often the forbidden thing. The failure was in the
prompt, not the model.

**How to apply:**

- Before delegating, **check every command you name**: `node -e "console.log(Object.keys(require('./package.json').scripts))"`.
- **Distil the repo's house rules into the prompt** — the delegate cannot read the KB. For this
  repo that means: no formatter, no linter, no `lint` script, 2-space by hand, verify with
  `pnpm run typecheck` and `pnpm test` only.
- Require `git diff --stat` in the report and demand it be **additions-heavy**; whole-file churn
  is the tell that something reformatted.
- State a rule the delegate can apply without judgement: *"if the diff shows hundreds of changed
  lines in a file where you edited two functions, run `git checkout -- <file>` and re-apply by
  hand."*

Relates to [agy-commit-message-compliance-is-unreliable](agy-commit-message-compliance-is-unreliable.md).
