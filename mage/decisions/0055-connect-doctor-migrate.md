---
type: decision
tags: [mage/decisions]
status: accepted
created: "2026-09-10"
last_reviewed: "2026-09-10"
keywords: [connect, doctor, migrate, hooks, settings, agents-md, deprecation, verbs, setup]
---

# 0055 — Connect, doctor, migrate
## Decision
`connect` is the one setup act, opt-in and never bundled with the plugin install. It writes marked, idempotent
hook entries (`id: mage:*`) into `.claude/settings.local.json` (`~/.claude/settings.json` with `--user`), refuses
to touch malformed JSON, installs the Gate-2 hook, gitignores the capture sinks, points native memory at the
store, and asks which kit, which streams and which landing scopes accept a pull request, writing the committed
consent field and nothing else. `doctor` audits capture, recall and readiness (kit reachable, streams
configured, ledger present, ladder hook installed), fails on a footprint breach, and `--fix` repairs only what
is idempotent, mage-owned, local and reversible. `migrate` is the only migration verb: for a 0.0.x knowledge
base it clears retired state, rewrites the AGENTS.md block without clobbering hand edits, repoints the memory
hook, installs the PreToolUse arm, warns on `work/`, and imports existing notes through the ladder check. A
retired verb prints its replacement and exits 0, never with a breaking marker. A person sees eight verbs:
`init`, `connect`, `disconnect`, `doctor`, `index`, `groom`, `ledger`, and `observe` hidden.
## Why
24 verbs were registered and 11 were never run outside this repo. One conversation over one address is
remembered; a menu is not. A hook a plugin installs silently is a hook nobody consented to.
## Forbids
Hooks installed by the plugin manifest. Overwriting a hand-edited AGENTS.md block. `doctor --fix` writing a
machine path into a committed file. A new verb for a migration or a new visible verb outside the eight.
`!` or `BREAKING CHANGE` on a retirement. A stamp scheme for the AGENTS.md block other than the content hash.
## Example
`mage connect` on a 0.0.17 knowledge base: "hooks: 12 entries written to .claude/settings.local.json;
pre-commit: installed; native memory: pointed at mage/; kit? [github.com/o/claude-kit]; streams? [hooks,
findings]; landing: repo, kit". `mage distill` afterwards prints "distill retired; run mage groom" and exits 0.
## Relations
Absorbs 0017, 0034, 0037, the conversation half of 0044, decision 8 and the consent clause of decision 5 of
0048; verb surface #248. Enforced by `src/commands/connect.ts:85`, `src/adapters/claude-code/settings.ts:328`,
`src/agents-md.ts:13`, `src/commands/doctor.ts:66`. Open: #198 (PR #240), #207, #208 (PR #256), #222, #194,
#195, #196. Hubs and addresses: 0056.
