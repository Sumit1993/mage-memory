---
type: decision
tags: [mage/decisions]
created: "2026-06-09"
updated: "2026-06-09"
last_reviewed: "2026-06-09"
status: active
provenance:
  repo: mage-memory
  work: grill-0.0.9-readiness
sources:
  - src/commands/doctor.ts
  - src/grooming/proposals.ts
  - src/paths.ts
---

# 0020 — the dashboard: a per-KB, no-server generated view (Option D)

A 2026-06-09 grill (0.0.9 *readiness*) settled how mage shows a knowledge base to a
human — its knowledge stats **and** the self-grooming proposal queue — without
betraying the files-as-truth / no-server thesis ([ADR-0001](0001-memory-first-product-supersedes-specshub.md),
[ADR-0009](0009-no-runtime-automation-rides-host-hooks.md)). It was researched against
agentmemory's server-backed React viewer (`:3113`) and Obsidian's own renderers
(Dataview needs 3 community plugins; Bases is core but can read only note frontmatter,
never the gitignored `.metrics/*.json`). This **supersedes** the
[mining-map](../notes/agentmemory-mining-map.md)'s earlier line ("dashboards = Obsidian
plugins later, not mage-generated markdown") — generated **HTML** is the better answer.

## Decision

1. **The dashboard is a per-KB *generated artifact*, never a server.** Three tiers, each
   data source routed to the renderer that fits: (0) a portable static `Dashboard.md`
   (core, any markdown viewer, carries a `last_refreshed` stamp — the honest baseline,
   drifts until regenerated); (1) a `Knowledge.base` for the **frontmatter** half (Obsidian
   *core*, no community plugin, live); and **the centerpiece (2): a self-contained
   `mage dashboard --html` → `dashboard.html`** (inline data + CSS/SVG, opens in any
   browser, no plugins, shareable). The Dataview "wow" pack is **dropped from core**
   (community-source it) — Option D delivers the cool factor without plugin lock-in.

2. **It is a curator's *cockpit*, not a live console.** Its hero is the **proposal queue**
   ("Awaiting your judgment" — graduate / note / merge / split / reword, each *Confirm ·
   Skip*, **nothing written until the human says so, nothing committed ever**). This is
   mage's inversion of agentmemory's automatic, server-shaped viewer — *mine the idea, not
   the mechanism* ([ADR-0007](0007-mine-agentmemory-design-not-depend.md)). The dashboard
   reflects mage's model: the **durability ladder** scratch → note → skill (nothing
   auto-deleted; git + `archive/`), recurrence-gated, plus health/provenance — **not**
   agentmemory's 4 decay tiers or a glamorized live stream of the gitignored scratch.
   Built to **age**: human-approval is the current mandate, not a permanent law; as the
   accept-rate proves out and autonomy rungs activate ([ADR-0019](0019-mage-promote-self-grooming.md),
   [ADR-0016](0016-context-match-confidence-ladder-applier.md)), the queue **thins** toward
   "auto-applied — review the diff", but **never-auto-commit stays the floor**.

3. **Interactivity is client-side + an Obsidian bridge — no server in core.** Click-to-view,
   tabs, filter, graph-select all run in-browser from data embedded at generate-time. The
   full *live, editable* "click a node → open the md" experience already exists — it **is
   Obsidian** (the vault is the store); the dashboard deep-links into it (`obsidian://open?…`).
   Two tools, one click between them.

4. **Per-KB, local files only.** mage renders only what is checked out — it never fetches
   remote content. A **hub** dashboard may show the **registry** (project names, repo URLs,
   clone/open deep-links) for members it has *not* cloned, but **never their live
   content/graph** ([ADR-0012](0012-wings-optional-convention-standalone-hubs.md) §2:
   registry-pointer awareness, never cross-repo graph merge). A non-local KB → `git clone`
   → then view (a `mage clone <registry-entry>` convenience is optional).

5. **The renderer is KB-directory-agnostic** (takes a KB dir as input, not cwd-hardwired) so
   the *same* code runs locally now and server-side later. **`mage dashboard --serve`**
   (live data + web write-back + stream) and a **hosted mage / online hub** are **deferred
   past 0.1.0, out-of-core** — separate products on the same files+git substrate
   (*git-for-knowledge → GitHub-for-knowledge*; hosting N independent KBs is not the
   cross-repo aggregation [ADR-0010](0010-durable-memory-not-coordination-layer.md)/0012
   reject). Core stays offline/no-server; Option D's generator + the deferred `--serve` are
   the *seeds* of any future hosted offering.

6. **Two dashboards, split by what they read.** The **knowledge** dashboard (over *tracked*
   notes) may be committed; the **soak/grooming** dashboard (over the gitignored
   `.metrics/*.json` — tallies, proposals, graduation candidates) is itself **gitignored**,
   honoring *metrics never enter git* ([ADR-0019](0019-mage-promote-self-grooming.md)).

## Considered and rejected

- **Dataview pack as the core dashboard** — forces 3 community plugins on every user,
  breaking "works in vanilla Obsidian / any viewer." Demoted to optional/community.
- **Static markdown only** — portable but *drifts*; insufficient as the marketing artifact
  and can't be interactive. Kept only as the lowest-common-denominator baseline.
- **An in-core server/daemon for a live UI** — breaks the no-server thesis, and the
  interactivity it buys is already provided by Obsidian (live, editable). Deferred to an
  opt-in out-of-core `--serve`.

## Relations

- mines [ADR-0007 — mine agentmemory's design, don't depend](0007-mine-agentmemory-design-not-depend.md)
- bounded_by [ADR-0010 — durable memory, not a coordination layer](0010-durable-memory-not-coordination-layer.md)
- bounded_by [ADR-0012 — wings optional; standalone hubs](0012-wings-optional-convention-standalone-hubs.md)
- surfaces [ADR-0019 — mage promote: self-grooming](0019-mage-promote-self-grooming.md)
- offline_with [ADR-0021 — mage stays offline; no telemetry](0021-offline-no-telemetry-local-signal.md)
- supersedes_line [agentmemory mining map](../notes/agentmemory-mining-map.md)
- sequenced_in [release sequence — 0.0.9](../notes/plan-release-sequence.md)
