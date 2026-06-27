---
type: decision
tags: [mage/decisions]
created: "2026-06-25"
updated: "2026-06-25"
last_reviewed: "2026-06-25"
status: proposed
provenance:
  repo: mage-memory
  work: adr-0032-capture-redirect-native-memory
sources:
  - decisions/0005-one-canonical-memory-others-are-feeders.md
  - decisions/0009-no-runtime-automation-rides-host-hooks.md
  - decisions/0024-organic-grooming-loop.md
  - decisions/0029-digest-to-agent-capture.md
  - decisions/0030-agent-autonomy-ladder.md
  - src/grooming/staging.ts
  - src/commands/stage-cmd.ts
keywords: [capture, native-memory, automemorydirectory, relocation, coexist, nudge, redirect, staging, durability, claude-code, adapter, reflex]
---

# 0032 — Capture-redirect: co-opt the host's native-memory write into mage's git-durable pipeline (relocation where the host allows it, coexist nudge as the floor)

> **Status: proposed.** Output of a grill (2026-06-25). Capture mechanism only; the
> recall counterpart (projecting mage notes *into* the native store) is split out to a
> companion **ADR-0033**. Ships behind the gate in [§Gate](#gate-pre-registered).

## Context

The ADR-0030 live soak measured a failure ADR-0029's gate could not see. With the
boundary nudge firing and the mage `AGENTS.md` block loaded, **inline `mage stage` was
never run** (the `.mage/staging/` dir was never even created in either soak hub) and
**~all durable lessons routed to the host's own native memory** (`wsl-rancher-container-gotchas`,
`repo-governance-automation`, `trunk-branch-strategy`, …). ADR-0029 proved the digest's
*content* is good (a miner extracts the gems); the live trial reveals the next bottleneck
is the *action* — `mage stage` is a **CLI competing against the native write reflex**, and
the CLI loses on friction + RLHF + system-prompt placement every time. (Claude Code's own
docs say it out loud: `CLAUDE.md` is "context, not enforced configuration… to block
regardless of what Claude decides, use a hook.")

Three facts from the host (Claude Code v2.1.191), grounded against the memory docs **and the
binary** (2026-06-25):

1. **Memory is the agent maintaining `~/.claude/projects/<project>/memory/*.md` + a `MEMORY.md`
   index via `Write`/`Edit` tool calls** (a system-prompt "# Memory" mechanism — the soak
   transcript shows 10 such calls, incl. `wsl-rancher-container-gotchas.md`). The dir is
   **repo-derived + per-project**; `MEMORY.md`'s first 200 lines / 25KB load every session
   (that is the host's recall). An earlier research pass calling the write "internal /
   uninterceptable" was **wrong**: it IS a tool call — so `PreToolUse` can redirect it and
   `PostToolUse` can observe + mirror it.
2. **`autoMemoryDirectory` relocates that storage dir** — present in the binary
   (`autoMemoryDirectory`, `hasAutoMemoryDirectory`, `ensureMemoryDirExists`) but
   **undocumented** (the memory docs expose only `autoMemoryEnabled` +
   `CLAUDE_CODE_DISABLE_AUTO_MEMORY`). Setting it points the agent's memory writes — and the
   host's recall — at a chosen directory.
3. **So multiple deterministic levers exist** (relocation via config, `PreToolUse` redirect,
   `PostToolUse` mirror) — not the single lever an earlier pass assumed.

Governing constraint (the grill's tiebreaker): **notes must be durable via git.** The native
store is a durability dead-end on its own — never committed, never portable. So capture must
*end in git*, regardless of where the reflex starts.

## Decision

1. **Capture is a redirect into mage's git-durable pipeline — never adoption of a non-git
   store as the source of truth.** The host's native store is, at most, a capture *buffer*
   that mage promotes to git. This keeps [ADR-0005](0005-one-canonical-memory-others-are-feeders.md)'s
   canonical-memory core intact: mage stays the one durable source.

2. **One common capture directive; per-harness adapter settings only where conformance needs them.**
   The capture *intent* is harness-agnostic — the **base that works everywhere**: via whatever context
   channel a harness offers, inject the directive *"when you learn a durable lesson, write it as a mage
   note into the KB inbox (the `resolveDocsRoot()` top), in mage's schema."* This is **observed to
   work** — when nudged, or on a host with its own memory reflex prompted by the host itself, the agent
   *reliably writes a memory*. The ADR-0030 soak's only fault was *where* it wrote (CC's flat native
   dir) and *how* (CC's schema), never *whether*. So a per-harness adapter
   ([ADR-0009](0009-no-runtime-automation-rides-host-hooks.md) /
   [ADR-0017](0017-mage-connect-host-hook-adapter.md)) adds **only the specialized settings that conform
   that write to mage** — location, schema, index ownership — and nothing more. Recall is symmetric
   ([ADR-0033](0033-recall-import-bounded-index.md)): one common "index at launch" intent, per-harness
   channel.

   - **Base (every harness) — the directive + a destination.** The standing `AGENTS.md` line + the
     reworded [ADR-0029](0029-digest-to-agent-capture.md) boundary digest carry the directive; the agent
     writes a mage-schema note to the KB inbox. Volitional but reliable. **Coexist** — the host's own
     ephemeral scratch memory is not forbidden. On a harness mage can't configure further, this base *is*
     the capture path — **no loss of durability** (same notes, same index), only of determinism.
   - **Claude Code adapter — conformance settings that also make capture deterministic.** CC ships a
     native-memory reflex (it *will* write memories on its own), so the adapter's job is pure
     conformance, and its hooks make that conformance **un-skippable**. `mage connect` sets:
       - **location** — `autoMemoryDirectory` = `resolveDocsRoot().root` (this repo: `mage/`), so the
         write lands at the KB docs-root top, not CC's flat `~/.claude/projects/<p>/memory/`;
       - **schema + index ownership** — one consolidated `PreToolUse` hook on `Write`/`Edit`, branching
         on path: a generated index (`MEMORY.md`/`INDEX.md`/`_index.*.md`) → **deny** (mage owns it,
         regenerated by `mage index`); a note write → **scrub + schema-map in-flight** → `updatedInput`
         (Gate-0, below); else → allow. One hook (not two) sidesteps CC's documented last-wins race when
         multiple `PreToolUse` hooks rewrite the same field;
       - **acknowledgement** — a `PostToolUse` capture-nudge (`additionalContext`: "captured `<slug>`, N
         masked — run `mage groom`").
     **Spike-validated 2026-06-25** (location + index deny + graceful comply); **recall-load proven
     2026-06-27** (§Gate). Gated on `autoMemoryEnabled` ([§Scope](#scope-this-adrs-build)); when off, the
     Base directive is the path.
     - **Gate-0 — capture-time scrub (extends [ADR-0014](0014-two-gate-redaction.md) to three gates).**
       The `PreToolUse` hook pipes the agent's `content` through mage's existing keep-context
       `redact()` (`src/redact.ts:230` — secrets/PII → `[REDACTED:<kind>]`, key names preserved) plus the
       body transforms of the native→mage map (`schema-map.ts`: H1 from `name`, folded `description`,
       `[[wikilink]]`→`[](path.md)`), emitting `updatedInput`. CC's own docs name the lever: *"to block
       an action regardless of what Claude decides, use a PreToolUse hook."* Raw PII/secrets **never
       reach disk**, so never a commit — this **resolves the PII block-vs-warn question by
       construction**: no need to make Gate-2 block PII; it stays the un-skippable *secret* backstop.
       False positives bounded by the existing `metadata.redact.ignore` allowlist. **The 2026-06-27 spike
       refined this** (§Gate): CC re-normalizes a memory file's *frontmatter* after the write, so Gate-0
       does the **scrub + surviving body transforms** and **`mage groom` owns the wing + final
       frontmatter schema** at promotion to `notes/` (the inbox file sits CC-shaped-but-scrubbed until
       then).
     - **Curation posture — direct → the docs-root top** (the leaning choice, *now safe under Gate-0*):
       `autoMemoryDirectory` = `resolveDocsRoot().root` (here `mage/`), so `<root>/MEMORY.md` IS the KB's
       root index CC loads; scrubbed topic files land **flat** at the root as an **inbox** → `mage groom`
       (judgment: wing-tag + lesson-bar + dedup + promotion) → `notes/<slug>.md`. Notes are **flat on
       disk**; the **wing is a tag-derived index view**, not a subdir — so a flat CC capture "ends up in
       the right wing" by acquiring the right tag (Gate-0 best-guess, groom confirms), never by directory
       routing. Grooming stays **explicit/human** — *not* wired into a pre-commit hook (that would usurp
       [ADR-0013](0013-procedure-skills-self-grooming-loop.md) and is a tree-mutating-hook anti-pattern).
       Gate-2's pre-commit secret-block ([ADR-0018 §7](0018-mage-distill-observed-scratch-reader.md))
       covers `<root>/**` as the net.
     - **Caveats:** `autoMemoryDirectory` is **undocumented** (binary-confirmed) — pin the CC version;
       documented fallback is a `PostToolUse` scrub-in-place (tiny raw-content window vs. PreToolUse's
       none). `updatedInput` is thin on whether the model *knows* it was rewritten — the capture-nudge
       `additionalContext` closes that. Both `autoMemoryDirectory` and hooks activate only after
       workspace-trust is accepted.

3. **One promotion chokepoint, three redaction gates.** Capture flows inbox/`.mage/staging/` →
   `mage groom --accept` → `notes/`, where the provenance stamp
   ([ADR-0031](0031-programmatic-provenance-stamp.md)) fires and **the human's commit is the yes**
   ([ADR-0013](0013-procedure-skills-self-grooming-loop.md)). Redaction is layered:
   **Gate-0** scrubs in-flight at capture (CC adapter, above), **Gate-1** scrubs at `mage stage`
   (CLI path), **Gate-2** blocks live secrets at the pre-commit hook
   ([ADR-0014](0014-two-gate-redaction.md) extended). Writing straight to `notes/` is rejected — it
   bypasses grooming.

4. **Dedup trimmed.** Keep one cheap arm — *skip if already covered by an existing note* (the
   agent can't see mage's notes) — plus the relocation **ingest watermark**. The heavy
   anti-flood arms (already-staged / previously-rejected) are dropped as overkill for
   agent-*curated* writes, which are rarely duplicates of each other.

5. `mage stage` (CLI) is retained for power users / scripts; the nudged path is a native
   file-write.

Every row runs the **same Base directive**; the columns differ only in what conformance the adapter adds:

| host capability | adapter conformance added | volition | recall channel |
|---|---|---|---|
| memory-dir config (Claude Code `autoMemoryEnabled`) | location + schema + index-ownership (in-flight scrub+map, index deny) | **deterministic** | CC auto-loads `<root>/MEMORY.md` |
| hooks, no memory-dir config | none beyond the directive (writes to `.mage/staging/`) | volitional | `@import INDEX.md` (ADR-0033) |
| no hooks | none — manual `mage stage` / `/learn` | manual | `@import` / prose |

### Hub models & placement

The single `MEMORY.md` lands at the **top of the correct docs root** for every hub model, because
`mage connect` sets `autoMemoryDirectory` = `resolveDocsRoot(cwd).root` — the existing resolver already
computes it (`src/paths.ts`):

| hub model | `resolveDocsRoot().root` | `MEMORY.md` at |
|---|---|---|
| in-repo (`mage/` in a code repo) | `<repo>/mage/` | `mage/MEMORY.md` |
| external hub, in a project | `<hub>/projects/<name>/` | `<hub>/projects/<name>/MEMORY.md` |
| external hub, hub-level | `<hub>/` | `<hub>/MEMORY.md` |
| hybrid (in-repo + `hub_refs`) | `<repo>/mage/` | `mage/MEMORY.md` |

**Recall scope = per-docs-root** (the default): `autoMemoryDirectory` follows the *current* docs root,
so recall is scoped to the project you're in and `MEMORY.md` stays under CC's 25KB bound. A multi-project
hub's root keeps its own aggregate `MEMORY.md` for hub-level sessions; a single hub-root-aggregate for
everything is opt-in (bound + relevance risk).

### Scope (this ADR's build)

This ADR builds **the Claude Code adapter only**. It is gated on CC's auto memory being **on**
(`autoMemoryEnabled`, on by default since v2.1.59; off via `autoMemoryEnabled: false` or
`CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`) — when auto memory is off the agent makes no memory-dir writes,
so Gate-0 has nothing to intercept and capture falls to the **Base directive** (volitional, every
harness — no durability loss). `mage connect` therefore adds the CC conformance settings **iff** CC +
`autoMemoryEnabled`; otherwise it installs only the Base directive + Gate-2. Other harnesses'
native-memory systems are a **later** bet (their own adapters, same Base), out of scope here.

## Amendments to prior decisions

- **Amends [ADR-0029](0029-digest-to-agent-capture.md) §2:** the boundary nudge's call-to-action
  changes from `mage stage` (CLI) to a native file-write into `.mage/staging/`; inline capture
  stays primary, the digest stays the boundary safety-net.
- **Amends [ADR-0014](0014-two-gate-redaction.md):** the two-gate model gains **Gate-0**, a
  capture-time keep-context scrub run in-flight by the commandeer tier's `PreToolUse` hook (reusing
  `redact()`), so native captures are masked *before disk*. Gate-1 (`mage stage` scrub) and Gate-2
  (pre-commit secret-block) are unchanged; Gate-2 stays the un-skippable secret net.
- **Amends [ADR-0005](0005-one-canonical-memory-others-are-feeders.md):** the 2026-06-08
  harvest-cut is *narrowly* reopened for the relocation tier only. The cut's stated fear was
  "ingesting their formats couples mage to third-party schemas" — but the host's memory format
  is observed to be a **near-twin** of a mage note (frontmatter + markdown + an index file), so
  the coupling is shallow, and the buffer is mage-owned via config, not scraped. mage reads the
  buffer and **promotes to git**, so durability holds. Pure harvest of un-promoted foreign
  stores stays cut.

## Gate (pre-registered)

Discipline per ADR-0029: replay/measure can KILL; the live reject-ledger crowns. The relocation
choice *shrinks* this gate — deterministic capture removes the "does the nudge land?" question on
Claude Code.

- **Precondition — DONE (2026-06-25):** confirmed in the sreforge soak transcript — the agent had
  the digest + the `wsl-rancher` durable lesson and saved to native memory via a `Write` tool call,
  never considering mage. Premise holds. **Mechanism spike PASSED (2026-06-25):** a throwaway
  headless run confirmed relocation works, the `MEMORY.md` deny holds, capture lands, and the agent
  complies gracefully with the deny. **Recall-load spike PASSED (2026-06-27):** a fresh 2nd headless
  session answered three unguessable canaries planted *only* in `MEMORY.md` (`codename`/`port`/
  `captain`) exactly and with **zero tool calls** — proving CC auto-injects `MEMORY.md` from
  `autoMemoryDirectory` at launch, with no volitional read.
- **Gate-0 scrub spike PASSED (2026-06-27) — the keystone.** A real headless CC session was wired with
  the commandeer settings (`autoMemoryDirectory` + the `mage memory-hook` `PreToolUse`/`PostToolUse`
  groups) and asked to remember a lesson containing `oncall.billing@acme-example.com`. On disk:
  `[REDACTED:email]` — **the raw email never touched disk.** CC honored the `PreToolUse` `updatedInput`
  and rewrote the memory write in-flight. The load-bearing mechanism of the redesign is real.
  - **Finding (built into the code 2026-06-27):** CC's auto-memory system **re-normalizes a memory
    file's *frontmatter* after the write** (the on-disk note kept CC's `name`/`metadata` block, not
    mage's). The **body scrub + body transforms survive** (that is the security goal); a frontmatter
    schema-map / wing-tag at Gate-0 does **not** persist on CC. So Gate-0 was simplified to *scrub
    (+ surviving body normalization)*; `bestGuessWing` (a `scanNotes` hot-path cost whose tag CC
    discarded) was **dropped**, and **`mage groom` is authoritative for the wing + final schema** at
    promotion to `notes/` (beyond CC's normalization). Body scrub is what must — and does — survive.
  - **Adversarial review (2026-06-27)** confirmed an `autoMemoryDirectory` ownership defect: `connect`
    displaced / `disconnect` deleted a *user's own* value with no provenance check. **Fixed:** `connect`
    stashes a displaced user value (`mageStashedAutoMemoryDirectory`); `disconnect` only undoes the
    relocation when mage owns it (commandeer hooks present) and **restores** the stash.
- **Still to verify:** multi-run / real-auto-memory stability (a longer soak), and post-`/compact`
  recall re-injection (the `@import` floor covers it meanwhile, ADR-0033). (Curation posture settled —
  *direct → `mage/` root*, PII closed by Gate-0.)
- **Relocation tier — quality gate only (capture is deterministic):** lean on the existing
  `mage groom` reject-ledger + the [ADR-0030](0030-agent-autonomy-ladder.md) keep-vs-revert
  crown. **KILL** if the ingested-and-promoted notes are mostly noise (low live keep-rate) across
  tiers.
- **Nudge-floor tier — lightweight live bar:** durable lessons land in `.mage/staging/`→`notes/`
  meaningfully above the ≈0 `mage stage` baseline, judged by ADR-0029's balanced-value lens, with
  control (mage-dev) staying ~0. **KILL** if capture stays ≈0 after N soak sessions, or staging
  floods with ledger-rejected junk.
- **Crown:** the live reject-ledger, same instrument as the ADR-0030 autonomy trial.

## Docs / diagram obligations (from the 2026-06-25 state audit)

The lifecycle is carried by a single hand-authored mermaid (`docs/.../loop/overview.md`) that is
accept-path-only **and sits outside the ADR-0026 drift test**. This ADR adds state transitions,
so it must:

1. Extend the D1 diagram: the **relocation buffer → staging** feeder and the **`staged-rejects`
   sink** (currently undiagrammed).
2. Name `staged-rejects.json` explicitly and distinguish it from the recurrence-path
   `rejected.json` (`loop/stage-groom.md`, `reference/layout.md`).
3. Add the missing prose nodes the audit found (distill; `dream --reject`) and one sentence that
   the boundary digest is a *view*, not a stored state.
4. Bring the lifecycle diagram under a drift check (or regenerate it) so a state-model change
   can't silently rot the docs again.

## Consequences

- Capture stops depending on the agent volunteering through a CLI: deterministic on Claude Code,
  better-placed (and still durable-via-git) elsewhere. The strongest competitor (native memory)
  becomes the on-ramp.
- mage stays model-free and offline ([ADR-0009](0009-no-runtime-automation-rides-host-hooks.md)/0021):
  the scrub is a deterministic in-process `redact()` call from a hook, no model in the loop.
- New per-harness surface: one consolidated `PreToolUse` hook (deny/scrub/allow), a `PostToolUse`
  capture-nudge, and the native→mage schema-map. Bounded by graceful degradation — auto memory off,
  or a harness with no memory-dir config, falls back to the nudge floor, losing nothing durable.
- Recall is **not** handled here — it moves to [ADR-0033](0033-recall-import-bounded-index.md): CC
  auto-loads `mage/MEMORY.md` (the twin), with `@import mage/INDEX.md` as the non-CC fallback. The
  commandeer tier is capture-only.

## Open questions (unsettled — do not treat as decided)

- ~~**Curation posture: direct vs buffer**~~ — **SETTLED: direct → `mage/` root.** Gate-0's
  capture-time scrub masks PII/secrets in-flight before disk, so the *buffer* posture's only
  advantage (keeping raw captures out of the tracked tree) is moot, and the PII block-vs-warn
  question is closed by construction. Gate-2's pre-commit secret-block (`src/git-hooks.ts` +
  `src/staged-scan.ts`, already built) covers `mage/**` as the net.
- **`INDEX.md → MEMORY.md` — leaning twin, not rename.** `mage index` keeps the portable, canonical
  `INDEX.md` (the `@import` floor for non-CC harnesses, ADR-0033) and **also emits `MEMORY.md` as a
  CC-adapter twin** — keeping the host-specific name out of the portable core (ADR-0009). The twin is
  not redundant: CC **self-bounds `MEMORY.md` at 25KB**, so it can **fold the single-wing
  `_index.mage.md` per-note list** in for richer recall, while `INDEX.md` stays a strict bounded
  wings-map. (Renaming outright is the alternative — one file, no drift — but bakes CC's filename into
  the portable KB and ripples through AGENTS.md / ADR-0033 / docs / `INDEX_FILE`.) Either way,
  `MEMORY.md` must be added to `RESERVED_MD` (`src/scan.ts`) so `isGeneratedArtifact` skips it and
  `mage index` treats it as generated, not a note.
- The buffer location + per-project attribution for multi-project hubs; the machine-specific
  absolute `autoMemoryDirectory` path lives in `settings.local.json` (not committed).
- The schema-map specifics: native `name`/`description`/`metadata.type`/`[[wikilinks]]` →
  mage `type`/`keywords`/`[](path.md)`.
- Exact gate thresholds (N sessions, keep-rate floor).
- The companion **ADR-0033** (recall projection into native stores) — separate bet, separate gate.

## Relations

- amends [ADR-0005 — one canonical memory; feeders cut](0005-one-canonical-memory-others-are-feeders.md)
- amends [ADR-0029 — digest-to-agent capture](0029-digest-to-agent-capture.md)
- constrained_by [ADR-0009 — no runtime; ride host hooks + per-harness adapters](0009-no-runtime-automation-rides-host-hooks.md)
- constrained_by [ADR-0013 — the human's commit is the yes](0013-procedure-skills-self-grooming-loop.md)
- amends [ADR-0014 — two-gate redaction](0014-two-gate-redaction.md) (adds Gate-0, the capture-time scrub)
- builds_on [ADR-0024 — organic grooming loop](0024-organic-grooming-loop.md)
- relates_to [ADR-0030 — agent autonomy ladder (the reject-ledger crown)](0030-agent-autonomy-ladder.md)
- relates_to [ADR-0031 — programmatic provenance stamp](0031-programmatic-provenance-stamp.md)
- extends [ADR-0006 — two-layer recall](0006-two-layer-recall-per-wing-skills.md)
- companion [ADR-0033 — recall via the host's auto-loaded index](0033-recall-import-bounded-index.md)
