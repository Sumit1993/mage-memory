---
type: plan
tags:
  - mage/roadmap
created: "2026-07-02"
updated: 2026-07-02
last_reviewed: 2026-07-02
status: active
provenance:
  repo: mage-memory
  commit: cacb49c
sources:
  - cc-session:3c5c8534-8611-4d9d-9087-9975da48dd44
keywords:
  - doctor
  - readiness
  - drift
  - wiring
  - recall
  - skills
  - capture
  - plugin-install
  - agents-md-staleness
  - index-freshness
  - version-stamp
  - auto-fix
  - self-verifying
  - connect
  - link
  - init
---

# mage — the readiness doctor: catch recall/skills drift, not just plumbing (pre-ADR)

**Status: grilled 2026-07-02 → [ADR-0037](../decisions/0037-readiness-doctor-remit-and-autofix-line.md) (proposed).**
First slice shipped (PR #54: three checks + the setup footer). The three [open
questions](#open-questions-for-a-grill) below are resolved in ADR-0037.

## Problem — green plumbing, misbehaving agent

A 2026-07-02 soak audit found the agent in the external units (prismalens, sreforge) not
working the way mage wants, even though every mechanical check passed. Three independent
drifts, none of which mage could see:

1. **Skills unreachable** — the `mage` Claude Code plugin was never installed, so
   `mage:learn` / `mage:groom` / `mage:guide` did not exist in any repo. The capture hooks
   fired and nudged "capture with `mage:learn`", but the skill was not there to run.
2. **Stale awareness block** — prismalens's `AGENTS.md` still told the agent to use
   `/mage-learn` (a retired slash name); the plugin skill is `mage:learn`. The block was
   correct when written, then the template moved and the block drifted.
3. **Stale index** — prismalens had a **9-line index for 62 notes**; sreforge's was stale
   too. "Read the index first" handed the agent almost nothing. This was probably the
   biggest reason for misbehaviour.

Root shape: **setup is a one-time act, correctness is ongoing.** `init` / `link` / `connect`
wire things once; then the plugin never gets installed, templates move, and notes accrete
past the index. Nothing re-verifies.

## The reframe — doctor's remit is the wrong layer

`mage doctor` today verifies the **capture plumbing**: node version, gitignore sinks, hooks
present, redact hook, state layout. All of that passed in the soaks. The failures live one
layer up — whether the agent can actually *find* and *act on* the knowledge.

An agent "works the way mage wants" only if three things hold. Doctor checks one:

- **Recall** — can it *find* the knowledge? → index fresh · `AGENTS.md` block current · MEMORY
  twin present. *(failed: stale index, `/mage-learn`)*
- **Skills** — can it *act*? → the plugin/skills are installed & reachable. *(failed: not installed)*
- **Capture** — will new knowledge *land*? → hooks wired · commandeer set · sinks ignored.
  *(this is what doctor checks today — and it passed)*

The fix is not a new command. It is teaching doctor to audit **recall** and **skills**, not
just capture. `init`/`link`/`connect` stay setup commands; doctor stays the drift detector.

## The checks (each maps to a real failure)

| check | detects | fix |
|---|---|---|
| index note-count / mtime vs notes on disk | stale index (the 9-line one) | `--fix` → `mage index` |
| `AGENTS.md` block version vs current template | retired command names (`/mage-learn`) | `--fix` → rewrite the mage-owned block |
| MEMORY twin present + points at the real index | recall-import ([ADR-0033](../decisions/0033-recall-import-bounded-index.md)) not wired | `--fix` → regenerate |
| `mage@` in host `installed_plugins.json` / skills-dir | skills unreachable | **print** `/plugin install mage@mage`, do NOT auto-run |
| commandeer (`autoMemoryDirectory`) points at this KB | capture leaks to the default host dir | `--fix` → re-run `connect` |

## Fix policy — split by reversibility (mage's opt-in ethos)

- **Auto-fix the safe, idempotent drift** under `--fix`: index regen, rewriting the
  mage-owned `AGENTS.md` block (it lives between `BEGIN/END mage` markers — mage owns it).
- **Detect-and-instruct for user-driven / global drift**: installing a plugin into
  `~/.claude` is a global act the README frames as "pick one of two ways". Doctor prints the
  exact command and stops — it never reaches into global host config silently. Same restraint
  as Gate-2 and the [autonomy ladder](../decisions/0030-agent-autonomy-ladder.md): the
  irreducible acts stay with the human.

## Make setup self-verifying (where init/link/connect help)

Adding more *checks* to the setup commands is the wrong shape — they run once, drift happens
later. Instead, **end `init`/`link`/`connect` by printing the doctor readiness summary.** If
prismalens's re-link had closed with `⚠ skills: mage plugin not installed → /plugin install
mage@mage`, it would have been caught at setup, not weeks into the soak. Setup and
verification become one flow.

Plus a hub-level **`mage doctor --all`** — sweep every linked project from the hub root — so
all units' drift surfaces in one command instead of a by-hand audit.

## Enabler — one cheap stamp makes drift O(1)

Detecting the two staleness cases reliably (not by fuzzy diff) needs a version marker in two
places:

- the mage-owned `AGENTS.md` block: `<!-- BEGIN mage v3 -->`, and
- the index frontmatter: `generated-at` commit + note count.

Then staleness is a comparison: "block v1, current v3 → stale"; "index reflects 9, disk has
62 → stale". Cheap, deterministic, no false positives.

## Open questions for a grill

Grilled 2026-07-02 → resolved in [ADR-0037](../decisions/0037-readiness-doctor-remit-and-autofix-line.md);
kept here as the record of what was pressure-tested.

1. **Is inspecting `~/.claude/plugins` mage's job?** [ADR-0009](../decisions/0009-no-runtime-automation-rides-host-hooks.md)
   says "no runtime of our own." Reading host config to check "is my plugin installed"
   brushes that line. Precedent: doctor already reads host hook settings. Decide deliberately.
2. **Where exactly is the auto-fix safety line?** Which drift mage silently repairs vs only
   reports. A safety boundary in the Gate-2 / autonomy-ladder family.
3. **Version-stamp format** for the `AGENTS.md` block + index — a mild format commitment that
   tooling will depend on; hard to walk back once shipped.

## Evidence (2026-07-02 soak)

Fixed live: installed `mage@mage` (user scope, 5 skills); regenerated hub indexes
(prismalens 90 notes / 3 wings, sreforge 46); re-linked prismalens (`/mage-learn` →
`mage:learn`). See [soak targets](soak-targets.md). All three drifts were invisible to the
then-current `mage doctor`.

## Relations
- verifies [ADR-0032 — capture-redirect native memory](../decisions/0032-capture-redirect-native-memory.md)
- verifies [ADR-0033 — recall: import the bounded index](../decisions/0033-recall-import-bounded-index.md)
- bounded_by [ADR-0009 — no runtime; automation rides host hooks](../decisions/0009-no-runtime-automation-rides-host-hooks.md)
- ethos_from [ADR-0030 — opt-in agent autonomy ladder](../decisions/0030-agent-autonomy-ladder.md)
- precedent [Gotcha — connect doesn't ensure the sink is gitignored](connect-doesnt-ensure-ignores.md)
- surfaced_by [mage soak — the dogfood targets + monitor](soak-targets.md)
- promoted_to [ADR-0037 — doctor's remit + the auto-fix line](../decisions/0037-readiness-doctor-remit-and-autofix-line.md)
- sequenced_in [release sequence](plan-release-sequence.md)
