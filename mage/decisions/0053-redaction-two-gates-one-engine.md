---
type: decision
tags: [mage/decisions]
status: accepted
created: "2026-09-10"
last_reviewed: "2026-09-10"
keywords: [redaction, secrets, pii, gate-1, gate-2, pre-commit, scrub, block]
---

# 0053 — Redaction: two gates, one engine
## Decision
One deterministic redaction engine runs at two write boundaries. Gate 1: `mage observe` scrubs every event
before it is written and continues. Gate 2: a mage-installed git pre-commit hook runs `mage redact --check
--staged` over the knowledge base paths and blocks the commit when a likely live secret is staged; it is scoped
to the knowledge base, not the whole repo. `connect` installs the hook and gitignores the capture sinks;
`doctor` reports both. The allowlist lives in `metadata.json`.
## Why
Transcripts carry tokens and personal data. The moment they reach git they are published, so the engine
detects before the write and blocks before the commit. Scanning the whole repo blocked mage's own redaction
fixtures, so the gate is scoped.
## Forbids
Bypassing Gate 2 to unblock an autonomous run (git's verify-skip flag, disabling the hook). A Gate-2 scan
outside the knowledge base. An allowlist file outside `metadata.json`. A detector without a fixture test for
the key shapes it claims to catch.
## Example
Every commit in this series printed `mage redact --staged — Gate-2 scan ... No secrets or PII in staged
changes.` A staged note holding `sk-ant-api03-...` exits 1 and names the file and line.
## Relations
Absorbs 0014 and the Gate-2 scope rule of 0018. Enforced by `src/redact.ts:227` (`scanSecrets`),
`src/git-hooks.ts:29` (the hook script), `src/observe/scrub.ts:1`. Open: #195, doctor skips this check in
external mode. Gotchas: notes `gate2-fp-blocks-autonomy`, `gate2-blocks-own-redaction-fixtures`,
`redaction-anthropic-key-detector`, `connect-doesnt-ensure-ignores`.
