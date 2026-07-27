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
modified: 2026-07-27T09:10:50.989Z
---

# Gotcha — Gemini re-indents entire files with tabs; diff-stat inflation is the tell

Both ADR-0041 Wave-B agy jobs (Gemini 3.6 Flash) converted every touched file's 2-space
indentation to tabs, turning ~200-line functional changes into 700-1800-line diffs
(`skills-cmd.ts` +553 churned; `paths.ts` 478 lines churned for a 5-line real delta).

**Tells:** a diff-stat far larger than the spec's scope; `grep -c "$(printf '\t')" file` on
touched files. **Fix:** `sed -i 's/\t/  /g'` on touched `.ts` files, re-verify, amend — real
changes survive because they were authored on the tab-indented text. **Prevention:** put
"2-space indent, NEVER tabs" in every agy spec's constraints (added to the Wave-B fix-round
prompts; both came back clean).

Related: [[agy-commit-message-compliance-is-unreliable]] — same family: verify the artifact.
