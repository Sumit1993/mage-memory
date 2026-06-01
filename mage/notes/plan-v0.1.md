---
type: plan
tags: [mage/plan]
created: "2026-05-29"
updated: "2026-06-01"
last_reviewed: "2026-06-01"
status: archived
provenance:
  repo: mage-memory
  commit: 1ec8225
sources:
  - https://github.com/Sumit1993/specshub
keywords: [plan, milestones, fork, vault, note-model, index, skills, v0.1, build]
---

# mage v0.1 — detailed implementation plan

_v0.1 shipped at commit `1ec8225` — all eight milestones (A–H) are done. This plan is kept as the historical build record; the naming authority is [plan-v0.1-locks](plan-v0.1-locks.md)._

> Scope: [roadmap](roadmap.md) (v0.1). Decisions: [ADR-0001](../decisions/0001-memory-first-product-supersedes-specshub.md)–[0006](../decisions/0006-two-layer-recall-per-wing-skills.md). Language: [context & glossary](context.md). Forks specshub (`https://github.com/Sumit1993/specshub`) per [ADR-0002](../decisions/0002-fork-and-reorient-specshub.md).
> Source facts confirmed against specshub: `src/{paths,init,gitignore,git,shell,logger,index}.ts`, `src/commands/{verify,doctor,list,status,link,unlink}.ts`, `plugin/`.

## 0. Principles & what carries unchanged
- **Carry as-is** (works, already memory-shaped): `shell.ts`, `logger.ts`, `git.ts` (getRemoteOriginUrl/gitInit/hasGh/hasGit — no auto-commit), the commander CLI scaffolding, the modes (in-repo/external/hybrid), the hub registry shape (`HubMetadata`/`HubProject`), commit-hygiene philosophy (suggest, never run).
- **Reorient**: `paths.ts` constants/schema, `init.ts` scaffolding, the awareness skill, `verify`/`doctor`/`link` structural assumptions, the SDD skills' write target.
- **Add**: note model + frontmatter, `mage index` (hierarchical INDEX generator), `learn` skill, per-wing skill generation, `.obsidian/` scaffold, AGENTS.md+CLAUDE.md shim, capture-by-pointer conventions, cheap staleness fields.
- **Drop**: `cross-refs/` as a dir (ADR-0006 §12a — relationships are notes/edges); spec-era "SDD is the center" framing.
- **New dep**: `gray-matter` (frontmatter read/write). Everything else stays (commander/ora/picocolors/tar/@inquirer/prompts).

---

## Milestone A — Repo bootstrap & rename
**Goal:** a building, renamed `mage` repo forked from specshub.

A1. **Fork (clean copy, fresh history)** [ADR-0002]: copy `https://github.com/Sumit1993/specshub` → new repo dir (e.g. `~/mage`), `rm -rf .git`, `git init`, first commit. Do NOT carry specshub git history.
A2. **`package.json`**: name `specshub`→`mage`; reset version `0.0.1`; bin `specshub`→`mage`; description → "Portable, self-maintaining knowledge base for software systems"; homepage/repository → mage URLs; keep keywords (incl. `obsidian`, `knowledge-base`); add `gray-matter` dep. Update `src/cli.ts` `.name("mage")` + `.version("0.0.1")` + command description.
A3. **`src/paths.ts` constants/schema** (load-bearing rename):
  - `META_DIR ".specshub"` → `".mage"`; `METADATA_SCHEMA "specshub.v1"` → `"mage.v1"`.
  - **Remove** `CROSS_REFS_DIR`. **Add** `NOTES_DIR="notes"`, `WORK_DIR="work"`, `DECISIONS_DIR="decisions"`, `INDEX_FILE="INDEX.md"`, `LEARNINGS_DIR=".learnings"`, `ARTIFACTS_DIRNAME="artifacts"`, `OBSIDIAN_DIR=".obsidian"`. Keep `ARCHIVE_DIR`, `PROJECTS_DIR`, `AGENTS_FILE`, `CLAUDE_FILE`, `GITIGNORE_FILE`.
  - Rename type `DocsHubMetadata` → `KnowgraphMetadata` (keep fields: schema/mode/project/hub_path/hub_repo/hub_refs/linked_at). Keep `HubRef`/`HubMetadata`/`HubProject`.
  - `looksLikeHub()` currently requires `projects/` + `cross-refs/`. Change to require `projects/` + presence of `metadata.json` (cross-refs gone).
A4. **Global rename sweep**: `specshub`→`mage` across `src/**`, error messages, the `npx skills add github:Sumit1993/specshub` references (→ mage repo), `doctor.ts` strings. Update `src/index.ts` exported type name.
**Accept:** `pnpm build` green; `node dist/cli.js --help` shows `mage`; existing tests updated to new constants compile.

---

## Milestone B — Vault model & scaffolding
**Goal:** `mage init` scaffolds a valid Obsidian-vault knowledge base in the new layout.

B1. **In-repo vault layout** (`initInRepo` in `init.ts`): scaffold under `.mage/`:
  ```
  .mage/{ metadata.json, INDEX.md, notes/.gitkeep, work/.gitkeep,
               decisions/.gitkeep, archive/.gitkeep, .obsidian/{app,graph,appearance}.json }
  ```
  (`.learnings/` created lazily by `/learn`; `work/<slug>/artifacts/` lazily.) Write a seed `INDEX.md` ("GENERATED — run `mage index`"). Keep metadata write (new schema).
B2. **External hub layout** (`scaffoldHubStructure`): hub root gets `{ metadata.json (registry), INDEX.md, IDENTITY.md, notes/, archive/, projects/, .obsidian/ }`. **Remove `cross-refs/` scaffolding.** (Decide MAP.md fate — see Open Q.) Per-project dir = `projects/<name>/.mage/{notes/,work/,decisions/,archive/,INDEX.md}`.
B3. **`.gitignore`** (via `ensureGitignored`): add patterns `.mage/**/artifacts/` and `.mage/.learnings/` (in-repo); for hub, `**/artifacts/` + `.learnings/` [ADR-0003]. Confirm `ensureGitignored` handles glob lines (it appends literal lines — fine).
B4. **`.obsidian/` config writer** (new `src/obsidian.ts`): emit minimal `app.json`, `graph.json` (group colors keyed on `tag:#wing/*`), `appearance.json`. Hand-written JSON, no dep. Makes the vault open with a sensible graph.
B5. **AGENTS.md + CLAUDE.md shim** (new `src/agents-md.ts`, called by init) [reverses specshub's old "no preamble" stance]: write a minimal `AGENTS.md` at repo/hub root — "this repo has a mage KB at `.mage/`; read `INDEX.md` first; consult before non-trivial work; capture findings with `/mage:learn`; commit hygiene" — plus `CLAUDE.md` containing `@AGENTS.md`. Generated/regenerable (a view). *(Consider mage ADR-0007 to record the reversal.)*
**Accept:** `mage init --in-repo` produces a folder that opens cleanly in Obsidian; `git status` shows artifacts/.learnings ignored; AGENTS.md+CLAUDE.md present.

---

## Milestone C — Note model & conventions
**Goal:** a documented, parseable note format; the SDD flow writes into `work/`.

C1. **Frontmatter schema** (`src/note.ts`, using gray-matter) — all optional, graceful [Q5]:
  ```yaml
  type: interface            # suggested open vocab; default "note"
  tags: [billing/payments]   # #wing/room scoping
  created: / updated:        # dates (tooling-managed)
  provenance: { repo, commit, work }   # for staleness/re-verify
  sources: [url|ticket|file:line]      # POINTERS, not copies [ADR-0004]
  status: active             # active|stale-suspect|superseded|archived
  last_reviewed:             # cheap staleness signal
  keywords: [..]             # optional; index falls back to H1+headers+tags
  # relationship-type only: breaks_on, contract_anchors, owners
  ```
  Provide `readNote(path)`, `writeNote(path, fm, body)`, `noteWing(fm)` (first tag segment). Required = nothing; recommended = `type` + one tag.
C2. **Conventions doc** (`plugin/skills/_shared/CONVENTIONS.md` or in awareness body): portable `[text](path.md)` links (never `[[wikilinks]]`); typed relations `- depends_on [x](x.md)` in a `## Relations` section; `#wing/room` tags; capture-by-pointer; note types (interface/tooling/topology/relationship/playbook/gotcha/pointer/trail/decision/spec…). This is the "schema layer."
C3. **SDD skills → `work/`**: `specify/plan/tasks/analyze/implement/clarify/constitution` write to `work/<feature>/` (type=spec) instead of `specs/<feature>/`. Update each skill's path-resolution preamble + prune "SDD is the center" framing. Constitution stays at `.mage/.specify/memory/` OR move to a `principle` note — decide (Open Q).
**Accept:** a hand-written note + a `/specify`-produced spec both parse via `readNote`; relations render as edges in Obsidian.

---

## Milestone D — `mage index` (hierarchical INDEX generator)
**Goal:** the always-loaded closet, regenerated deterministically (zero-LLM) [ADR-0006/Q13].

D1. **New command** `src/commands/index-cmd.ts` + wire into `cli.ts` as `mage index`.
D2. **Algorithm:**
  1. Resolve docs root (reuse paths resolution).
  2. Walk `notes/` (+ `decisions/`, + `work/*/` top-level note for work-unit entries) recursively.
  3. For each note: `readNote` → derive `wing` (first tag segment), `room`, `title` (H1 or filename), `keywords` (frontmatter `keywords` else H1+`##`headers+tags), `type`, `status`, `last_reviewed`.
  4. Build closet line: `[type] <title> | <keywords> | → <relpath> (status · reviewed <date>)`.
  5. **Root `INDEX.md`**: list wings (gist + note count) + cross-cutting (untagged/system) notes; link each wing to its per-wing index.
  6. **Per-wing index** `notes/_index.<wing>.md` (or `<wing>/_index.md`): that wing's closet lines, grouped by room.
  7. All generated files start with `<!-- GENERATED by mage index — do not edit -->`; overwrite idempotently.
D3. **Bounded root**: if a system is small (≤ N wings, ≤ M notes) emit a single flat INDEX (no per-wing files); go hierarchical past the threshold. (Threshold = Open Q; default flat→hierarchical at ~1 screen.)
**Accept:** golden-file test: a fixture vault → deterministic INDEX output; re-run = no diff; root stays under ~200 lines as wings scale.

---

## Milestone E — Skills (awareness, learn, per-wing) + plugin conformance
**Goal:** the procedural layer + open-standard packaging.

E1. **Awareness skill rewrite** (`plugin/skills/mage/SKILL.md`, auto-invoke): detection (`.mage/metadata.json`); **read order = `INDEX.md` first** → relevant notes → decisions; capture-by-pointer principle; **staleness handling** (treat notes as point-in-time; verify `status: stale-suspect`/old `last_reviewed` against current code before asserting); commit hygiene (carry the repo-picker table, swap `cross-refs/`→`notes/`); scope routing by wing; the conventions (C2).
E2. **`learn` skill** (`plugin/skills/learn/SKILL.md`, user-explicit) [Q9]: modes `/learn "<finding>"` and `/learn` (scan current work unit); draft note (frontmatter + portable links + `sources:` + provenance); **overlap-check** by reading `INDEX.md` for same topic/keywords → UPDATE vs NEW; **human-confirm**; write to `notes/`; suggest `mage index` + the commit. (`disable-model-invocation: true` for v0.1 — deliberate.)
E3. **Per-wing skill generation** [ADR-0006 — trickiest piece] (`mage skills sync`, or fold into `index`): discover wings from tags → generate `mage-wing-<x>/SKILL.md` (auto-load metadata: "knowledge + procedures for the <x> wing"; body: pointer to the wing index + its `playbook`/`gotcha` notes) into **project-local `.claude/skills/` and `.agents/skills/`** (broadest coverage; mark GENERATED). Note multi-dir expansion (`.cursor/skills`, `.agent/skills`) as a v0.1 stretch.
E4. **open-plugin-spec conformance** (backlog #6): create `plugin/.plugin/plugin.json` (+ mirror `plugin/.claude-plugin/plugin.json`); fix manifest — `name: "mage"`, `author` → object, **drop** the `skills:[{name,path}]` array (use default `skills/` discovery), keep `skills/` at plugin root. Update the static skill set: `mage` (awareness), `learn`, + carried SDD skills; remove stale ones.
**Accept:** `npx skills add <mage>` installs awareness+learn+SDD; a 2-wing fixture generates 2 wing skills whose metadata is loadable.

---

## Milestone F — Carried commands reorient
F1. **`verify.ts`**: hub structural checks `[PROJECTS_DIR, ARCHIVE_DIR]` (drop `CROSS_REFS_DIR`); add `notes/` + `INDEX.md` presence checks; keep Zone.Identifier + registry cross-check.
F2. **`doctor.ts`**: rename strings; keep node/git/npx/gh/`npx skills`/github checks; add an `INDEX.md fresh?` advisory (compare mtimes of notes vs INDEX) — optional.
F3. **`link.ts`/`unlink.ts`/`list.ts`/`status.ts`**: rename + new schema; `link` auto-detect uses updated `looksLikeHub`.
F4. **Prune** spec-era language in all command output + help.
**Accept:** `mage verify` passes on a scaffolded hub; `link`/`list`/`status` work against the new layout.

---

## Milestone G — Tests (vitest, throughout)
- `paths`/schema constants; `note` read/write round-trip; `init` scaffolding (asserts the new dir set + gitignore lines + .obsidian + AGENTS.md); `index` golden-file (flat + hierarchical); `link` auto-detect; `verify` checks; gitignore idempotency.
- Target: keep specshub's existing test rigor; add index + note as the new-surface focus.

## Milestone H — Pre-release
H1. npm: `npm deprecate specshub "succeeded by mage"` (full `unpublish` only if within 72h); archive specshub GitHub repo + README pointer.
H2. Verify `mage` name at publish (similarity filter); `npm publish` v0.1.
H3. Migrate `~/ai-context/mage/{CONTEXT.md,decisions/,ROADMAP.md,PLAN-v0.1.md}` into the new repo's `.mage/` (dogfood: mage documents itself).

---

## Sequencing
`A → B → C → D` is the critical path (bootstrap → vault → notes → index = a usable KB). `E` depends on C/D (skills reference notes/index). `F` can parallel C–E. `G` continuous. `H` last.
**Earliest dogfoodable slice:** A+B+D+E1 (init a vault, hand-write notes, generate INDEX, awareness skill reads it) — usable before `/learn` (E2) and per-wing skills (E3).

## Open implementation questions (decide at build time)
1. Keyword-extraction heuristic specifics (stopwords, max count).
2. Per-wing skill **multi-dir targeting** + how regeneration avoids clobbering hand-edits (GENERATED marker + a `mage-` prefix).
3. `gray-matter` vs hand-rolled frontmatter (recommend gray-matter).
4. **MAP.md** fate — generate a topology view, or drop for v0.1 (lean: drop; the graph + INDEX cover it).
5. Constitution — stay at `.specify/memory/constitution.md` (carried) or become a `principle` note (cleaner; small migration).
6. Flat→hierarchical INDEX threshold.
7. AGENTS.md exact wording (the portable navigation contract).
8. Repo location/name for the fork dir (`~/mage`?).

## Explicitly NOT in v0.1 (per ROADMAP)
Full `/dream` sweep (only cheap read-time staleness + on-write overlap ship) · auto-capture observe-loop · note↔skill promotion engine · homunculus harvest · MCP · multi-repo graph aggregation + cross-repo `/dream`.

## Relations
- implements [mage roadmap](roadmap.md)
- governed_by [mage v0.1 locks (naming authority)](plan-v0.1-locks.md)
- forks_per [ADR-0002 — fork and reorient specshub](../decisions/0002-fork-and-reorient-specshub.md)
