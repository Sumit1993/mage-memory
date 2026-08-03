---
type: gotcha
tags: [mage/build]
created: "2026-08-03"
last_reviewed: "2026-08-03"
status: active
sources:
  - cc-session:f0a4c7d6-14a5-4f07-a1f4-052892c791bc
  - cc-session:d9b17997-d946-40f3-9aea-84b5b7d99b6c
  - decisions/0035-decouple-harness-memory-from-notes.md
keywords:
  - auto-memory
  - frontmatter
  - cc-schema
  - node-type
  - write-tool
  - edit-tool
  - contamination
  - repair
provenance:
  repo: mage-memory
  work: groom-2026-08-03
---
# Gotcha — the harness memory layer rewrites mage frontmatter on every Write/Edit under mage/

When Claude Code's `autoMemoryDirectory` points at the KB root (here: `mage/`), **every file
written or edited through the harness Write/Edit tools under that path gets its frontmatter
silently rewritten into the CC memory schema** — `name: ""`, everything nested under
`metadata:` with `node_type: memory`, plus injected `originSessionId` and `modified` stamps.
The body is untouched; only the frontmatter is converted. Reads through the harness show the
normalized view too, so an agent cannot see the damage with the Read tool — and its next Edit
fails with "string not found" against bytes that were never on disk.

A 2026-08-03 groom contaminated **15 files in one batch** before the tell surfaced. The same
class hit the prismalens hub earlier ("all the notes in decisions/ have the frontmatter format
of CC, not mage").

**The tell:** `name: ""` on line 2, or `node_type: memory` inside the frontmatter block.
Detection sweep: `grep -rl "node_type: memory" mage/` — then filter out legitimate body
mentions (ADR-0034/0035 and notes documenting the schema) by checking the match is inside
the frontmatter.

**Procedure:**

1. **Author or edit KB files via shell** (`cat > file <<'EOF'`, `sed`, a node script) or the
   mage CLI — never the harness Write/Edit tools while `mage/` is the auto-memory directory.
2. **Repair** a contaminated tracked file by re-attaching its HEAD frontmatter to the
   working-tree body (`git show HEAD:<file>` for the frontmatter; keep the body). New files
   need their frontmatter reconstructed by hand.
3. Re-run `mage index` afterwards; the generated indexes are written by the CLI and stay clean.

Product-shaped root cause: [ADR-0035](../decisions/0035-decouple-harness-memory-from-notes.md)
territory — the KB doubling as the harness memory store is what puts every note in the blast
radius. Related capture-routing principle:
[route-memories-to-the-matching-store](route-memories-to-the-matching-store.md).
