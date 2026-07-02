---
type: decision
tags:
  - mage/decisions
created: "2026-06-27"
updated: 2026-07-01
last_reviewed: 2026-07-01
status: accepted
provenance:
  repo: mage-memory
  work: adr-0034-adopt-preexisting-knowledge
sources:
  - decisions/0032-capture-redirect-native-memory.md
  - decisions/0033-recall-import-bounded-index.md
  - decisions/0031-programmatic-provenance-stamp.md
  - decisions/0030-agent-autonomy-ladder.md
  - decisions/0013-procedure-skills-self-grooming-loop.md
  - decisions/0005-one-canonical-memory-others-are-feeders.md
  - https://code.claude.com/docs/en/memory
  - cc-session:3c5c8534-8611-4d9d-9087-9975da48dd44
keywords:
  - adopt
  - onboard
  - dispatcher
  - place
  - distill
  - in-shape
  - out-of-shape
  - never-a-copy
  - preexisting
  - native-memory
  - learn-from
  - routing
  - transcript-cwd
  - scrub-at-adopt
  - unclaimed
  - connect-prompt
---

# 0034 — Adopt: a dispatcher for onboarding pre-existing knowledge

> **Status: accepted (ratified 2026-07-01 — impl on `main`, dogfooded, riding 0.0.12).** Output of the 2026-06-27 grill ([grill-with-docs]), which reshaped a
> CC-memory-specific strawman into a general **onboarding dispatcher**. The *backfill* third to
> [ADR-0032](0032-capture-redirect-native-memory.md) (capture, going forward) and
> [ADR-0033](0033-recall-import-bounded-index.md) (recall). A one-time hand-migration of 13 memories
> on 2026-06-27 is its first cohort and motivating evidence.

## Context

ADR-0032 commandeers native memory **going forward**; nothing handles what already exists. Two facts
make that a real gap, and the grill widened the problem past Claude Code:

1. **Claude Code orphans a real corpus on connect.** CC stores memory keyed by **launch cwd** at
   `~/.claude/projects/<cwd-slug>/memory/*.md`; `mage connect` redirects the future and strands the
   past. Wiring two soaks orphaned **13** durable code-repo memories, with more scattered across
   sibling cwds — one logical project smears across the org-root, hub, and code-repo cwds.
2. **The need is broader than CC memories.** A user also arrives with *their own* notes, a foreign
   vault, another tool's docs. "Bring in what I already have" is one intent with many sources.

But mage already has a verb for part of this — **`mage learn --from <dir>`**, which **distills**
existing docs into notes (`skills/learn`: *"insight + procedure + pointers — never a copy of the
source"*, the founding principle of [ADR-0005](0005-one-canonical-memory-others-are-feeders.md)).
Copying a source verbatim is the anti-pattern mage exists to prevent. So onboarding must split by
**shape**, not by source — which is what this ADR specifies.

## Decision

1. **Adopt is a front-end to the existing inbox, not a new pipeline.** Onboarded content is just
   *captures that predate the hook*: it lands in the capture inbox (the docs-root top, ADR-0032) and
   flows through the **existing** ingest → `.mage/staging/` → `groom` → `notes/`. Adopt writes no new
   downstream machinery; it adds **discovery + routing**, which is the only genuinely new work.

2. **It is a dispatcher: place in-shape, distill out-of-shape.** A single front-door inspects each
   source and routes it, because the "never a copy" principle forbids importing a source verbatim:
   - **in-shape** (already an authored note) → **place** into the inbox (→ a draft);
   - **out-of-shape** (raw prose, a foreign schema) → hand to **`mage learn --from`** to **distill**
     the insight. Adopt never reinvents distillation.

3. **The dispatch test** — deterministic and fail-safe:
   - **in-shape signal** = `metadata.node_type: memory` (CC native) **or** authored mage
     note-frontmatter (a `type:` in mage's note vocab). Both mean "someone authored this as a note,"
     not "this is a source document."
   - **default = distill.** No positive signal → distill (it can never violate "never a copy"). **Fail
     toward distill.**
   - **per-file, not per-dir** — a folder mixing `node_type: memory` files and a freeform
     `meeting-notes.md` routes each on its own shape.
   - **shape is the axis; quality is groom's.** A bloated-but-authored note still places; `groom`
     trims/splits/rejects it. The classifier stays a pure shape test.

4. **Routing — by origin, scoped to the KB you're in.**
   - **Resolve by transcript cwd, not the slug.** `<slug>` is a lossy path encoding; adopt reads each
     CC memory dir's true origin cwd from its session transcript, then `resolveDocsRoot(cwd)`
     ([paths.ts](../../src/paths.ts)) → the target KB.
   - **A real mage KB is not adopt — it's `link`/migrate.** Adopt refuses a source that carries its
     own `metadata.json` and redirects. Adopt is for **loose** material only.
   - **Per-KB by default.** `mage adopt` run from a KB (or its code repo) adopts only the memories
     whose origin resolves to **this** KB; memories belonging elsewhere are *reported*
     ("3 belong to `sreforge`; run adopt there"), and **unclaimed** ones (origin resolves to no KB)
     are reported too — **never dropped or guessed**. `--all` opts into a whole-machine sweep.

5. **Safety.**
   - **Scrub at adopt.** These predate Gate-0 and were never scrubbed; adopt runs the redactor as each
     file lands — **secrets masked before disk**, **PII kept-but-flagged** (Gate-0's capture-time
     policy, not Gate-2's block). A real secret never sits unscrubbed even briefly.
   - **Copy, never move.** CC's originals stay intact but dormant (CC now loads only
     `autoMemoryDirectory`), so adopt is non-destructive and re-runnable.
   - **Idempotent.** Each placed memory is stamped `sources: [cc-session:<uuid>]` (ADR-0031
     provenance), so re-running adopt skips what's already in — the existing cc-session dedup.

6. **Surface — `mage adopt`, with `connect` as the prompt.**
   - **`mage adopt`** is a standalone, **re-runnable** command that **shows the plan first** (what it
     would place, distill, report-elsewhere, leave unclaimed) and confirms before acting (`--dry-run`
     stops at the plan; `--yes` skips the confirm). Re-runnable matters: weeks later, more sessions =
     more orphans.
   - **`mage connect` asks.** On first commandeer it detects this KB's orphaned memories and, *when
     interactive*, prompts: "Found N — adopt now? (or run `mage adopt` later)." **Non-interactive
     connect never auto-adopts** — it prints the nudge only. No surprise writes (ADR-0013: nothing is
     real until you accept + commit).

7. **Commandeer-coverage — connect consumes adopt's discovery so it stops stranding siblings.**
   The 2026-06-27 soak wiring exposed the root cause directly: `mage connect` redirects future capture
   for the **single cwd it runs in**, but CC keys memory by launch cwd, so one logical project smears
   across many cwds (org-root, hub, code-repo). Connecting one strands the rest — both their *past*
   memories (the adopt gap above) and their *future* writes (still landing in CC's per-cwd dir, never
   commandeered). The fix is not new machinery: **connect and adopt ask the same question** —
   "which cwds' memory dirs resolve to *this* KB?" — so connect reuses adopt's discovery.
   - **After wiring, connect reports the coverage map.** Discovery resolves every
     `~/.claude/projects/*/memory/` origin cwd via `resolveDocsRoot`; connect surfaces the siblings
     that land on this KB: "M cwds map to this KB — 1 commandeered (here), Y not yet (`mage connect`
     there), and N orphaned memories across them (`mage adopt`)." It **flags and offers; it never
     reaches into another cwd's settings** — each cwd's `settings.local.json` is that cwd's to wire
     (interactive may offer; non-interactive prints only).
   - **Distinct from `connect --all-projects`.** That existing sweep fans out over a hub's
     *registered* `projects[].code_repo_path` (a mage-metadata fact). Commandeer-coverage fans out
     over CC's *cwd-keyed memory dirs* (a Claude-Code fact) — they overlap but neither subsumes the
     other (a code repo can be registered yet never have run CC; a CC cwd can be unregistered).
     Coverage discovery is the union view; the two fan-outs stay separate verbs.

## Gate

- **Yield at groom** — same crown as ADR-0030/0032: the live reject-ledger. **KILL** if adopted
  memories are mostly groom-rejected as noise, or if routing **mis-files** a memory into the wrong KB
  even once (a correctness bug, not a yield question).
- **First cohort:** the 13 hand-adopted on 2026-06-27 — their keep-rate at groom is the first datapoint.

## Consequences

- Commandeering becomes a clean **cutover** — the future redirected *and* the past folded in — instead
  of a forward-only redirect that strands prior knowledge.
- **Coverage is legible, not silent.** Connecting one cwd no longer quietly leaves sibling cwds writing
  to un-commandeered CC dirs; connect names them (clause 7), so the user can wire the rest deliberately
  instead of discovering the gap weeks later (exactly how the 2026-06-27 soak missed the hubs).
- One **shape rule** serves every source (CC memory, a user's notes, a foreign vault) without ever
  letting a verbatim-copy path in the back door; new in-shape sources opt in by registering a
  detector + mapper.
- Unclaimed/elsewhere memories are **surfaced, not lost**, but need a human to aim them.
- The one-time manual adoption of 13 (2026-06-27) is the stand-in until this ships.

## Open questions

- **Cross-cwd / cross-session duplication.** The same lesson can be captured under several cwds or
  sessions; dedup keys on `cc-session` (origin), not content, so near-duplicates would both adopt.
  Content-similarity dedup is out of scope here — push it to groom?
- **Provenance for non-CC sources.** A user's own note has no `cc-session`; stamp an `adopted-from:
  <path>` marker so re-adoption stays idempotent?
- **No-KB origins.** Memories whose origin resolves to no KB — leave reported-only, or offer to
  `init`/`link` that cwd and adopt into it?

## Relations

- companion [ADR-0032 — capture-redirect into the git-durable pipeline](0032-capture-redirect-native-memory.md) (forward channel; adopt backfills the same inbox)
- companion [ADR-0033 — recall: `@import` the bounded root index](0033-recall-import-bounded-index.md) (recall channel)
- builds_on [ADR-0031 — provenance stamp at creation](0031-programmatic-provenance-stamp.md) (placed memories carry `cc-session` provenance)
- reuses [ADR-0013 — procedure skills & the self-grooming loop](0013-procedure-skills-self-grooming-loop.md) (`learn --from` is the distill arm; nothing real until accept)
- constrained_by [ADR-0005 — one canonical memory, others are feeders](0005-one-canonical-memory-others-are-feeders.md) (the "never a copy" principle that forces the place/distill split)
- surfaced_by [ADR-0030 — opt-in grooming autonomy ladder](0030-agent-autonomy-ladder.md) (the soak whose wiring exposed the orphaning)
