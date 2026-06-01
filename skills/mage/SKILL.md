---
name: mage
description: |
  Operate inside a mage knowledge base — a portable, file-based store of notes
  (insight, procedure, and pointers) navigable as an Obsidian graph. Use when
  the current repo has a `mage/metadata.json`, when you're in a mage hub, when
  you modify anything under `mage/`, or when the user invokes `/mage`. Teaches
  detection, read order (INDEX first), capture-by-pointer, staleness handling,
  commit hygiene, and the note conventions.
allowed-tools: Read, Grep, Glob, Bash
---

# mage: working in this knowledge base

mage is the durable, portable memory for a software system: markdown **notes**
(one thing each, with frontmatter + portable links) under `mage/`, plus a
generated **INDEX** that lists what exists. Notes capture the reusable
**insight + procedure + pointers** — never copies of sources. Full conventions
live in `CONVENTIONS.md` at the repo/hub root.

## A. Detection

Find the nearest `mage/metadata.json` walking up from the current dir.

```bash
test -f mage/metadata.json && cat mage/metadata.json
```

- **Absent** (and not inside a mage hub) → this repo isn't mage-managed; this skill doesn't apply. Skip.
- **Present** → note `mode`, `project`, `hub_path`, `hub_refs`.

A **hub** is a repo whose root has `projects/` + a top-level `metadata.json`;
there the hub root itself is the knowledge base (vault).

## B. Path resolution — where the knowledge base lives

| `mode` | Docs root |
|--------|-----------|
| `in-repo`  | `<code-repo>/mage/` |
| `external` | `<hub_path>/projects/<project>/mage/` |

Hybrid (mode=in-repo with non-empty `hub_refs[]`): docs root is the in-repo
`mage/`; each `hub_ref` is a cross-cutting registration with a hub.

Inside a docs root:

```
mage/
├── INDEX.md              # GENERATED — the always-loaded index of notes
├── _index.<wing>.md      # GENERATED per-wing index (hierarchical mode)
├── notes/                # durable topic notes (the encyclopedia)
├── work/<slug>/          # task-scoped work units (artifacts/ git-ignored)
├── decisions/            # ADR-style decision notes
├── archive/              # retired notes
└── metadata.json
```

## C. Read order (before non-trivial work)

1. **`<docs-root>/INDEX.md` FIRST** — one line per note (type · title · keywords
   · → link). This tells you what exists. Open only what the task touches.
2. For a relevant wing, open its `_index.<wing>.md` (hierarchical) then the
   specific notes; follow their `[text](path.md)` links.
3. Skim `<docs-root>/decisions/` for governing decisions.
4. Hub-level (if external or `hub_refs[]`): the hub's `IDENTITY.md` + hub-level
   `notes/`.

Don't read everything — navigate from the INDEX to the few notes that matter.

## D. Staleness — treat notes as point-in-time

A note records what was true when written. Before relying on one:

- If `status: stale-suspect` / `superseded`, or `last_reviewed` /
  `provenance.commit` looks old relative to the code, **verify it against the
  current code/source before asserting it.**
- If you confirm it's still true, you may bump `last_reviewed`. If it's wrong,
  supersede it (mark the old `status: superseded`, link the replacement) and
  suggest `/mage-learn` to capture the correction. The danger is
  confidently-wrong memory — verify, don't blindly trust.

## E. Capture-by-pointer

When you learn something durable (an interface detail, a gotcha, how services
couple, a faster path to a source), capture the **insight + procedure +
pointers** — not a copy of the source. Use `/mage-learn`. `sources:` holds
URLs / tickets / `file:line`; snapshot into `work/<slug>/artifacts/` only when a
source is fragile. Goal: do it faster / fewer mistakes next time.

## F. Conventions (the schema layer)

See `CONVENTIONS.md` for the full spec. Essentials:

- **Links:** standard markdown `[text](relative/path.md)` ONLY — never
  `[[wikilinks]]`. They render as Obsidian graph edges and stay portable.
- **Tags:** `#<wing>/<room>` — wing = project/repo/service/person, room = topic.
- **Relations:** a `## Relations` section with typed links
  (`- depends_on [x](x.md)`).
- **Types** (open vocab): interface, tooling, topology, relationship, playbook,
  gotcha, pointer, trail, decision, spec, plan, tasks, principle.

After editing notes, run `mage index` (refresh INDEX) and, if a new wing
appeared, `mage skills` (refresh per-wing skills). Both are deterministic.

## G. Commit hygiene (HARD RULE)

**Never run `git add` / `commit` / `push` autonomously.** Suggest the commands;
the user runs them. Pick the right repo by where the file physically lives:

| File location | Commit to |
|---------------|-----------|
| Code repo's `mage/` (in-repo or hybrid) | the code repo |
| `<hub>/projects/<project>/mage/` (hub-owned) | the hub repo (`git -C <hub> …`) |
| Hub root `notes/`, `decisions/`, `INDEX.md`, `IDENTITY.md`, `archive/` | the hub repo |

`artifacts/` and `.learnings/` are git-ignored by design — don't try to commit them.

## H. Proactive suggestions (be conservative)

After substantive work, **suggest** (don't author unless asked):

- a new/updated note via `/mage-learn` if you learned something reusable;
- a `decision` note if a non-obvious technical choice was made;
- `status: stale-suspect` on a note you found to be drifting from the code.

Phrase as: "Worth capturing? I'd `/mage-learn` a `<type>` note tagged
`#<wing>/<room>`: <2–3 line summary>." Then wait for direction.

## Reference: metadata.json

Code-repo side (`<repo>/mage/metadata.json`):

```jsonc
{
  "schema": "mage.v1",
  "mode": "in-repo",                 // or "external"
  "project": "my-api",
  "hub_path": null,                  // set when external OR hub_refs non-empty
  "hub_repo": null,
  "hub_refs": [],                    // hybrid: [{ hub_path, hub_repo, project }]
  "linked_at": "ISO-8601"
}
```

Hub side (`<hub>/metadata.json`, at the root): `{ schema, name, created_at, projects: [{ name, storage, code_repo_path, code_repo_url }] }`.
