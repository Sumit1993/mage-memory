---
type: plan
tags: [mage/roadmap]
created: "2026-06-03"
updated: "2026-06-08"
last_reviewed: "2026-06-08"
status: active
provenance:
  repo: mage-memory
  work: mega-grill-skill-loop
keywords: [release, sequence, backlog, 0.1.0, self-grooming, procedure-skill, redaction, skillopt, observe, optimize, promotion]
---

# mage — release sequence (0.0.x → 0.1.0)

The [roadmap](roadmap.md) lists *what* is in scope; this note sequences it into small,
dependency-ordered releases and marks which need a design **grill** before they can be
built. The **horizon is capped at 0.1.0 — no 1.0 is crowned** (a 2026-06-05 mega-grill
decision). 0.1.0 ships the **full self-grooming loop**: portable KB · index · per-wing
skills · dream · recall **plus** capture → graduate → optimize. Detail for each item
lives in its ADR — this is the map, not a copy.

Ordering axes: **hard dependency first, then design-locked-before-grill** (ship the
concrete things cheaply; don't build a grill-gated feature until its design is locked).

## The sequence

Resequenced 2026-06-06: combined the loop's nine unshipped releases into six coherent
capabilities (ADR-0015/0016 pre-resolved the cross-cutting parts, so several artificial
splits collapsed). **Status** tracks where each release stands.

| Release | Theme | ADRs | Dep | Grill? | Status |
|---|---|---|---|---|---|
| **0.0.2** | Recursive hub scan + wings generalize | 0011, 0012 | — | locked | **shipped** |
| **0.0.3** | Skills ship as a Claude Code **plugin** (`mage:` namespace, bare names); `mage init` prints `/plugin install`; ship `skills` + `.claude-plugin` in `files[]`. **Pulled forward: Redaction Gate 2 (`mage redact`, ADR-0014) + the `mage:learn --from` skill prose** | 0013, 0014 | 0.0.2 | locked | **shipped** |
| **0.0.4** | `mage learn --from` ingest **tooling**: deterministic source enumeration, adopt-in-place skill ingest, **feeder** (ECC/native) skeleton — the runtime helpers behind the skill prose already shipped in 0.0.3 | 0013, 0005, 0004 | 0.0.3 | locked | **shipped¹** |
| **0.0.5** | **`mage observe`** → `.learnings/*.jsonl` (keystone) + **skill-load events** + **Redaction Gate 1** | 0009, 0014, 0013, 0015 | 0.0.4 | locked | **shipped** |
| **0.0.6** | **connect/disconnect** (hook adapter → `settings.local.json`, `id:"mage:*"`) + **context-match metrics, read-only** via `mage skills --metrics` + `mage/.metrics/` rollup (per-turn fold) + keyword-derivation fix | 0009, 0005, 0015, 0016, **0017** | 0.0.5 | locked | **shipped²** |
| **0.0.7** | **distill**: `mage distill --json` reader + `mage:distill` skill over `.learnings/` → notes **on first sight**; feeders **cut**; Gate-2 **pre-commit hook** via `connect` | **0018**, 0015, 0014, 0009 | 0.0.6 | **built³** | planned |
| **0.0.8** | **self-grooming**: promote-on-recurrence + **note→skill graduation** + `mage:optimize` reword/demote on context-match + the single-writer **dream applier** (graduate/demote/merge/split/reword) | **0019**, 0016, 0013, 0006 | 0.0.7 | **built⁴** | planned |
| **0.0.9** | **readiness**: **setup-integrity** (connect ensures ignores · doctor KB+connection health + `--fix`/`--report` · version-drift nudge) + the **no-server dashboard** (Option D) + **icon (graph-"m")** + pre-release chores | **0020, 0021**, 0010 | — | grilled⁵ | **built⁶** |
| **0.0.10** | **coherence**: vocabulary ADR (*every flavor is a knowledge base*; de-overload "hub") + **hub flat-vs-nested grill** → ADR + the `mage link` scaffold-consistency fix + **SDD skills removed** (the deferred ADR-0001/0002 prune) | **0022, 0023** | 0.0.9 | grilled⁷ | **shipped** |
| **0.0.11** | **signal quality + autonomous capture** (de-noise signatures · project wings · SubagentStop · bounded ranked promotion) + **release-please adoption** (first bot-managed release) + **security cleanup** (drop gray-matter→yaml; esbuild pin) + **test-typecheck gate** | 0015, 0018, 0019 | 0.0.10 | locked | **shipped⁸** |
| **0.0.12** | **organic grooming loop** — the *lesson path* (`mage stage`/`mage groom` + gitignored `.staging/` + boundary-nudge adapter via `mage connect` + always-on inline capture) + bundled **redact false-positives** fix | **0024** | 0.0.11 | grilled⁹ | **building** |
| **→ 0.1.0** | **Milestone: portable, self-grooming memory — the cut** (announced once a1 bakes) | — | all | — | — |

¹ tagged + GitHub-released; npm still at 0.0.3. · *Status legend:* **shipped · next · planned** (add `building`/`grilled`/`built` in flight).
³ 0.0.7 **built + dogfooded 2026-06-08** (473 tests; build+typecheck green). Built via a partitioned workflow (5 parallel module agents → serial integrate → adversarial review → fix). The review caught two real defects (fixed): a Gate-2 **bypass** — `scanStaged` silently skipped C-quoted non-ASCII staged filenames (fixed with `-z` NUL-split); and a **fail-closed** pre-commit hook that blocked every commit with a false "live secret" message when `mage` wasn't on PATH (fixed with a `command -v mage` guard → fail-open). **Dogfooding caught two more (fixed):** the Gate-2 **scope bug** — `scanStaged` scanned the *whole* repo and so blocked the commit on the redaction tool's own `src/` test fixtures; corrected to scope Gate-2 to the **docs root** (`mage/`) per ADR-0014 §2 (ADR-0018 §7 + [gotcha](gate2-blocks-own-redaction-fixtures.md)), which is also what lets mage run its own Gate-2 hook; and a `connect({user})` **test-isolation leak** that installed the hook into the real repo via `process.cwd()`. **Live-dogfooded**: `mage distill` over this repo's real `.learnings/` (four lenses, user-corrections first-class, caps/spills); scoped `redact --check --staged` (blocks a planted key masked-never-raw incl. a `café.md` non-ASCII path; skips `src/` fixtures); the pre-commit hook blocks a real secret commit and fails open when `mage` is absent; malformed `.learnings/` parsed fail-open. Post-build cleanup folded the low-severity review findings (empty-detail salience, strict correction-adjacency, prompts-only hint, `--seen` leading-colon guard, `--staged` positional warning, symlink-hook guard) + boundary tests.

⁴ 0.0.8 **built + dogfooded 2026-06-08** (644 tests; build+typecheck green). Built in **three verified stages via partitioned workflows** — Stage 1+2 the deterministic promote/recurrence core + `assistant_msg` capture + the single-writer applier (graduate/demote/merge/split/reword + the ceilings); Stage 3 the judgment skills (`mage:promote`/`graduate`/`optimize`) + the release. The **adversarial review caught + fixed two real defects:** a HIGH **never-hard-delete bypass** in the applier, and a **reword YAML-injection** (an unescaped trigger string could break out of the skill frontmatter). **Dogfooding caught a recurrence-fragmentation bug** — a bare filename leaked in as a wing, so one recurring pattern fragmented across pseudo-wings and never crossed the K-session threshold; fixed by requiring a wing to carry a **directory segment** (a bare filename is not a wing). **Scope honesty:** 0.0.8 ships promote/graduate/optimize **+ the applier** (graduate/demote/merge/split/reword); dream's **note-health** (stale/superseded/dangling/orphans) stays a **read-only detector** — auto-applying consolidate/prune/supersede is a **later increment, NOT in 0.0.8**.

² 0.0.6 **built + dogfooded 2026-06-07** (383 tests; connect/disconnect, read-only context-match metrics via `mage skills --metrics` + `mage/.metrics/` rollup, keyword-derivation fix). Dogfood pulled in a **redaction hardening**: a dedicated `anthropic-key` detector — `sk-ant-` keys were partially leaking past the generic high-entropy detector ([gotcha](redaction-anthropic-key-detector.md)). **Live-connected + real-hook dogfooded 2026-06-07**: the wired hooks auto-fired in a real session — `user_prompt`, `tool_use` (incl. a real `ok:false` Read failure), and a real `skill_load` (wing=mage, trigger_hash + keyword snapshot) all captured correctly; the metrics fold correctly held the `skill_load` until its forward window closes. **Carry-in RESOLVED:** a single tool failure yields exactly **one** event — Claude Code does not double-fire `PostToolUse` + `PostToolUseFailure`, so no dedup is needed. **Shipped: tagged `v0.0.6` + `npm publish` 2026-06-07.**

⁵ 0.0.9 **re-grilled 2026-06-09** and reframed from "polish" to **readiness**: its job is to make the already-shipped self-grooming loop **observable + adoptable**, and **0.1.0 becomes a code-frozen promotion gated on an observed real-data graduation** (note→skill) — proof-of-life, sensitivity dial held at `normal`, a stubborn non-graduation treated as a *bug* to investigate, not a gate to waive. The gate is watched by a **live multi-KB soak**: capture wired (`mage connect`) across **three real KBs** — this repo + `prismalens-docs-hub` + `sreforge-memory` — with a **read-only daily monitor** (cron → `~/ai-context/mage-soak/`) that folds each tally and surfaces graduation proposals but **never** applies / advances `--seen` / commits. Three **independent** per-KB soaks, reported side by side, **never aggregated** (ADR-0010/0012 bound mage out of cross-repo graph merge). Wiring the soak surfaced a real gap → the new **setup-integrity** bucket: `mage connect` turns capture on without ensuring the `.learnings/`/`.metrics/` sinks are gitignored (an **empty `.gitignore` on a *public* KB** was one `git add` from leaking), and mage has **no version-drift migration** (a stale 6/8-event hook block until re-connect). Fix = `connect` self-heals via the existing `ensureGitignored()`, and `doctor` grows from env-only to **KB+connection health** with `--fix` ([gotcha](connect-doesnt-ensure-ignores.md)). **Dashboard locked as Option D** — a per-KB, **no-server** generated `dashboard.html` (curator's *cockpit* / proposal queue, **client-side interactive + Obsidian-bridged**; portable static-MD baseline + a core `Knowledge.base`; Dataview pack dropped; `--serve` and a **hosted-mage/online-hub** future deferred out-of-core — the renderer is KB-dir-agnostic so it seeds that) — [ADR-0020](../decisions/0020-no-server-tiered-dashboards.md). **Telemetry refused** — no phone-home (a positioning win); the improvement signal is the local `.metrics/` accept/reject ladder; support export = a redacted **`mage doctor --report`** ("attach your logs") — [ADR-0021](../decisions/0021-offline-no-telemetry-local-signal.md). A **`mage-evals/`** recall benchmark (mine agentmemory's harness *shape*; honest R@K/MRR/token-cost **+** skill-fire F1 / context-match; Letta's filesystem-74%-on-LoCoMo validates the thesis) is tracked for the **~0.1.0 credibility push**, not 0.0.9. **Icon** = the graph-"m" mark (concept B — nodes+edges tracing an "m", three wing-colored feet; one SVG for README/social/plugin-icon/dashboard/favicon). **Chores** = `CHANGELOG.md` (backfill 0.0.2→0.0.8) · README/marketing pass (mark + the 1200×630 **social card committed as a repo asset** under `assets/` and embedded in the README + offline/no-telemetry positioning + agentmemory-*differences*) · version/support blurb; — note the GitHub **Settings → Social preview** image is a **manual UI upload** (no API), so the in-repo asset is shipped in 0.0.9 and the Settings upload is a one-line human step; **specshub** needs no deprecation (deleted from npm 2026-06; public footprint already clean; founding ADR-0001/0002 kept as origin history). **Grill closed 2026-06-09 — 0.0.9 is build-ready.**

⁶ 0.0.9 **built + dogfooded 2026-06-09** (709 tests; build+typecheck green). Built in **three verified stages via partitioned workflows** (file-disjoint implementers → serial integrate → adversarial code+security review → fix → dogfood). **Stage 1 — setup-integrity:** `connect` self-heals the capture-sink `.gitignore` via `ensureGitignored`; `doctor` grew env-only → **KB + connection health** (KB structure, gitignore-leak guard, hook-block/version drift nudge) with **`--fix`** (repairs ignores) and a redacted, **content-free `--report`** bundle (ADR-0021 §3). The security review hardened `--report`'s redaction (all abs paths → `<path>`, IP:port → `<addr>`, `check.name` routed through `redact()`); dogfood confirmed **0 paths/keywords/secrets** leak. **Stage 2 — dashboard (Option D, ADR-0020):** a KB-dir-agnostic collector + three tiers — committable `Dashboard.md` + Obsidian `Knowledge.base` + the self-contained, offline, **gitignored** `dashboard.html` cockpit (proposal-queue hero, wings/notes/skills, durability ladder, health). Review caught + fixed two HIGH committability bugs (a wall-clock churn stamp; multi-home notes omitted from secondary wings) and hardened the HTML injection boundary (every value `escapeHtml`'d, JSON island `<`-escaped, deep-links encoded, CSP meta, JSON island stripped of abs paths). Dogfood rendered the **real** KB (31 notes · scratch 2129 → 31 → 1 skill; empty proposal queue = honest soak state) with zero external resources. **Stage 3 — chores:** `CHANGELOG.md` backfilled 0.0.1→0.0.9, README marketing pass (mark + 1200×630 social card under `assets/`, offline/no-telemetry positioning, agentmemory *differences*), version → 0.0.9, KB regen. Soak/0.1.0 graduation gate unchanged. **Manual human step:** GitHub Settings → Social preview upload of `assets/social-card.png` (no API).

⁷ 0.0.10 **coherence** (decided 2026-06-09; needs a grill) — three interrelated items the 0.0.9 build surfaced, deliberately **deferred out of the green 0.0.9 release** to avoid bolt-on churn: **(a) vocabulary ADR** — formalize "**every flavor is a knowledge base (KB)**" (the glossary [context.md](context.md) already makes "knowledge base" the product noun and *avoids* "vault"; it's just applied inconsistently — README limits "KB" to in-repo, "hub" is overloaded across artifact/location/scope, code uses both `mode:"external"` and `storage:"hub-owned"`). ~20-25 user-facing strings + ~80-100 total incl. tests. **(b) hub flat-vs-nested grill → ADR** — the hub-root `notes/`+`decisions/` *plus* per-`projects/<name>/` `notes/`+`decisions/` is intended per [ADR-0011](../decisions/0011-recursive-scan-hub-projects.md) §6 / [ADR-0012](../decisions/0012-wings-optional-convention-standalone-hubs.md) §4 (one vault, grouped by tag/wing) but reads as duplication, and `mage link` (`link.ts`) scaffolds a member inconsistently vs `mage init --hub`; decide the canonical layout (does a hub keep top-level notes, or does everything — incl. hub-level — live under `projects/<name>/`?), then implement + a migration. **(c) SDD skills removed** — drop the 7 spec-kit-derived skills (`specify/clarify/plan/tasks/implement/analyze/constitution`, ~1085 lines; stale `.specify/` paths, missing the promised `ATTRIBUTION.md`, isolated from the memory loop) + their README/`plugin.json` advertising — the **prune ADR-0001/0002 named and deferred**; sharpens the memory-first identity. Pairs (a)+(b) under one grill (defining "a hub is a KB that federates project-KBs" settles both).

⁸ 0.0.11 **shipped 2026-06-15** via release-please (tag `v0.0.11`; npm publish manual after dogfood). The
0.0.11 soak finding was **precision, not reach** (the de-noise pass) — and the honest read of the live
tally (40/40 ≥K signatures are `workflow` *activity*, lessons barely recur) **reframed the loop**: the
organic win is the **lesson path** (first-sight → note, Claude-Code-memory style), so note→skill
graduation (a2) is **deferred** and the 0.0.11 recurrence machinery stays untouched. This release also
adopted **release-please** (one rolling `chore(main): release X` PR; `bump-patch-for-minor-pre-major` holds
0.0.x; `include-component-in-tag:false` keeps `v0.0.x` tags; PAT-driven so CI runs under branch protection),
a **PR-title conventional-commit gate** (`amannn/action-semantic-pull-request`), a **security cleanup**
(dropped stale gray-matter for the zero-dep `yaml` package → removes js-yaml; esbuild override), and a
**test-typecheck gate** (tests were excluded from `tsc` — 98 latent errors fixed; CI now type-checks tests).
See [the release-bump gotcha](release-bump-touches-many-artifacts.md) + [the typecheck-gap gotcha](test-files-were-excluded-from-typecheck.md).

⁹ 0.0.12 **organic grooming loop** — GRILLED 2026-06-15, spec locked in [plan-0.0.12-organic-grooming-loop](plan-0.0.12-organic-grooming-loop.md)
(becomes **ADR-0024**), **building**. Ships the LESSON path (a1 = observed organic note creation, CC-memory
style): a **portable core** (`mage stage` → redacted draft into a gitignored `.staging/`; `mage groom` →
surface the deduped batch, move confirmed drafts to `notes/` + index; reject → `.metrics/staged-rejects.json`;
anti-flood = dedup via `coveringNote` + budget N=3 + reject buffer) + a **Claude-Code adapter** (`mage nudge`,
fired on **`SessionStart(source=compact)`** — NOT the originally-guessed PreCompact/SessionEnd: SessionEnd
can't inject context and PreCompact precedes chapter close; SessionStart-compact fires after, when
`.learnings/` is complete and stdout becomes context — runs distill over the new segment, drafts to
`.staging/`, surfaces via `additionalContext`, wired by `mage connect` — finishing [ADR-0009](../decisions/0009-no-runtime-automation-rides-host-hooks.md)
§24 step 2) + an **always-on inline-capture instruction** in the generated AGENTS.md. Bundled: the **redact
false-positives** fix (skip mage's own generated artifacts, ignore `${ENV}` placeholders, tune the
high-entropy detector, add a non-bypass `mage/.redactignore` allowlist) — load-bearing because the loop
generates more note commits, so every false positive would deadlock it. **0.1.0 = the announcement** once a1
is observed working in real use (NOT an over-fit "force a graduation" gate). No embedded judge (holds
ADR-0009/0021); the host-skill IS the judge.
**BUILD STATUS (2026-06-16):** shipped as 3 reviewable PRs (release-please rolls them into 0.0.12) —
**portable core = PR #25** (mage stage/groom + `.staging`), **redact false-positives = PR #26** (off main,
independent), **Claude-Code capture adapter = PR (this)** (`mage nudge` + inline instruction). Each
dogfooded + adversarially reviewed. Pending: user merges + a multi-KB soak before npm publish.

## Critical path (what gates everything)

`0.0.2 substrate` → **`0.0.5 mage observe`** → `0.0.6 connect + metrics` → `0.0.7 distill` → `0.0.8 self-grooming`.

`mage observe` is the keystone: it writes the `.learnings/` scratch and, per
[ADR-0013](../decisions/0013-procedure-skills-self-grooming-loop.md), must also carry
**skill-load events** so **context-match** is computable. **Its `.jsonl` schema is
load-bearing for the whole loop** (capture *and* optimization) — now locked in
[ADR-0015](../decisions/0015-mage-observe-capture-schema.md), so everything downstream
locks against the right shape. observe ships **next** (locked, no grill); `connect`
makes it auto-fire, so it lands with the read-only metrics that read its data.

**MCP recall was deferred past 0.1.0** (2026-06-08): file-based recall (the INDEX + the
host agent's own grep/read) already covers every file-capable agent, and the
"no-vector-in-core" boundary means an MCP `search` adds no semantic capability over that;
the only version that *would* add reach — a queried shared-memory **service** — edges into
the coordination layer [ADR-0010](../decisions/0010-durable-memory-not-coordination-layer.md)
deliberately bounds mage away from. It moves to *Deferred past 0.1.0* (opt-in, out-of-core,
own grill if real demand appears), alongside the SkillOpt bridge. This removes the **last
grill** — the path to 0.1.0 is now pure build.

The eight 2026-06-05 mega-grill ideas land as: grouping → 0.0.3; ingest skills →
0.0.4; redaction → 0.0.5 (Gate 1) + 0.0.3 (Gate 2); context-match metrics → 0.0.6;
note→skill graduation + optimize/reword (SkillOpt rails) → 0.0.8; automate learn = the
0.0.5–0.0.8 chain; icon/viz → 0.0.9. Highlighting auto skill-creation (idea 2) is the
graduation UX in 0.0.8 + the README.

## Where 0.1.0 cuts

**0.1.0 = the full self-grooming loop, all human-committed.** Founding value (portable
file KB · index · per-wing skills · dream · bulk migration/ingest) plus
the complete capture → graduate → optimize loop ship across 0.0.3–0.0.9 and graduate
to **0.1.0**. The never-auto-commit invariant holds throughout — grooming *writes
files*, the human *commits the diff*. ADR-0006's "promotion deferred until wings
proliferate" trigger is satisfied naturally: wings proliferate across the 0.0.x ladder
before the self-grooming release (0.0.8) lands.

## Release discipline — dogfood before publish

Every release is **used locally before it ships.** `pnpm test` verifies logic in
isolation, but mage's runtime surface — hook-invoked commands reading real stdin, real
`.learnings/` writes, KB/root resolution from a real `cwd`, redaction on real payloads,
file rotation — only reveals bugs when actually run. **Definition of done, per release:**

1. `pnpm test` + `pnpm typecheck` + `pnpm build` green.
2. **Smoke the new capability against real inputs** — e.g. pipe real Claude Code hook
   JSON into `mage observe` and inspect the output; include a **planted secret** (confirm
   Gate-1 redaction) and **malformed input** (confirm it never crashes the host).
3. **Run it for real in this repo** — mage dogfoods on its own `mage/` KB. From 0.0.6
   (`connect`) this is automatic; before that, wire one temporary hook by hand (which
   also pre-validates connect's payload→event mapping). Remove the temp hook after.
4. Only then tag + `npm publish`.

## Grills to run (remaining: 0 — the **0.0.12 organic-grooming-loop grill** closed 2026-06-15, see ⁹; the **0.0.10 coherence grill** closed + shipped, see ⁷; 0.0.9 readiness grilled + closed 2026-06-09, see ⁵; the path to 0.1.0 is now pure build + the a1 bake)

The 2026-06-06 observe grill ([ADR-0015](../decisions/0015-mage-observe-capture-schema.md)
+ [ADR-0016](../decisions/0016-context-match-confidence-ladder-applier.md)) pre-resolved
the cross-cutting decisions (schema, context-match window/predicate, rollup storage,
the confidence ladder, the dream-as-applier boundary, the command-tier taxonomy), so
every remaining grill is now scoped to *mechanics only* — what each release still has to
decide, below.

- **0.0.5 observe** — **GRILLED ✓ + locked** ([ADR-0015](../decisions/0015-mage-observe-capture-schema.md)/[ADR-0016](../decisions/0016-context-match-confidence-ladder-applier.md)); also landed the [ADR-0014](../decisions/0014-two-gate-redaction.md) redaction reframe + [CONVENTIONS §10](../../CONVENTIONS.md). **Build next, no grill.**
- **~~0.0.6 connect~~ — GRILLED 2026-06-06** → [ADR-0017](../decisions/0017-mage-connect-host-hook-adapter.md) (+ amends [ADR-0009](../decisions/0009-no-runtime-automation-rides-host-hooks.md)'s interlock; CONVENTIONS §10 updated). Locked: `mage connect`/`disconnect` write `id:"mage:*"` hooks to `settings.local.json` (per-repo, `--user` for global; idempotent, `.bak`-safe, refuse-on-malformed); **full-ignore ECC** (no interlock — coexist + feeder); dual-mode CLI via a shared `resolveInteractive` (non-TTY ⇒ non-interactive), generalized to init/link/unlink; hook block = 6 observe events (incl. PostToolUseFailure) + `Stop` `mage skills --metrics --quiet`; read-only context-match via **`mage skills --metrics`** over a persistent `mage/.metrics/` rollup (Option B, per-turn fold); keyword-derivation noise fixed at capture; "dream tuning" dropped. **Carry-in still open:** verify whether Claude Code fires *both* `PostToolUse` and `PostToolUseFailure` for one failure (dedupe if so) — confirm during the build's real-session dogfood.
- **~~0.0.7 distill~~ — GRILLED 2026-06-08** → [ADR-0018](../decisions/0018-mage-distill-observed-scratch-reader.md) (amends [ADR-0005](../decisions/0005-one-canonical-memory-others-are-feeders.md) + [ADR-0013](../decisions/0013-procedure-skills-self-grooming-loop.md) §5). Locked: distill = deterministic `mage distill --json` reader + `mage:distill` judgment skill (separate from `learn`, shares its pipeline); **notes on first sight** (recurrence/graduation → 0.0.8); per-session **offset watermark** in `.metrics/distill.json` (CLOSED-only, explicit `--seen` advance); chunk by `compact`/session boundary; **four balanced lenses** (user-corrections **first-class**, error→fix, repeated-workflow, tool-preference); salience-filter→cap-with-logged-spill; **two-stage dedup** (deterministic keyword/wing/path pre-filter → model merge); Redaction **Gate 2 = inline `mage redact` + a blocking `pre-commit` hook** via `mage connect`; **feeders cut** (own `.learnings/` only; `--from` stays a generic importer); auto-distill is a **deferred opt-in rung** (ADR-0009 lines 45/53), not forbidden.
- **~~0.0.8 self-grooming~~ — GRILLED 2026-06-08** → [ADR-0019](../decisions/0019-mage-promote-self-grooming.md) (amends [ADR-0015](../decisions/0015-mage-observe-capture-schema.md) + [ADR-0006](../decisions/0006-two-layer-recall-per-wing-skills.md)). Locked: promote = a **second deterministic fold** over the same scratch (distill's sibling), a per-`(wing+tags)`-**signature** recurrence tally counting **distinct sessions**, its own bookmark, purge-surviving, reusing the rollup mould (`.metrics/promote.json`); **corrections are recurrence-counted** too (coarse tag-bucket → judgment refines). **One tally, both rungs:** signature recurs ≥ K(≈3) sessions with no covering note → propose a note (the catch-net behind distill's first-sight); a Playbook/Gotcha note corroborated ≥ M(≈5) sessions → propose **graduation** (recurrence gates graduation; **context-match** gates reword/demote *after*). **merge + new `split`** are applier ops (merge-on-tag-overlap keeps it small *early*; split on too-long / slice-recurs / incoherent; small-early **emerges from the counts**, no special mode). **Thresholds = seam + dial now, auto-tuner deferred:** all constants in one module; a human **sensitivity dial** (low/normal/high, in tracked `metadata.json`) scales them; dream auto-tuning them is a deferred opt-in rung keyed on **accept/reject**, not volume/persona. **0.0.8 ships Rung A (propose-only)**; the accept/reject ladder + **`rejected.json`** buffer are the per-user adaptation. New gitignored `.metrics/` siblings: `promote.json`, `proposals.json`, `rejected.json`. **ADR-0015 amendment:** capture the agent's **final reply per turn** (redacted, `assistant_msg`) to sharpen corrections. *(Build may stage promote-tally → graduate → optimize-reword → full dream sweep; ships as one release.)*
- ~~**0.0.9 MCP**~~ — **deferred past 0.1.0** 2026-06-08: redundant with file-based recall (and "no-vector-in-core" adds nothing over plain grep); the only value-adding form, a queried shared-memory *service*, fights [ADR-0010](../decisions/0010-durable-memory-not-coordination-layer.md). No grill. *(0.0.9 = **readiness**, re-grilled 2026-06-09 — see footnote ⁵.)*

## Deferred past 0.1.0 (unplanned future 0.x — no 1.0 crowned, own ADR/grill required)

- **MCP recall accelerator** — an opt-in, out-of-core MCP server exposing search/get over
  the INDEX to MCP-only clients. Deferred 2026-06-08: redundant with file-based recall for
  any file-capable agent (and "no-vector-in-core" adds no semantic search over plain grep);
  the only value-adding form — a queried shared-memory *service* — edges into the
  coordination layer [ADR-0010](../decisions/0010-durable-memory-not-coordination-layer.md)
  bounds mage away from. Build it (its own grill) only if a real MCP-only consumer appears.
- **Literal SkillOpt bridge** — export skills + trajectories to Microsoft's SkillOpt
  optimizer, import `best_skill.md` back. A real training loop (two model backends,
  epochs, labeled splits) → opt-in, **out-of-core**, like the MCP accelerator. mage
  ships SkillOpt's *rails* in 0.0.8, not its harness. [ADR-0013](../decisions/0013-procedure-skills-self-grooming-loop.md)
- **Multi-repo hub graph aggregation + cross-repo `/dream`** — ADR-0012 §2 *rejects*
  cross-repo content/graph aggregation (Obsidian can't span repos). The only surviving,
  ADR-0010-blessed form is read-only memory aggregation that follows registry pointers
  *without merging graphs* — XL, needs its own grill on the sync model.

## Relations

- sequences [mage roadmap](roadmap.md)
- detailed_by [ADR-0013 — procedure skills + the self-grooming loop](../decisions/0013-procedure-skills-self-grooming-loop.md)
- detailed_by [ADR-0014 — two-gate redaction](../decisions/0014-two-gate-redaction.md)
- detailed_by [ADR-0015 — mage observe capture schema](../decisions/0015-mage-observe-capture-schema.md)
- detailed_by [ADR-0016 — context-match, the confidence ladder, and the single applier](../decisions/0016-context-match-confidence-ladder-applier.md)
- detailed_by [ADR-0017 — mage connect: the host hook adapter](../decisions/0017-mage-connect-host-hook-adapter.md)
- detailed_by [ADR-0018 — mage distill: the observed-scratch reader](../decisions/0018-mage-distill-observed-scratch-reader.md)
- detailed_by [ADR-0019 — mage promote: self-grooming](../decisions/0019-mage-promote-self-grooming.md)
- detailed_by [ADR-0011 — recursive scan; hub projects are wings](../decisions/0011-recursive-scan-hub-projects.md)
- detailed_by [ADR-0012 — wings optional; standalone hubs](../decisions/0012-wings-optional-convention-standalone-hubs.md)
- feeders_from [ADR-0005 — one canonical memory; others are feeders](../decisions/0005-one-canonical-memory-others-are-feeders.md)
- recall_from [ADR-0006 — two-layer recall](../decisions/0006-two-layer-recall-per-wing-skills.md)
- mines [ADR-0007 — mine agentmemory's design](../decisions/0007-mine-agentmemory-design-not-depend.md)
- rides [ADR-0009 — no runtime; automation rides host hooks](../decisions/0009-no-runtime-automation-rides-host-hooks.md)
- bounded_by [ADR-0010 — durable memory, not a coordination layer](../decisions/0010-durable-memory-not-coordination-layer.md)
- field_tested_by [migration field notes](migration-field-notes.md)
