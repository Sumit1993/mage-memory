---
type: gotcha
tags:
  - mage/build
created: "2026-07-27"
updated: 2026-07-27
last_reviewed: 2026-07-27
status: active
provenance:
  repo: mage-memory
  work: adr-0041-wave-b-delegation
sources:
  - cc-session:ee0349da-df7e-4672-b8be-dc8cb25cb2c5
keywords:
  - gemini
  - agy
  - tabs
  - indentation
  - diff-churn
  - delegation
modified: 2026-07-27T09:47:12.778Z
---

# Gotcha — Gemini re-indents entire files with tabs; diff-stat inflation is the tell

Both ADR-0041 Wave-B agy jobs (Gemini 3.6 Flash) converted every touched file's 2-space
indentation to tabs, turning ~200-line functional changes into 700-1800-line diffs
(`skills-cmd.ts` +553 churned; `paths.ts` 478 lines churned for a 5-line real delta).

**Tells:** a diff-stat far larger than the spec's scope; tab-indented lines in touched files —
`grep -c "^$(printf '\t')" <file>` (counts lines that *start* with a tab; in a 2-space repo any
nonzero count is the tell). **Fix (indentation-only — a global `s/\t/  /g` would also rewrite tabs inside
string literals):** `sed -i -e ':a' -e 's/^\(\t*\)\t/\1  /;ta' <files>` converts leading tab
runs to 2-space steps and leaves in-line tabs alone; re-verify (typecheck + tests), amend — real
changes survive because they were authored on the tab-indented text. **Prevention:** put
"2-space indent, NEVER tabs" in every agy spec's constraints (added to the Wave-B fix-round
prompts; both came back clean).

Related: [[agy-commit-message-compliance-is-unreliable]] — same family: verify the artifact.
