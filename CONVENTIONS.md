# mage conventions

The schema layer for **mage** notes. This is the shared reference for humans and
AI agents writing into a mage knowledge base. mage stores durable, git-backed
markdown **notes** — distilled insight, procedure, and pointers to canonical
sources — navigable as an Obsidian graph and usable by any coding agent.

**Guiding rule: every field is optional.** A note is valid as plain markdown
with no frontmatter at all (graceful degradation). The conventions below make a
note *richer* — better indexed, better linked, better grouped — but mage never
rejects a note for omitting them.

---

## 1. Note frontmatter schema

Optional YAML frontmatter at the top of any `.md` note. Unknown keys are
preserved verbatim across read/write, so you can add your own.

```yaml
---
type: gotcha                       # open vocab; default "note" (see §6)
tags: [billing/payments]           # #wing/room scoping, stored WITHOUT the '#'
created: 2026-06-01                # ISO date
updated: 2026-06-01                # ISO date
last_reviewed: 2026-06-01          # cheap staleness signal
status: active                     # active | stale-suspect | superseded | archived
provenance:                        # where this note was distilled from
  repo: my-api
  commit: 0ad0e99
  work: stripe-webhook-retries     # the work/<slug> this came from
sources:                           # POINTERS to canonical sources — never copies
  - https://stripe.com/docs/webhooks#retry-logic
  - JIRA-4821
  - src/billing/webhook.ts:142
keywords: [webhook, idempotency, retry, stripe]   # optional; index falls back to title+headers+tags
---
```

| Field | Type | Purpose |
|-------|------|---------|
| `type` | string | Note category from the open vocabulary (§6). Default `note`. Never enforced. |
| `tags` | string[] | `wing/room` scoping (§4). Stored without leading `#`. First tag drives wing/room derivation. |
| `created` / `updated` | ISO date | Lifecycle timestamps. |
| `last_reviewed` | ISO date | When a human/agent last confirmed the note still holds. Drives staleness review. |
| `status` | enum | `active` (default if absent), `stale-suspect`, `superseded`, `archived`. |
| `provenance` | object | `{ repo, commit, work }` — the context this note was distilled from, for re-verification. |
| `sources` | string[] | Pointers to canonical sources: `url`, `ticket`, or `file:line`. The heart of capture-by-pointer (§5). |
| `keywords` | string[] | Optional search hints. When present, used verbatim by the index; otherwise the index derives keywords from title + headers + tag rooms. |

**`status` tracks lifecycle, not implementation.** For a `decision` (ADR),
`status: active` means the decision is *in force* — **not** that the work it
implies is done; track outstanding work in the roadmap / work units and link to
it. A decision stays `active` until a later one **supersedes** it: when you add
a `supersedes` / `superseded_by` relation (§3), flip the superseded note's
`status: superseded` in the **same edit** — or annotate inline for a *partial*
supersession, where only one claim is replaced and the note otherwise stands.

Graceful degradation in practice: omit everything and the note still indexes
(by H1 title, headers, and tags), still links, and still renders in Obsidian.
Add fields only where they earn their keep.

---

## 2. Portable links (the most important rule)

Link between notes with **standard relative markdown links only**:

```markdown
See [payments webhook flow](billing/payments.md) for the retry contract.
```

**Never use `[[wikilinks]]`.** Two reasons:

1. **Obsidian graph edges** — relative markdown links render as real edges in
   the Obsidian graph, so the knowledge base is navigable visually.
2. **Cross-agent portability** — `[text](path.md)` is plain markdown that every
   agent (Claude, Cursor, Codex, plain `grep`) and every renderer understands.
   `[[wikilinks]]` are Obsidian-proprietary and break the moment the vault
   leaves Obsidian.

Link hygiene:

- Paths are **relative to the linking note**, e.g. `../decisions/adr-0004.md`.
- **URL-encode spaces** as `%20`: `[old note](legacy%20billing.md)`. Better:
  avoid spaces in filenames entirely — prefer `kebab-case.md`.
- **Avoid `#`, `|`, `^`, `:` in filenames** — they collide with markdown
  anchors, table syntax, Obsidian block refs, and Windows path rules.

---

## 3. Typed relations (`## Relations`)

Plain inline links say "these are related". For *typed* edges (this note
**depends on** that one), add a `## Relations` section of typed bullet links:

```markdown
## Relations

- depends_on [payments service](billing/payments.md)
- breaks_on [stripe API v2 migration](../decisions/adr-0012-stripe-v2.md)
- calls [webhook verifier](billing/webhook-verify.md)
- owns [retry queue topology](infra/retry-queue.md)
```

Convention: `- <relation> [text](relative/path.md)`. Relation verbs are open
vocabulary — common ones: `depends_on`, `breaks_on`, `calls`, `owns`,
`supersedes`, `superseded_by`, `see_also`. The links are ordinary markdown, so
they still appear as Obsidian graph edges; the verb adds machine-readable intent.

---

## 4. `#wing/room` nested tags

Tags use a two-level scope that drives grouping everywhere in mage:

- **WING** = the top-level scope = first tag segment. A project, repo, service,
  or person. e.g. `billing`.
- **ROOM** = a topic within that wing = second segment. e.g. `payments`.

```yaml
tags: [billing/payments]    # wing = "billing", room = "payments"
```

The **first tag** determines a note's primary wing and room (mage derives these
deterministically). What this drives:

- **Index grouping** — `mage index` groups notes by wing in `INDEX.md`, and in
  hierarchical mode emits per-wing `_index.<wing>.md` files.
- **Per-wing skills** — `mage skills` generates a `mage-wing-<x>` awareness
  skill per wing, so an agent entering a wing gets that wing's context.
- **Obsidian color groups** — each wing gets a stable, distinct graph color via
  a `tag:#<wing>` query (which also matches nested `#<wing>/<room>` tags).

Tags are stored **without** the leading `#` in frontmatter (`billing/payments`,
not `#billing/payments`). The `#` form is how they read inside Obsidian.

**Folders are conventions, not constraints.** A note's wing and room come from
its **first tag, not its file path** — a note can live **anywhere** in the
knowledge base and still group correctly. `mage index`, `mage skills`, and
`mage dream` **recurse the whole tree** and index every `.md` except a fixed
skip-set: `.obsidian/`, `.git/`, `node_modules/`, `artifacts/`, `.learnings/`,
`archive/`, and mage's own generated/scaffolding files (`INDEX.md`,
`_index.*.md`, `AGENTS.md`, `CLAUDE.md`, `IDENTITY.md`). So `notes/`,
`decisions/`, and `work/` are *recommended* homes, not magic — a note in a
custom dir, or in a hub's `projects/<name>/`, indexes just the same. `archive/`
is intentionally skipped (use `status: archived` to retire a note in place); the
rest of the directory layout is a human convenience, not a rule the tooling
enforces. Hub layout + projects-as-wings: see ADR-0011
(`mage/decisions/0011-recursive-scan-hub-projects.md`).

**Wings are optional, and a note can have several.** Tagging is never required —
an untagged note is valid and indexes under *Cross-cutting* (reach for a wing only
when a base spans more than one scope). The **first** tag is the primary wing
(drives color + ownership); a note is indexed under **every** wing it is tagged
with (multi-home, matching Obsidian's own tag semantics). See ADR-0012
(`mage/decisions/0012-wings-optional-convention-standalone-hubs.md`).

---

## 5. Capture-by-pointer (core principle)

A mage note is **not** a copy of what you read. It is the *residue* of doing
work — the part worth keeping so the next run is faster and makes fewer
mistakes. Three ingredients:

1. **Insight** — the reusable understanding, captured **verbatim**, don't
   oversimplify. The non-obvious thing you learned (e.g. "Stripe retries
   webhooks with the *same* event id for 3 days, so the handler must be
   idempotent on `event.id`, not request time").
2. **Procedure** — how to do it faster next time. Include the **bad commands /
   dead ends to avoid and *why*** (e.g. "don't dedupe on `created` — clock skew
   across retries breaks it").
3. **Pointers** (`sources:`) — *where* the canonical source lives and *when* to
   go back to it: `url`, `ticket`, or `file:line`. The note points at truth; it
   does not duplicate truth.

> **Never copy a source into a note.** Link to it. The only exception: when a
> source is **fragile** (a flaky URL, a doc that will be deleted, generated
> output you can't regenerate cheaply), snapshot it into the owning work unit's
> `work/<slug>/artifacts/` directory and point `sources:` at the snapshot.

Litmus test before saving: *"Does this help me do it faster or avoid a mistake
next time?"* If it's just an archive of what you read, it doesn't belong.

---

## 6. Note-type vocabulary

`type` is open vocabulary — invent your own where it helps. Suggested set:

| `type` | One-liner |
|--------|-----------|
| `interface` | The shape/contract of an API, module, or boundary. |
| `tooling` | How to run/configure a tool, command, or dev workflow. |
| `topology` | How systems, services, or data are laid out and connected. |
| `relationship` | How two or more things interact or depend on each other. |
| `playbook` | A repeatable procedure to accomplish a recurring task. |
| `gotcha` | A trap, footgun, or surprising behavior and how to avoid it. |
| `pointer` | A thin note whose value is mostly its `sources:` links. |
| `trail` | A breadcrumb/navigation note that routes to other notes. |
| `decision` | An ADR-style record of a choice and its rationale. |
| `spec` | A specification of intended behavior. |
| `plan` | A forward-looking plan of work. |
| `tasks` | A concrete task list / checklist. |
| `principle` | A durable rule or value the system holds to. |
| `note` | Default — anything that doesn't fit a sharper type. |

---

## 7. Work units (`work/<slug>/`)

A work unit is a task-scoped **lab notebook** under `mage/work/<slug>/`, with a
frontmatter `type` such as `spec`, `investigation`, `incident`, or `spike`. It's
where messy, in-progress thinking lives during a task. When the work settles,
the durable insight gets **distilled** into one or more notes under
`mage/notes/` (and `provenance.work` points back at the slug).

- `work/<slug>/artifacts/` is **git-ignored** and is the durable home for
  generated or downloaded material — snapshots, dumps, captures, scratch output.
- **Never use `/tmp`** for material you might need later; it does not survive.
  `artifacts/` is the correct scratch home and travels with the work unit.

---

## 8. How `mage index` and `mage skills` consume this

- **`mage index`** recursively scans every note (skipping the skip-set in §4),
  reads frontmatter, and emits a generated, always-loaded `INDEX.md` (and
  per-wing `_index.<wing>.md` in hierarchical mode). It groups by **wing** (first
  tag), surfaces each note's title, type, status, and **keywords** — using
  `keywords:` verbatim when present, otherwise deriving them from the H1 title +
  `##` headers + tag rooms. Generated files are **never hand-edited**; re-run
  `mage index`. In a **hub**, a project's notes live in `projects/<name>/` and
  index as the `<name>` **wing**; its per-project index is the hub-root
  `_index.<name>.md`, decorated from the registry with the code-repo pointer
  (ADR-0011).
- **`mage skills`** generates a `mage-wing-<x>` awareness skill per wing, so an
  agent working in that wing automatically loads the right slice of the base.
- **Obsidian** colors the graph one hue per wing via a `tag:#<wing>` query, and
  relative-markdown links (inline + `## Relations`) become the graph's edges.

Good frontmatter + portable links + `#wing/room` tags = a base that indexes
itself, colors itself, and routes agents to the right context for free.

---

## 9. Skill naming & distribution

mage's **hand-authored static skills ship as a Claude Code plugin** (marketplace
`mage`, manifest in `.claude-plugin/`). The plugin namespace does the grouping, so
each skill's `name:` stays **bare** and the harness presents it as `mage:<name>` —
clean names, no `mage-` baked into each one (see [ADR-0013](mage/decisions/0013-procedure-skills-self-grooming-loop.md)):

| Installed as | Skill | Source |
|---|---|---|
| `mage:learn` | capture a durable note | plugin (`skills/learn/`) |
| `mage:guide` | how to use the knowledge base | plugin (`skills/guide/`) |
| `mage:specify` · `mage:clarify` · `mage:plan` · `mage:tasks` · `mage:implement` · `mage:analyze` · `mage:constitution` | the spec-driven-development workflow | plugin (`skills/<phase>/`) |
| `mage-wing-<wing>` | per-wing awareness skill | **generated** by `mage skills` into `.claude/skills/` + `.agents/skills/` |
| `mage-skill-<slug>` | **Procedure skill** (a graduated Playbook/Gotcha note) | **generated** on graduate |

Install the static group with `/plugin marketplace add Sumit1993/mage-memory` then
`/plugin install mage@mage`; `mage init` prints these (user-driven — mage never runs
slash commands). **Generated** per-repo skills keep a `mage-wing-*` / `mage-skill-*`
prefix because they are written into a bare skills dir with no plugin namespace to
group them.

**Portability caveat:** the `mage:` namespace is **Claude-Code-only**. Agents that
read `.agents/skills/` directly see bare names and could collide with same-named
skills from other tools — the namespace protects you inside Claude Code, not outside it.

---

## 10. Command tiers (what humans type vs what machinery invokes)

mage's CLI is one binary but **three tiers**, sorted by the deterministic/judgment line
([ADR-0009](mage/decisions/0009-no-runtime-automation-rides-host-hooks.md)): a hook may
*fire* a deterministic command or *nudge* a judgment skill, but **never reasons itself**.

| Tier | Commands | Invoked by | Notes |
|---|---|---|---|
| **Hook-fired** (plumbing seams) | `observe`, `skills --metrics --quiet` (Stop rollup fold), `index --if-changed`, `skills`, `verify --check`, `redact --check` | host hooks · git pre-commit · the graduate skill | Deterministic. **Users never type these.** They are commands only because hooks/skills/git reach mage across a process boundary. |
| **Judgment — nudged** | `learn`, `dream`, (future) `promote`, `optimize` | the agent, *nudged* by a hook | The hook prints a nudge; the **agent** reasons. Never blindly auto-run. |
| **Human verbs** | `init`, `connect`, `disconnect`, `skills --metrics` (read-only report), `doctor`, `status`, `list`, `link`, `unlink` | a person | Setup + read-only queries + judgment-invoked mutations. |

**Guardrails (all tiers):**
- **Never auto-commit.** Hook-fired `index`/`skills`/`verify` *write* files (auto-write
  is allowed, [ADR-0013](mage/decisions/0013-procedure-skills-self-grooming-loop.md) §4);
  the human always commits the diff. The `Stop` metrics fold writes only the gitignored
  `mage/.metrics/` cache (ADR-0016 §2) — never the catalog, never a commit.
- **Double-observe is tolerated, not policed** *(amended, [ADR-0017](mage/decisions/0017-mage-connect-host-hook-adapter.md) §5)*:
  mage and a host's own observer (e.g. ECC homunculus) may coexist — separate files,
  separate consumers, zero added cost. Consolidate via the feeder path (ingest ECC), not
  by disabling it. `mage connect` fully ignores it.
- **Batch, don't spam:** accumulate changed note-paths during a turn; run `mage index`
  **once at `Stop`**, not after every edit.
- **async + short timeout** on every non-blocking hook, so mage never stalls the turn.

**Interactivity (all human verbs):** dual-mode via a shared `resolveInteractive(opts)`.
**Non-TTY ⇒ non-interactive**; each decision resolves to an explicit flag or a documented
safe default, else **fail with a message naming the flag** — never hang, never silently
guess a consequential choice. So `mage connect --yes` runs in one go (agents); bare
`mage connect` prompts (humans). Applies to `init`/`link`/`unlink`/`connect`/`disconnect`.

**`mage connect` / `mage disconnect`** ([ADR-0017](mage/decisions/0017-mage-connect-host-hook-adapter.md), 0.0.6):
because mage ships as an npm `bin`, the wired hook lines are clean one-liners (`mage observe`)
— no plugin-root resolution. connect writes the hook block to **`.claude/settings.local.json`**
(per-repo, gitignored; `--user` for `~/.claude/settings.json`), `id:"mage:*"`-prefixed;
re-running is idempotent (replace-by-id), malformed JSON is refused (never clobbered), and
a `.bak` is written first. `mage disconnect` removes only the `mage:*` entries.

There is **no `mage clean`** — `.learnings/` rotation + purge are internal to `mage observe`.

---

## Example note

Path: `mage/notes/billing/stripe-webhook-idempotency.md`

```markdown
---
type: gotcha
tags: [billing/payments]
created: 2026-06-01
updated: 2026-06-01
last_reviewed: 2026-06-01
status: active
provenance:
  repo: my-api
  commit: 0ad0e99
  work: stripe-webhook-retries
sources:
  - https://stripe.com/docs/webhooks#retry-logic
  - JIRA-4821
  - src/billing/webhook.ts:142
keywords: [webhook, idempotency, retry, stripe, event-id]
---

# Stripe webhook idempotency

## Insight
Stripe retries a failed webhook with the **same `event.id`** for up to 3 days
(exponential backoff). The handler MUST be idempotent keyed on `event.id` —
treat a duplicate `event.id` as already-processed and return 200.

## Procedure
- Persist processed `event.id`s; short-circuit duplicates before any side effect.
- Return 2xx fast; do real work async. A slow 200 still triggers retries.

### Avoid
- ❌ Dedupe on `event.created` or request arrival time — clock skew across
  retries makes the same logical event look new. Use `event.id` only.
- ❌ Returning 500 on an already-handled event — it re-queues the retry storm.

## Relations
- depends_on [webhook signature verify](webhook-verify.md)
- breaks_on [stripe API v2 migration](../decisions/adr-0012-stripe-v2.md)
- owns [retry queue topology](../infra/retry-queue.md)

## Sources
Canonical retry semantics: see `sources:` above. Go back to the Stripe docs
when the backoff window or `event` shape changes; check `webhook.ts:142` for
the current idempotency guard.
```
