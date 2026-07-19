---
type: decision
tags:
  - mage/decisions
created: "2026-07-19"
updated: 2026-07-19
last_reviewed: 2026-07-19
status: accepted
provenance:
  repo: mage-memory
  work: adr-0039-context-footprint
sources:
  - decisions/0033-recall-import-bounded-index.md
  - decisions/0021-offline-no-telemetry-local-signal.md
  - decisions/0037-readiness-doctor-remit-and-autofix-line.md
  - decisions/0036-defer-harness-adapter-seam.md
  - decisions/0016-context-match-confidence-ladder-applier.md
  - decisions/0038-promote-note-rung-deleted-graduate-on-usage.md
  - decisions/0004-capture-insight-not-copies.md
  - notes/future-thoughts.md
  - notes/promote-folds-mechanical-tokens.md
  - notes/plan-0.0.10-coherence.md
  - src/commands/index-cmd.ts
  - src/metrics/rollup.ts
  - src/adapters/claude-code/nudge.ts
  - src/distill/digest.ts
  - src/doctor/kb-checks.ts
keywords:
  - footprint
  - context-window
  - recall-budget
  - launch-cost
  - occupancy
  - pointer-leverage
  - no-savings-claim
  - bytes-authoritative
  - keyword-dedupe
  - progressive-degradation
  - silent-truncation
  - ft-18
---

# 0039 — measure the context footprint; bound the generated launch surface

> **Status: accepted (ratified 2026-07-19).** Output of a 2026-07-19 grill. Implements
> **FT-18** ([future-thoughts](../notes/future-thoughts.md)). Resolves the size-cap policy that
> [ADR-0033](0033-recall-import-bounded-index.md) §Open-questions deferred, and corrects that
> ADR's "~4KB bounded import" estimate, which measurement showed to be wrong by ~5×.
> ADR-0033's core decision — import the bounded root — stands and is **not** superseded.

## Context

mage has never measured its own effect on the agent's context window. FT-18 asked for
observability. Measuring first, before designing the instrument, turned a reporting feature
into a defect report.

**Measured on this KB (72 notes, 1 wing, 2026-07-19):**

| Surface | Bytes | ~Tokens (est.) | Auto-loaded |
| --- | ---: | ---: | --- |
| `MEMORY.md` | 19,291 | ~4.8K | yes (CC auto-memory) |
| `_index.mage.md` | 19,261 | ~4.8K | only if followed |
| `AGENTS.md` | 1,316 | ~0.3K | yes (`@AGENTS.md`) |
| `SKILL.md` (×1 wing) | 1,124 | ~0.3K | description only |
| `INDEX.md` | 266 | ~0.1K | yes |
| `CLAUDE.md` | 90 | — | yes |

Three findings drove every decision below.

**1. ADR-0033's cost estimate was wrong, and the error is load-bearing.** That ADR accepted
the import without enforcing a budget on the stated grounds that it was "a ~4KB bounded
import… low-risk." `MEMORY.md` measures **19,291 B — 75% of Claude Code's 25,600 B
auto-memory cap** — and grows linearly at ~264 B per note. `index-cmd.ts` explicitly delegates
bounding to the host ("CC self-bounds at 25KB") and never measures. But the host's self-bound
is **silent truncation**, not graceful degradation: past the cap, notes fall out of recall with
no error, no warning, and no way for the agent to know its index is incomplete. At the measured
growth rate this KB had **~14 notes of headroom**.

**2. Most of the cost is redundant text.** The keyword tail is **10,967 B — 57.6%** of the
entry lines. Of 799 keyword tokens, **52% already appear in the note's own title or path** and
**10% are generic boilerplate** (`considered`, `options`, `consequences`, `relations`). Only
~37% carry novel signal (`stale-binary`, `false-positive`, `tsc`). **~4,700 B — ~18% of the
host cap — is spent restating titles.** This is the same mechanical-token failure already
documented in [promote-folds-mechanical-tokens](../notes/promote-folds-mechanical-tokens.md),
surfacing at a different consumer.

**3. A defensible "savings" number cannot be produced locally.** Survey of prior art: the
instruments that are trusted — Letta's Context Window Viewer, Claude Code's `/context`,
Anthropic's prompt-cache accounting — make **no counterfactual claim** at all; they report
composition against a stated ceiling. The systems that do claim savings (Mem0 "90%",
Supermemory "99.4%", MemOS "35%") all divide by a strawman denominator: *the entire corpus
stuffed into every prompt*, which is not what a user without the tool would do. Whether an
agent would have re-derived a fact, read the source anyway, or simply been wrong is the
counterfactual, and it requires a paired memory-on/memory-off ablation replay — not a report.

## Decision

### 1. The instrument reports occupancy and yield. It never claims savings.

`mage footprint` reports what mage **costs**, against a stated ceiling, plus usage yield. The
word "saved" does not appear in output, docs, or release notes unless an ablation actually ran.
Costs are stated as arithmetic, never netted into a benefit.

### 2. Pointer leverage is reported as a labelled **ceiling**, not a realization.

[ADR-0004](0004-capture-insight-not-copies.md) means every note points at sources it does not
copy. For notes actually read, the byte size of the sources they point at is a real **upper
bound on avoided reading** — and must be labelled as such, because the agent may never have
read those sources.

Measured pointer reality (307 source entries, corrected 2026-07-19): **243 resolve on disk
(79%)** — 190 relative to the **repo root** (`src/…`) and 53 relative to the **docs root**
(`notes/…`, `decisions/…`) — **25 are dead (8%)**, 13 are URLs and 26 are opaque refs
(`cc-session:…`), i.e. **39 (13%) are unmeasurable**.

Sources therefore use **two resolution bases**: a pointer is dead only when it resolves against
**neither** the docs root **nor** the repo root. Resolving against one base alone
misclassifies the other's pointers as dead — an earlier draft of this ADR said "~46%
measurable" for exactly that reason, and it was wrong.

The unmeasurable share and the dead-pointer count MUST be disclosed in output — no silent caps.
Dead pointers are additionally a staleness signal worth surfacing.

**Scope of the ceiling:** it is reported **corpus-wide** — the sources the whole KB points at —
and labelled as such. Scoping it to only the notes actually read is the stricter reading of
"avoided reading", but yield needs ~30 sessions before it means anything, so a read-scoped
ceiling would render empty for a long time. Read-scoped refinement is deferred until yield
data exists; until then the figure is a ceiling over the corpus, never over a session.

### 3. Bytes are authoritative. Tokens are advisory. No tokenizer, ever.

The binding constraint (the host auto-memory cap) is expressed in **bytes**, so budgets are
enforced in bytes — no conversion error may sit between mage and the cliff.

Tokens are shown for human readability only, estimated at **`bytes / 4`**, rendered **coarsely**
(`~4.8K est.`, never `4,823`) so the rendering communicates its own error bar. Measured
bytes-per-token across this corpus ranges **3.39–3.96 (17% spread)** — index files are the
densest because slugs and punctuation defeat BPE merging — so no single divisor is right and
false precision must not be implied.

**mage MUST NOT take a tokenizer dependency.** Not for weight: shipping one asserts knowledge
of which model reads the KB, contradicting the harness-neutral charter. Where conservatism is
wanted, it is spent on thresholds, never on a fudged divisor.

### 4. The cap belongs to the harness adapter; the core holds a conservative default.

Per [ADR-0036](0036-defer-harness-adapter-seam.md) — consolidate harness-specific facts into the
named adapter module, invent no seam for one harness:

- `src/adapters/claude-code/` owns `AUTO_MEMORY_MAX_BYTES = 25_600`, commented with its source.
- **That constant is the sole default.** An earlier draft of this ADR had the neutral core hold
  a second, conservative default for "an unrecognized harness" — but mage has no harness
  detection, and building one for a harness that does not exist is precisely what
  [ADR-0036](0036-defer-harness-adapter-seam.md) rejected. A default that no code path can
  reach is indistinguishable from a lie about what the tool measures. When harness #2 arrives,
  it brings both its cap **and** the detection that selects it — and that is when the seam
  earns itself.
- Thresholds: **warn at 70%**, **breach at 90%** (not 100%) — mage's byte count is not
  guaranteed identical to the host's, and the failure being fixed is an *invisible* cliff, so
  the instrument must fire before it, not at it.

**The budget is two-dimensional: bytes AND lines.** Claude Code truncates the auto-memory file
at **~25,600 B _or_ 200 lines**, whichever comes first. `AUTO_MEMORY_MAX_LINES = 200` is
enforced alongside the byte cap, at the same warn/breach ratios, and **`state` is the worse of
the two**. The report shows both.

Measuring only bytes leaves a second invisible cliff, and it is not far off. Measured against
the caps: this KB is at **51.5% of the byte cap (13,187 / 25,600 B)** and **55% of the line cap
(110 / 200)** — so **lines are already the binding dimension**, not a future concern. The
crossover is **175.1 B/entry** against this KB's **180.6 B/entry**, a ~3% margin. Below that
crossover the line cap binds first and a byte-only meter reports `ok` while the host silently
truncates — the exact failure this ADR exists to kill.

**The cap governs the auto-memory file (`MEMORY.md`) only.** `AGENTS.md`, `CLAUDE.md`, and
`INDEX.md` load via `@import` and are not governed by it. The report shows all surfaces but
caps one, and must say so rather than implying a shared budget.

**The CC cap must be wired, not merely defined.** `AUTO_MEMORY_MAX_BYTES` is the resolved
default; an explicit `opts.capBytes` still overrides it. Leaving the cap to each caller is a
footgun — a constant that exists but is never imported reports a false budget state while every
test passes. This is not hypothetical: it happened twice during implementation, first with
`AUTO_MEMORY_MAX_BYTES` itself (reporting `warn` on a healthy KB) and then in mirror image with
the core default. **No unreachable constants.**

**Load modes are distinguished, and the launch total counts only what is actually loaded:**

- `auto-memory` — `MEMORY.md`. Paid every session. The only capped surface.
- `import` — `INDEX.md`, `AGENTS.md`, `CLAUDE.md`. Paid every session.
- `on-follow` — `_index.<wing>.md`. Paid **only if the agent opens it**. Measured and shown,
  but **excluded from the launch total**; counting it would overstate launch cost by ~2×.
- `description-only` — generated `SKILL.md`. Only the frontmatter description is resident.
  The `.claude/` and `.agents/` mirrors are the **same skill**: count it **once**, not twice.

### 5. The generated payload is deduped.

In generated index output (`MEMORY.md`, `_index.<wing>.md`):

- **Keywords** are deduped against the entry's own title and link path, and generic boilerplate
  is dropped. Novel keywords are kept — they carry the recall signal.
- The **`reviewed` date is dropped** (1,553 B). **Status is kept only when it is a caution**
  — `superseded`, `stale-suspect`, `archived`. `accepted` is the healthy default and tells the
  agent nothing actionable; suppressing it makes a visible status *mean* something.
  Status is the marker `AGENTS.md` instructs agents to act on and must survive.

**Measured effect** (implemented 2026-07-19): **19,291 → 13,187 B**, i.e. **75% → 52% of cap**;
per-entry cost **264 → 177 B**; keyword tokens **799 → 297**; recall headroom **14 → 55 notes**.

The 13,187 figure includes ADR-0039 itself as a 73rd note; like-for-like at 72 notes is
~13,010 B (51%). An earlier draft of this ADR projected 11,819 B / 68 notes — that projection
was **wrong**, inflated by a measurement script whose parser mis-split titles containing
parentheses. The figures above are measured from the implemented change, not projected. Recorded
here rather than quietly corrected, because a wrong number in an accepted ADR is exactly the
failure §10 exists to prevent.

### 6. Read-time for the live report; SessionStart sampling for the trend.

- `mage footprint` **stats files live**. The report is never served from cached state.
- The existing Claude Code SessionStart hook samples once per session. The cost is paid at
  session start, so that is when it is sampled — each trend row corresponds to a session that
  really paid it.
- **The trend store is append-only JSONL, not a mutated JSON document.** One line appended per
  sample to `<docsRoot>/.mage/metrics/footprint.jsonl`; `readTrend` folds the lines, dedupes
  by session (last write wins) and prunes. This is the convention `src/metrics/rollup.ts` and
  `src/grooming/tally.ts` already use — append a line, fold on read.

  This replaces an earlier read-modify-write design guarded by a lockfile. That design needed
  **four fix rounds** and still carried a takeover race: a stale-lock eviction cannot verify
  that the file it renamed away is the same one it inspected, so two processes could both
  believe they held the lock. A single small append has no read-modify-write step, therefore no
  lock, therefore none of that race class. **The bug was the mechanism, not the implementation.**
- **The sampler MUST NOT throw.** Same rule as the Stop-hook metrics path: fail open, always.
  A footprint meter that breaks session start is a catastrophic trade for observability. The
  append-only design serves this too: there is no lock to wait on, so the write cannot block.
- The trend is **bounded logically at fold time** by row count and age — never by mutating the
  file in place.

  **Read-time compaction is forbidden.** Rewriting the live JSONL loses any sample appended
  between the read and the rename: the append lands in the old inode, which the rename discards.
  `mage footprint` and the SessionStart hook run independently, so that interleaving is real.
  Physical size is bounded instead by **rotation** — a single `rename` to an archive path, the
  convention `src/observe/store.ts` already uses (`ROTATE_MAX_BYTES` → `.archive/`). Rotation
  cannot lose an append, because the appended-to inode *becomes* the archive rather than being
  discarded.

  Rotation moves rows out of the live file, so **`readTrend` folds the archives too** (newest
  first, stopping once the retained window is satisfied) — otherwise the trend horizon collapses
  to ~1 sample immediately after a rotation. Archives are **purged past `TREND_MAX_AGE_DAYS`**,
  which is what actually bounds total storage; rotation alone only bounds the *live* file. Both
  follow `src/observe/store.ts`'s rotate-then-purge convention. Folding and purging are safe
  because neither rewrites a file a hook may be appending to.

  This is the second time this store was fixed by removing a mechanism rather than coordinating
  it. The rule that generalizes: **on an append-only file that a hook may write at any moment,
  never rewrite in place — rotate, fold the archives on read, and purge by age.**
- **The trend is read back and rendered by `mage footprint`.** A sampler whose output nothing
  reads is a write-only file, not an instrument: FT-18 asked whether mage's footprint is
  *growing*, and a single-point measurement cannot answer that. The report shows direction and
  delta across recent samples, and says "insufficient data" rather than drawing a trend from
  one or two rows.

### 7. Degradation is progressive, deterministic, and announced.

When generation would breach the budget, tiers are shed cheapest-value-first:

1. **Tier 1** — drop the keyword tail.
2. **Tier 2** — fall back to the bounded category map (`INDEX.md`'s shape).

**A suffix-dropping tier was specified and then deleted** (2026-07-19, on review). After §5 the
`_(…)_` suffix contains *only* caution statuses — **~141 B across 12 notes on this KB**. A tier
that sheds it would buy almost nothing and would strip the `stale-suspect` / `superseded` /
`archived` markers that `AGENTS.md` instructs agents to act on, at exactly the moment the index
is most degraded and least trustworthy. It also directly contradicted §5's "must survive".
**Caution statuses are never shed.** The cheapest thing worth dropping is the keyword tail.

Each tier is entered only if the previous was insufficient.

**The trigger policy is greedy, not threshold-per-tier:** render at full fidelity, and while the
result exceeds `BREACH_RATIO × cap` (90% × 25,600 = **23,040 B**), shed the next tier and
re-render. Stop at the first tier that fits.

**Measured engagement points** (implementation, 2026-07-19; synthetic entries averaging ~218 B;
re-numbered after the suffix tier was deleted):

| Tier | Engages at | Result |
| --- | ---: | --- |
| 0 — full fidelity | up to ~110 notes | ~21,800 B |
| 1 — drop keyword tail | ~130 notes | 28,340 → ~21,710 B |
| 2 — category map | ~150 notes | fallback |

These counts are a function of *entry size*, not note count — this KB's real entries average
**177 B** after §5, so its tiers engage later than the table suggests. The byte threshold is the
contract; the note counts are illustrative only.

**The ladder must be evaluated against both budget dimensions**, and this has a sharp
consequence: **tier 1 sheds bytes but not lines.** It leaves exactly one line per entry, so a KB
degrading under byte pressure buys itself *zero* line headroom, and degrading walks it closer to
a line cliff a byte-only meter cannot see. **Only tier 2 (the category map) reduces line
count.** A line breach therefore resolves to tier 2 directly; tier 1 is a no-op against it.
Announcements must name the dimension that triggered the degradation, so "shed keyword tails"
never appears as the remedy for a problem it cannot fix.

**Output MUST remain a pure function of the KB.** Prioritizing by note-read usage was
considered and **rejected**: `MEMORY.md` is generated *and committed*, so usage-dependent
content would produce different output per machine, spurious git diffs on every `mage index`,
and merge conflicts in a file nobody edits. It would also defeat prompt caching — a stable
index is billed at cache-read rates after turn one, while a churning one re-pays write rates
every session, making real cost *higher* while the meter reads lower.

**Every degradation announces itself** — a line in the generated file and in command output.
The defect being fixed is silent truncation; mage degrading silently would be the identical
failure wearing mage's own logo.

### 8. `mage doctor` fails on breach.

Warn at 70% (`ok: true` + detail), **fail at breach** (`ok: false`, not `optional`). The
footprint is mage-owned deterministic state — mage's own output exceeding mage's own budget —
which sits squarely inside [ADR-0037](0037-readiness-doctor-remit-and-autofix-line.md)'s remit.

**`--fix` does NOT auto-degrade.** Degradation changes what the agent can recall — a judgment
call with a real downside, not the mechanical repair `--fix` is scoped to. Doctor instructs;
`mage index` performs.

### 9. `mage footprint` is a visible human verb.

"What is mage costing me?" is a user question, not plumbing, so
[plan-0.0.10-coherence](../notes/plan-0.0.10-coherence.md)'s objection (plumbing mixed with
user verbs) does not apply. To avoid that plan's *second* problem — one job spread across
several verbs — the boundary is fixed here:

- **`mage footprint`** — context and recall **economics**: what mage costs and returns.
- **`mage doctor`** — pass/fail readiness.
- **`mage status`** — compact summary.

Absorbing `skills --metrics` into `footprint` is the coherent end state but is **out of scope**:
it is a breaking change to a Stop-hook path. The dashboard is a natural second consumer of the
same rollup, later.

### 10. ADR-0033's wrong figure is struck in place.

The "~4KB" claim in ADR-0033 §Consequences is replaced with a correction and a forward pointer
to this ADR. Per **FT-13** (*"a redirect/update should delete or reduce the old text, not just
append… the KB is a git repo, so data loss is low-risk"*): an immutable log protects
**decisions**; a measured *fact* that proved false is an error, and leaving it in place means
every future reader re-derives the same wrong conclusion. Git preserves what it said. The
edit is minimal — strike the claim, one pointer, no rewriting of the reasoning, because
ADR-0033's *judgment* was sound and only its estimate was wrong.

## Consequences

- **One-time churn across every mage KB.** The dedupe and suffix change alter generated output,
  so every user's `MEMORY.md` regenerates once on upgrade — a one-time cache invalidation that
  MUST be called out in the release notes rather than discovered.
- **Yield metrics start empty.** They need ~30 sessions to mean anything. The report MUST render
  "insufficient data", never zeros, which would read as "mage is never used."
- **~21% of pointers are not resolvable** (39 unmeasurable + 25 dead, of 307), so pointer
  leverage is a partial ceiling over a partial sample. Disclosed in output, never silently
  omitted.
- mage now has an opinion about its own size, and a KB can be told it is too big. That is the
  point: the alternative was silent recall loss.
- A second harness with a different cap moves one constant in the CC adapter — and *that* is
  when the ADR-0036 seam earns itself.

## Rejected

- **Pure observability, no ceiling** — would ship the measurement proving the defect alongside
  the defect.
- **Estimated tokens as the enforced unit** — enforcing a hard ceiling on a ±10% guess at
  exactly the boundary where error causes silent truncation.
- **A tokenizer dependency** — model-specific; contradicts harness neutrality; dates badly.
- **Usage-prioritized index content** — non-deterministic output in a committed artifact;
  defeats prompt caching (see §7).
- **Dropping the keyword tail entirely** — maximum headroom, but discards the 38% carrying real
  recall signal to solve byte pressure that §5 already relieves.
- **`doctor --fix` auto-degrading** — outside ADR-0037's auto-fix line.
- **An ablation harness (`mage replay --ablate`)** — the only way to earn a true savings number,
  and genuinely wanted, but agent runs are non-deterministic, so a single replay pair yields
  noise. **Deferred to its own ADR**; until it exists, no savings claim is made anywhere.

## Relations

- implements **FT-18** — [future-thoughts](../notes/future-thoughts.md)
- resolves the deferred size-cap question in
  [ADR-0033 — recall: `@import` the bounded root index](0033-recall-import-bounded-index.md)
- constrained by [ADR-0021 — offline, no telemetry; local signal](0021-offline-no-telemetry-local-signal.md)
- follows [ADR-0036 — defer the `HarnessAdapter` seam](0036-defer-harness-adapter-seam.md)
- bounded by [ADR-0037 — doctor's remit and the auto-fix line](0037-readiness-doctor-remit-and-autofix-line.md)
- consumes the note-read usage introduced by
  [ADR-0038 — graduate on note-read usage](0038-promote-note-rung-deleted-graduate-on-usage.md)
- pointer leverage rests on [ADR-0004 — capture insight, not copies](0004-capture-insight-not-copies.md)
- shares the mechanical-token failure mode with
  [promote-folds-mechanical-tokens](../notes/promote-folds-mechanical-tokens.md)
- command placement follows [plan-0.0.10-coherence](../notes/plan-0.0.10-coherence.md)
