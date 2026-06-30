---
type: plan
tags: [mage/roadmap, mage/future-thoughts]
created: "2026-06-21"
updated: "2026-06-22"
last_reviewed: "2026-06-22"
status: active
provenance:
  repo: mage-memory
  commit: aad31f0
keywords: [future-thoughts, backlog, ideas, inbox, taxonomy, hierarchy, wings, dashboard, graph, leiden, graphify, ingest, querying, export, agent-rules, use-cases]
---

# mage — future thoughts (the standing idea inbox)

The **one durable home for raw ideas and open questions** about where mage goes
next — across every release, not pinned to one. The [roadmap](roadmap.md) says
*what is in scope*; the [release sequence](plan-release-sequence.md) says *when it
ships*; the [decisions](../decisions/) say *what was decided*. This note is the
stage **before** all three: where a thought lands the moment it occurs, before it
has earned a grill, an ADR, or a release slot.

> Why one file: ideas captured as scattered version-named notes (`post-0.1.0-…`,
> `post-0.2-…`) go stale and get lost the instant their version ships. A single
> append-only inbox stays current forever — a thought from any era lives here
> until it is decided, deferred, or dropped.

## The standard — how to use this file

**Capture.** New idea → add an entry at the bottom of its theme (or open a new
theme). Give it the **next free `FT-NN` id** — ids are *append-only and never
reused*, so cross-references stay stable even after status changes.

**Lifecycle.** Each entry carries a **Status** that tracks its journey out of this
inbox. The flow mirrors mage's own promote/graduate language:

| Status | Meaning | Canonical home once there |
|---|---|---|
| `raw` | just captured, not yet examined | here |
| `exploring` | actively being thought through / grilled | here |
| `promoted` | earned a decision **and/or** a release slot | the [ADR](../decisions/) + [release sequence](plan-release-sequence.md) row (link them; entry here becomes a pointer) |
| `deferred` | consciously parked for later | the "Deferred past 0.1.0" section of [roadmap](roadmap.md) / [release sequence](plan-release-sequence.md) |
| `rejected` | decided against | the ADR that rejected it (if any) |

An idea is **never edited away** — when it leaves the inbox, flip its Status, add
the link to its new home, and leave the entry as a breadcrumb. The inbox is the
audit trail of *what we thought about*, not just *what we shipped*.

**Track relationships (required).** Every entry records two relation lines so the
graph stays navigable:

- **Touches:** the ADR(s) the idea bears on — even just "relates to", not only
  "decided by". Use `[ADR-00NN](../decisions/00NN-…md)`.
- **Sequence:** where it sits relative to the [release sequence](plan-release-sequence.md)
  — a shipped row it extends, a deferred bucket it belongs in, or `unsequenced`.

**Entry template:**

```markdown
### FT-NN — <short title>  ·  (orig #N)
**Status:** raw
**Touches:** [ADR-00NN](../decisions/00NN-….md)
**Sequence:** unsequenced
<the thought, in the author's own framing — kept faithful, lightly tightened>
**mage angle:** <one line: the open question, the tension, or the obvious next step>
```

`(orig #N)` is optional provenance for the founding batch below (the 2026-06-21
brain-dump). New entries can drop it.

---

## Founding batch — 2026-06-21 brain-dump

Sixteen thoughts captured in one sitting after the 0.1.0 path locked. All `raw`
unless noted. Grouped by theme; original dump-numbers preserved as `(orig #N)`.

### Theme A — navigation & taxonomy at scale (the "notes go flat" problem)

The recurring worry: notes + wings work for a small project, but past a threshold
the note set goes **flat and hard to navigate**. These five circle that.

#### FT-01 — a home for one-time, decided-and-done activities · (orig #1)
**Status:** raw
**Touches:** [ADR-0019 — mage promote/demote](../decisions/0019-mage-promote-self-grooming.md)
**Sequence:** unsequenced
How should we organize ideas that are **one-time activities** — decided, done, and
safe to forget — versus long-term decisions? Should we even build for this, given
we already have a **demote** path? Note this is about a **usage pattern**, not the
app's internals — analogous to how Next.js gives you app-vs-pages *routing*, and
then there's the convention a user settles on for organizing their site *after*
that choice. This is that second, conventions layer.
**mage angle:** likely not a new feature — demote + an archive/`status: archived`
convention may already cover it. Open question: does "done & forgettable" deserve a
distinct status/room, or is it just `archived`?

#### FT-02 — categorize skills & notes: general vs domain vs human · (orig #5)
**Status:** raw
**Touches:** [ADR-0006 — two-layer recall / per-wing skills](../decisions/0006-two-layer-recall-per-wing-skills.md)
**Sequence:** unsequenced
Need a way to categorize skills and notes by **scope**: some are *general*, some
*domain-specific*, some *human-specific* (one person's habits/preferences). Today
wings categorize by domain only.
**mage angle:** a second classification axis (scope) orthogonal to the wing
(domain) axis — could be a tag namespace (`scope/general` · `scope/domain` ·
`scope/human`) rather than new machinery.

#### FT-03 — hierarchical skills vs wings: are they the same thing? · (orig #6)
**Status:** exploring
**Touches:** [ADR-0006 — per-wing skills](../decisions/0006-two-layer-recall-per-wing-skills.md), [ADR-0019 — promote](../decisions/0019-mage-promote-self-grooming.md), [ADR-0012 — wings optional](../decisions/0012-wings-optional-convention-standalone-hubs.md)
**Sequence:** extends 0.0.8 self-grooming (graduation)
I have a repo with **20+ domain skills in groups of 2–3 per domain**, yet only one
wing — I never saw a relationship between "many skills" and "one wing", which is
why I asked for a **promote** mechanism (note → skill). But then I started thinking
about **hierarchical skills**: decomposing each domain group into separate skill
files with a parent "domain group" skill pointing at them. That pattern is *exactly*
wings-as-skills. **Am I confusing two things that are actually the same?**
**mage angle:** strong hunch — yes, these collapse. "Hierarchical skill group →
member files" *is* the wing → per-wing-skill structure ([ADR-0006](../decisions/0006-two-layer-recall-per-wing-skills.md)).
Resolve before building anything: is "hierarchical skills" a new feature or just
applying wings + promote to a skill-heavy repo? Likely the latter.

#### FT-04 — fight note-pileup with examples, templates & grouping nudges · (orig #13, #15)
**Status:** raw
**Touches:** [ADR-0006 — per-wing skills](../decisions/0006-two-layer-recall-per-wing-skills.md), [ADR-0004 — capture insight, not copies](../decisions/0004-capture-insight-not-copies.md)
**Sequence:** unsequenced (0.1.0 credibility-push adjacent)
From experience: notes + wings are fine for a new/small project, but for a large
enough KB notes **pile up, look flat, and get hard to read/navigate**. Provide
**examples / good practices**: ordinary examples *or* template git repos showing
good patterns — naming/wing conventions, grouping via folders or name prefixes.
Also explore **skills about these grouping practices**, and **nudging the agent**
to apply them based on tool results. Use-case-driven examples.
**mage angle:** the core scaling story. Three shippable pieces: (a) a docs/examples
gallery of well-shaped KBs, (b) a grouping-advisor that the host agent fires when
`mage index` shows a wing crossing a flatness threshold, and (c) **pre-generated
template wings** for generic patterns *(orig #15, folded in)* — seed notes a user
drops in; `mage index`/`mage skills` regenerate the wing index + auto-loaded wing
skill. The "SDLC/SDD" framing there was illustrative, *not* a call to undo
[ADR-0022](../decisions/0022-remove-sdd-skills.md) (that removed workflow skills;
these are loop-native notes) — ADR-0022 only re-enters if a template ships SDD
*content* **and** advertises it.

#### FT-05 — pre-generated template wings for generic patterns · (orig #15)
**Status:** raw · **merged → FT-04**
Breadcrumb only (inbox ids are append-only, never reused). This was a concrete form of
FT-04's examples — pre-generated *template wings* (seed notes) for generic patterns,
SDLC/SDD illustrative. The full thought + the ADR-0022 caveat now live in **FT-04 (c)**.

### Theme B — dashboard & graph

#### FT-06 — run internal commands from the dashboard · (orig #2)
**Status:** raw
**Touches:** [ADR-0020 — no-server tiered dashboards](../decisions/0020-no-server-tiered-dashboards.md)
**Sequence:** extends 0.0.9 dashboard (Option D)
Let the dashboard **run** internal commands, not just **show** the commands a user
*may* run.
**mage angle:** ⚠️ collides with the no-server constraint ([ADR-0020](../decisions/0020-no-server-tiered-dashboards.md)):
the dashboard is a static `dashboard.html` with no backend, so it cannot execute
CLI commands directly. This needs the deferred `--serve` / hosted-mage rung, or a
copy-to-clipboard / deep-link-to-terminal half-measure. Grill the boundary.

#### FT-07 — Leiden community detection on the dashboard graph · (orig #8)
**Status:** raw
**Touches:** [ADR-0020 — dashboards](../decisions/0020-no-server-tiered-dashboards.md)
**Sequence:** extends 0.0.9 dashboard
Should we run something like the **Leiden algorithm** (as Graphify uses) over our
graph on the dashboard, to auto-detect note communities/clusters?
**mage angle:** could auto-suggest wings/rooms from link structure — directly feeds
FT-04 (grouping) and FT-02 (categorization). Client-side only, to respect no-server.

#### FT-08 — evaluate Graphify / "understand anything"; overlap & threat · (orig #7)
**Status:** raw
**Touches:** [ADR-0007 — mine agentmemory's design, don't depend](../decisions/0007-mine-agentmemory-design-not-depend.md), [ADR-0021 — offline, no telemetry](../decisions/0021-offline-no-telemetry-local-signal.md)
**Sequence:** 0.1.0 credibility-push (mage-evals / differences)
Should we integrate with — or learn from — something like **Graphify** / "understand
anything"? **How much do we overlap? Do they defeat our purpose by being bigger and
better?**
**mage angle:** a positioning question, not a feature. Frame the same way the
release sequence frames agentmemory: *mine the design, state the differences*
(offline, file-as-truth, in-repo, agent-native), don't depend. Output is a comparison
+ a sharpened wedge, possibly feeding the mage-evals benchmark.

#### FT-09 — export to HTML / JSON / Obsidian (Graphify-style) · (orig #9)
**Status:** raw
**Touches:** [ADR-0008 — visible .mage dir for Obsidian](../decisions/0008-visible-mage-dir-for-obsidian.md), [ADR-0020 — dashboards](../decisions/0020-no-server-tiered-dashboards.md)
**Sequence:** extends 0.0.9 dashboard tiers
We already ship **Obsidian integration ~out of the box**. I like how Graphify has
an **export** function for HTML, JSON, and Obsidian.
**mage angle:** we have the Obsidian + `dashboard.html` tiers already; the gap is a
**structured `mage export --json`** (the graph as portable data) for external tools.
Cheap, on-brand (file-as-truth), and complements FT-12 (queryable) and FT-08.

#### FT-17 — dashboard interactivity ceiling → React? · (soak 2026-06-23)
**Status:** raw
**Touches:** [ADR-0020 — no-server tiered dashboards](../decisions/0020-no-server-tiered-dashboards.md)
**Sequence:** revisits the 0.0.9 dashboard (Option D, the interactive cockpit)
The generated `dashboard.html` keeps hitting an interactivity wall in real use: the graph
renders as a static "big circle" (no hover/click affordances, no per-node-type colors), the
per-page cards feel inert, and repeated asks for animations / modern CSS went unmet — reaching
the point of **considering a switch to React** for the cockpit.
**mage angle:** ⚠️ tensions with [ADR-0020](../decisions/0020-no-server-tiered-dashboards.md)'s
no-server / no-build / single-file stance — a React cockpit implies a build step + bundle. Open
question: can vanilla HTML+CSS+SVG (hover handlers, type-keyed node colors, light animation) reach
"good enough", or must the top tier break the no-build rule? Cheap win regardless: **color graph
nodes by note type** + basic hover highlight.

### Theme C — ingest & external knowledge

#### FT-10 — ingest external KBs, rough notes, domain skills · (orig #3)
**Status:** raw
**Touches:** [ADR-0004 — capture insight, not copies](../decisions/0004-capture-insight-not-copies.md), [ADR-0005 — one canonical memory; others feed](../decisions/0005-one-canonical-memory-others-are-feeders.md)
**Sequence:** extends 0.0.4 (`mage learn --from` ingest)
Allow **ingesting external KBs**, or a user's **rough notes / ideas / domain skills**
they already have.
**mage angle:** partially built — `mage learn --from` already ingests skills/prose
(0.0.4). Open scope: *rough/unstructured* notes and *whole external KBs* (vs single
sources), distilled to insight-not-copies per [ADR-0004](../decisions/0004-capture-insight-not-copies.md).

#### FT-11 — hybrid: in-repo KBs for A & B + an external KB about A+B together · (orig #11)
**Status:** exploring  (author note: **answered — yes, supported**)
**Touches:** [ADR-0012 — wings optional; standalone hubs](../decisions/0012-wings-optional-convention-standalone-hubs.md), [ADR-0023 — hub owns notes; flat projects](../decisions/0023-hub-own-notes-and-flat-projects.md), [ADR-0010 — durable memory, not coordination](../decisions/0010-durable-memory-not-coordination-layer.md)
**Sequence:** unsequenced (existing hybrid capability)
Does the mage **hybrid architecture** allow: service A and service B each keep an
**in-repo KB**, *and* a separate **external KB** holds knowledge about working with
**A and B together**? — **Yes.**
**mage angle:** this is exactly the hub/standalone-hub model ([ADR-0012](../decisions/0012-wings-optional-convention-standalone-hubs.md)
/ [ADR-0023](../decisions/0023-hub-own-notes-and-flat-projects.md)) — the cross-cutting
KB federates the two repo KBs via registry pointers, *without* merging graphs
(bounded by [ADR-0010](../decisions/0010-durable-memory-not-coordination-layer.md)).
Mostly a **docs/example** need (FT-04), not new machinery.

#### FT-12 — a guided-authoring skill for the manual (no-chokepoint) note path · (orig #16)
**Status:** exploring
**Touches:** [ADR-0013 — procedure skills + self-grooming loop](../decisions/0013-procedure-skills-self-grooming-loop.md), [ADR-0030 — agent autonomy ladder](../decisions/0030-agent-autonomy-ladder.md)
**Sequence:** unsequenced — lands **on top of** the forthcoming central frontmatter-builder (ADR-0031)
Provide a skill that helps a human (or agent) **hand-author** a note or skill the mage
way — guided authoring, distinct from the automated capture loop. The sharpened framing
(2026-06-22): mage writes notes through **two paths that need different enforcement
levers**. The **automated path** (`mage:learn` / `mage:groom` capture → `composeDraft` →
the dream applier) has a **code chokepoint**, so conventions there belong in code — the
writer stamps frontmatter + provenance *itself*, with no skill to forget (this is the
central **frontmatter-builder**, the forthcoming ADR-0031). The **manual path** — someone
opening an editor and typing a `notes/*.md` by hand — has **no chokepoint to hook**, so a
**skill is the only lever**: it walks the author through frontmatter, pointer-not-copy, and
relations.
**mage angle:** build it as the *manual-path twin* of the programmatic builder, sharing
**one** helper — the skill invokes a `mage new-note` / scaffold command that calls the
**same** `buildNoteFrontmatter` the automated writers use, so both paths emit byte-identical
conventions. This is the *right* home for the "programmatic + skill" marriage, **precisely
because** the manual path has no other enforcement point — whereas the automated path must
**not** route its stamp through a skill (that re-introduces the "agent forgets" failure
[ADR-0030](../decisions/0030-agent-autonomy-ladder.md) exists to kill). Pairs with FT-04's
examples.

### Theme D — cost-aware docs & querying

#### FT-13 — be token-mindful when updating docs (reduce, don't just append) · (orig #4)
**Status:** raw
**Touches:** [ADR-0004 — capture insight, not copies](../decisions/0004-capture-insight-not-copies.md)
**Sequence:** unsequenced (grooming-quality)
Be **mindful when updating docs** — every user pays the token cost. A redirect/update
should **delete or reduce** the old text, not just append "here's what changed". The
KB is a **git repo**, so persistence is handled and **data loss is low-risk** — lean
toward pruning.
**mage angle:** a principle for the grooming applier and `mage:learn` — favor
*replace/shrink* over *append*; git is the undo. Could become a `principle` note in
its own right, and a lint/nudge in the dream sweep.

#### FT-14 — make markdown files queryable (less context to fetch) · (orig #12)
**Status:** raw
**Touches:** [ADR-0010 — not a coordination layer](../decisions/0010-durable-memory-not-coordination-layer.md)
**Sequence:** relates to deferred **MCP recall accelerator** + "no-vector-in-core"
Can we make the markdown files **queryable** — something to lessen the context an
agent has to fetch?
**mage angle:** directly intersects the **MCP-recall** decision: file-based recall
(INDEX + grep) was judged to already cover file-capable agents, and "no-vector-in-core"
bounds us off a semantic service. A *local query layer* (structured frontmatter
query / `mage query`) that doesn't become a service is the open lane — and it pairs
with FT-09's `--json` export.

#### FT-15 - add observability/telemetry of memories
**Status:** raw
**Sequence:** unsequenced
Today mage does not track or trace its impact on the agent and the context window. We need to track how much we push into the context.
Are we bloating it, are we optimizing future references.
**mage angle:** to be added by agent

### Theme E — agent integration & use cases

#### FT-15 — AI agent rules (distinct from skills) · (orig #10)
**Status:** raw
**Touches:** [ADR-0006 — two-layer recall](../decisions/0006-two-layer-recall-per-wing-skills.md), [ADR-0013 — procedure skills](../decisions/0013-procedure-skills-self-grooming-loop.md)
**Sequence:** unsequenced
Look at **AI agent rules** — something *different* from skills (e.g. always-on
constraints / project rules vs invokable procedures).
**mage angle:** clarify the taxonomy — note → skill (procedure) → **rule** (standing
constraint)? mage already generates AGENTS.md (the navigation contract); "rules"
might be a third generated artifact, or just the always-on inline-capture instruction
generalized.

#### FT-16 — KB-driven code review / debugging · (orig #14)
**Status:** raw
**Touches:** [ADR-0013 — procedure skills + self-grooming loop](../decisions/0013-procedure-skills-self-grooming-loop.md)
**Sequence:** unsequenced (use-case track)
A use case: **code review / debugging driven by the KB** — the agent reviews or
debugs against the captured gotchas/playbooks/decisions.
**mage angle:** a flagship *consumption* use case (most of mage so far is *capture*).
The gotcha/decision notes are exactly what a reviewer should load first; could ship
as an example skill that wires the KB into a review/debug flow.

---

## Relations

- inbox_for [mage roadmap](roadmap.md)
- staged_into [release sequence (0.0.x → 0.1.0)](plan-release-sequence.md)
- bounded_by [ADR-0010 — durable memory, not a coordination layer](../decisions/0010-durable-memory-not-coordination-layer.md)
- promotes_via [ADR-0019 — mage promote: self-grooming](../decisions/0019-mage-promote-self-grooming.md)
- recall_model [ADR-0006 — two-layer recall, per-wing skills](../decisions/0006-two-layer-recall-per-wing-skills.md)
- dashboard_bound [ADR-0020 — no-server tiered dashboards](../decisions/0020-no-server-tiered-dashboards.md)
- caveat_for [ADR-0022 — SDD skills removed](../decisions/0022-remove-sdd-skills.md) (FT-04 (c): template wings are notes, not the removed workflow skills)
