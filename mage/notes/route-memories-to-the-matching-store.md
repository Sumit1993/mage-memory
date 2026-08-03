---
type: principle
tags: [mage/grooming]
created: "2026-08-03"
last_reviewed: "2026-08-03"
status: active
sources:
  - cc-session:f9674d57-5fc5-44bf-990c-37375a968941
  - work/future-thoughts.md
provenance:
  repo: mage-memory
  work: groom-2026-08-03
keywords:
  - memory-routing
  - scope
  - user-level
  - repo-kb
  - hub
  - capture
  - ft-20
---
# Route a memory to the store that matches its scope, not the KB you happen to be in

Direct user correction (2026-08-01): *"Claude saves a memory in the KB/hub, but the memory
should have been a user-level memory and not restricted to one KB/hub."* The failure mode:
a lesson is learned while working in repo X, so it gets filed in repo X's KB — even when the
lesson is about the **user** (their tools, preferences, global workflow) and would be needed
in every repo. It then never surfaces anywhere else.

**Procedure — before writing any note, ask who needs it next time:**

- **Future agents in THIS repo** (a codebase gotcha, an interface detail, a soak fact) →
  this repo's `mage/notes/`.
- **Future agents in ANY repo** (user preference, environment constraint, tool behavior,
  delegation doctrine) → the user-level store: global `~/.claude/CLAUDE.md` or a
  [claude-kit](https://github.com/Sumit1993/claude-kit) skill. Until
  [FT-20 — a global user-level hub](../work/future-thoughts.md#ft-20--a-global-user-level-hub-personal-cross-system-memory----soak-raw-author-note-3)
  exists, those two are the user tier.
  Interim contract: the harness autoMemoryDirectory currently points at this repo's
  `mage/`, so this KB actively doubles as that user store — user-level notes MAY live
  here until FT-20 lands, each carrying a scope note that links this principle.
- **mage the product** (a design idea the tool should absorb) → an FT entry in
  [future-thoughts](../work/future-thoughts.md), not a note.

**The tell:** the draft's subject is "the user", the user's tooling (agy, Claude Code), or "my machine"
rather than this repo's code or KB — that's a user-level memory wearing a repo note's
clothes.
