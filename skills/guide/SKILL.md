---
name: guide
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
- **Present** → note `mode`, `project`, `hub_repo`, `hub_path`, `hub_refs`.

A **hub** is a repo whose root has `projects/` + a top-level `metadata.json`;
there the hub root itself is the knowledge base.

## B. Path resolution — where the knowledge base lives

| `mode` | Docs root |
|--------|-----------|
| `in-repo`  | `<code-repo>/mage/` |
| `external` | `<hub root>/projects/<project>/` |

The hub root itself (ADR-0043) is **derived from `hub_repo`** — one deterministic
location per remote, at `~/.mage/hubs/<host>/<owner>/<repo>` (`$MAGE_HOME/hubs`
when set) — never read off a recorded path. `hub_path` is a deprecated fallback,
used only when `hub_repo` is absent or doesn't resolve.

Hybrid (mode=in-repo with non-empty `hub_refs[]`): docs root is the in-repo
`mage/`; each `hub_ref` is a cross-cutting registration with a hub.

Inside a docs root:

```
mage/
├── INDEX.md              # GENERATED — the full index of memory-genre notes (the pull surface)
├── MEMORY.md             # GENERATED — the budget-bounded recall roster the host auto-loads (the push surface)
├── _index.<wing>.md      # GENERATED per-wing index (hierarchical mode)
├── notes/                # durable topic notes (the encyclopedia)
├── work/<slug>/          # task-scoped work units & home for plans/specs/task lists (artifacts/ git-ignored)
├── decisions/            # ADR-style decision notes
├── archive/              # retired notes
└── metadata.json
```

## C. Read order (before non-trivial work)

1. **`<docs-root>/INDEX.md` FIRST** — one line per **memory-genre** note (type ·
   title · keywords · → link). This is the *pull* surface: it tells you
   everything that exists. Open only what the task touches. Do NOT stop at
   what your session already auto-loaded — `MEMORY.md` is the *push* surface
   and is deliberately truncated to a top-K roster that fits the host's budget,
   ending in an overflow line back to `INDEX.md`. A note absent from `MEMORY.md`
   is below the rank cut, not absent from the knowledge base.
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
  suggest `/mage:learn` to capture the correction. The danger is
  confidently-wrong memory — verify, don't blindly trust.

## E. Capture-by-pointer

When you learn something durable (an interface detail, a gotcha, how services
couple, a faster path to a source), capture the **insight + procedure +
pointers** — not a copy of the source. Use `/mage:learn`. `sources:` holds
URLs / tickets / `file:line`; snapshot into `work/<slug>/artifacts/` only when a
source is fragile. Goal: do it faster / fewer mistakes next time.

## F. Conventions (the schema layer)

See `CONVENTIONS.md` for the full spec. Essentials:

- **Links:** standard markdown `[text](relative/path.md)` ONLY — never
  `[[wikilinks]]`. They render as Obsidian graph edges and stay portable.
- **Tags:** `#<wing>/<room>` — wing = project/repo/service/person, room = topic.
- **Relations:** a `## Relations` section with typed links
  (`- depends_on [x](x.md)`).
- **Genre & recall rungs (ADR-0041):** Note `type` maps to a genre that determines its recall rung — see `mage/decisions/0041-genre-decides-the-recall-rung.md`. Memory-genre notes (`gotcha`, `procedure`, `pointer`, `principle`, `feedback`, `reference`, `note`) form the recall-bearing set: every one of them lands in `INDEX.md`, and passing the genre filter makes a note *eligible* for the `MEMORY.md` roster rather than guaranteeing a slot — that roster carries only the top-K by rank (usage-proven first where local metrics exist, else recency). Non-memory genres (`decision`, `plan`, `tasks`, `spec`) are legal for storage and linking but are excluded from recall entirely — `mage/work/` is the home for plans/specs/task lists, while `mage/decisions/` holds decision records.

After editing notes, run `mage index` — it regenerates **both** recall surfaces
(`INDEX.md` and `MEMORY.md`) in one pass; never hand-edit either. At a hub root
it also fans out to regenerate each `projects/<name>/`'s own pair. If a new wing
appeared, run `mage skills` (refresh per-wing skills). Both commands are
deterministic, with one caveat: `MEMORY.md`'s roster order consults local usage
metrics, so it can order differently on another machine.

## G. Commit hygiene (HARD RULE)

**Never run `git add` / `commit` / `push` autonomously.** Suggest the commands;
the user runs them. Pick the right repo by where the file physically lives:

| File location | Commit to |
|---------------|-----------|
| Code repo's `mage/` (in-repo or hybrid) | the code repo |
| `<hub>/projects/<project>/` (hub-owned) | the hub repo (`git -C <hub> …`) |
| Hub root `notes/`, `decisions/`, `INDEX.md`, `IDENTITY.md`, `archive/` | the hub repo |

`artifacts/` and the `.mage/` state dir are git-ignored by design — don't try to commit them.

## H. Proactive suggestions (be conservative)

After substantive work, **suggest** (don't author unless asked):

- a new/updated note via `/mage:learn` if you learned something reusable;
- a `decision` note if a non-obvious technical choice was made;
- `status: stale-suspect` on a note you found to be drifting from the code.

Phrase as: "Worth capturing? I'd `/mage:learn` a `<type>` note tagged
`#<wing>/<room>`: <2–3 line summary>." Then wait for direction.

## Reference: metadata.json

Code-repo side (`<repo>/mage/metadata.json`):

```jsonc
{
  "schema": "mage.v1",
  "mode": "in-repo",                 // or "external"
  "project": "my-api",
  "hub_repo": null,                  // set when external OR hub_refs non-empty — the AUTHORITATIVE address (ADR-0043)
  "hub_path": null,                  // deprecated fallback, read only when hub_repo is absent/unresolved
  "hub_refs": [],                    // hybrid: [{ hub_repo, hub_path, project }]
  "linked_at": "ISO-8601"
}
```

Hub side (`<hub>/metadata.json`, at the root): `{ schema, name, created_at, projects: [{ name, storage, code_repo_path, code_repo_url }] }`.
