---
name: distill
description: |
  Mine mage's own observed scratch (`.learnings/*.jsonl`) for durable notes —
  the judgment half of `mage distill`. Fires at session boundaries, after a
  PreCompact, or when the user says "distill", "mine the learnings", or
  "what did we learn". Runs the deterministic reader for candidate clusters,
  judges each through four lenses led by user corrections, then funnels keepers
  through the shared capture pipeline (classify → overlap-check → redact →
  confirm → write). Nudge-invoked, not user-only.
allowed-tools: Read, Grep, Glob, Write, Edit, Bash
---

# mage:distill — mine the observed scratch into notes

`mage observe` writes a scratch record of the session to mage's own
`.learnings/*.jsonl` (the ADR-0015 schema). **distill turns that scratch into
durable notes.** It is the back half of the same loop `mage:learn` serves, but
fired at a different moment: `learn` captures *this one finding now*;
`distill` mines *the accumulated record* once a stretch of work has closed.

This skill is the judgment tier. The deterministic reader (`mage distill --json`)
groups un-distilled events into candidate clusters and attaches cheap signals —
**no model**. You read those clusters, decide what is note-worthy, and write
notes **on first sight** (a striking insight earns a note the first time it is
seen; recurrence and note→skill graduation are 0.0.8 — do not gate on them here).

Notes are the reusable **insight + procedure + pointers**, never a copy of the
source (see `CONVENTIONS.md`). mage distills **only its own** `.learnings/` —
foreign memory stores (ECC instincts, Claude `MEMORY.md`) are not harvested
(ADR-0018 §8).

## Steps

1. **Resolve the knowledge base.** Find the nearest `mage/metadata.json`
   (walk up). docs root = `<repo>/mage/` (in-repo) or
   `<hub_path>/projects/<project>/mage/` (external). If none, tell the user to
   run `mage init` first — there is nothing to distill into.

2. **Run the deterministic reader.**
   ```bash
   mage distill --json
   ```
   It reads mage's own `.learnings/*.jsonl` from the **last watermark forward**,
   chops un-distilled events at `compact`/session boundaries (the natural
   "chapters"), keeps only the salient events, and emits a `DistillManifest`:
   ```jsonc
   {
     "clusters": [ /* candidate clusters, each with salient signals */ ],
     "cursors":  { "<session>": <offset>, … },  // advance these in step 5
     "capped":   false                          // true ⇒ output was capped
   }
   ```
   The reader only offers **closed** segments (up to the last
   `compact`/`session_end`); the in-flight session is never half-distilled. If
   `clusters` is empty, there is nothing new — say so and stop. If the manifest
   read fails, it fails open to empty (nothing to do), not an error.

3. **Judge each cluster through the four lenses** — *led by user corrections*.
   For every cluster, ask whether it carries a durable insight, weighing these
   in order (the reader flags the signals; you reason over them):

   | Lens | What it looks like in the cluster | mage note-type |
   |---|---|---|
   | **① User corrections & nudges** *(first-class — look here first)* | a `user_prompt` right after an agent action: "no, do it this way", "actually I meant…", a steer or a standing rule | `principle` / `gotcha` |
   | **② Error → fix** | a `tool_use` with `ok:false` followed by the fix that worked | `gotcha` |
   | **③ Repeated workflow** | the same tool sequence run several times | `playbook` |
   | **④ Tool / approach preference** | a consistent tool or approach choice | `playbook` / `principle` |

   **Direct human feedback is the highest-signal durable knowledge** — a user
   correction is a standing intent the agent should never relearn, so it
   outranks a one-off stack trace. You may **split** a cluster that holds two
   unrelated insights or **merge** clusters that are really one; the reader's
   chunking is mechanical scaffolding, not a verdict. Drop routine clusters with
   no durable lesson.

4. **For each kept insight, run the SHARED CAPTURE PIPELINE** (the same back half
   `mage:learn` defines — see that skill's **Steps**; do not re-derive it):
   - **Classify** — pick a `type` (open vocab: `principle`, `gotcha`,
     `playbook`, `interface`, …), the **wing** and **room** → tag `#<wing>/<room>`.
   - **Overlap-check vs `INDEX.md` (two-stage).** First a deterministic
     pre-filter: cluster candidates that share keywords / wing / touched-paths,
     and for each candidate pull only the `INDEX.md` lines whose keywords
     intersect — not the whole index. Then decide **UPDATE** an existing note,
     **NEW** note, or **supersede** a contradicted note (mark the old
     `status: superseded`, link forward — never silently overwrite). Dedup
     within the batch too: two candidates restating one insight collapse to one.
   - **Redaction Gate 2 (ADR-0014, BEFORE write).** Run `mage redact <draft-file>`
     on each drafted note. A **LIVE** secret (non-zero exit) **STOPS that one
     note** — strip it (`mage redact --strip`) or remove it by hand; never write
     a secret into a tracked note. One blocked note does not block the batch.
   - **Show the human, write only after confirm.** Present the batch — new
     notes, UPDATEs, supersedes, and anything the redaction gate blocked — as one
     review. Write under `mage/notes/` only after a yes.

5. **Advance the watermark — only after the human dispositions the batch.**
   ```bash
   mage distill --seen <session>:<offset>   # one per session, from manifest.cursors
   ```
   Use the offsets from `manifest.cursors`. This advances mage's per-session
   bookmark **past everything the human just reviewed** — both the notes you
   kept *and* the clusters they skipped (advancing past a skipped cluster is
   distill's negative memory; it will not be re-offered). The reader is a pure
   read; **`--seen` is the only thing that moves the bookmark**, and only here,
   after disposition. An interrupted run that never reaches this step does no
   harm: a re-run safely re-offers, and the overlap-check dedupes anything
   already written.

6. **Honor `capped`.** If `manifest.capped` is `true`, the reader trimmed a huge
   chapter to fit (it `log()`-ed the spill — never silent). Tell the user the
   output was capped and that **re-running continues** from the new watermark to
   drain the rest.

7. **Suggest follow-ups (never auto-run):**
   ```bash
   mage index          # refresh INDEX.md so the new notes are findable
   git -C <repo> add mage && git -C <repo> commit -m "distill: <n> notes"
   ```
   mage never commits for you — it suggests, you run.

## Worked example — a user correction → a `principle` note

The richest distill source is not a stack trace; it is the human telling the
agent how things are done here. The reader's `clusters[i].signals` is an **object
of string arrays** (not an array of tagged objects) — `prompts`, `corrections`,
`failures`, and `tools` — alongside a top-level `span` and `hint`. Suppose the
reader returns a cluster like:

```jsonc
{
  "session": "2026-06-08T14-02",
  "span": "L1-L4",
  "signals": {
    "prompts":     ["no — this repo is pnpm-only, use pnpm", "pnpm, not npm"],
    "corrections": ["no — this repo is pnpm-only, use pnpm", "pnpm, not npm"],
    "failures":    [],
    "tools":       ["Bash: npm install", "Bash: npm run build"]
  },
  "hint": "a user correction (likely a preference/principle) + a repeated workflow (likely a playbook)"
}
```

Lens ① fires twice: `signals.corrections` holds two steers — the agent reached
for `npm` (see `signals.tools`), the human corrected it to `pnpm` both times.
That is a **standing rule**, not a one-off — exactly the kind of durable intent a
note should carry so the agent never relearns it. (A `correction` is just a
`prompt` whose nearest preceding act was a `tool_use`, so it also appears in
`signals.prompts`.) Draft a `principle` note **on first sight** (do not wait for
a third correction):

```markdown
---
type: principle
tags: [repo/tooling]
created: 2026-06-08
last_reviewed: 2026-06-08
provenance: { repo: <repo>, work: distill-2026-06-08 }
status: active
---

# This repo is pnpm-only

Use `pnpm`, never `npm`, for install / build / scripts here — the human
corrected `npm install` → `pnpm install` and `npm run build` → `pnpm build`.
`npm` produces a stray `package-lock.json` that fights the committed
`pnpm-lock.yaml`.

## Relations
- governs [release playbook](../repo/release-playbook.md)
```

Then: overlap-check (is there already a tooling note for this wing?), run
`mage redact` on the draft, show the human, write on confirm, and advance the
watermark with `mage distill --seen 2026-06-08T14-02:<offset>`.

Contrast lens ② (error → fix): a `tool_use` `ok:false` then a working command
becomes a `gotcha` the same way — but the user-correction lens leads because
human feedback is intent, not just a fixed symptom.

## Quality bar

- Leads with user corrections and standing intent, not error-fix volume.
- Captures the *method and the path* (insight + procedure + pointers); points to
  canonical sources, never mirrors them.
- One `#<wing>/<room>` tag so the note lands in the index and the wing skill.
- Watermark advances **only** on explicit disposition; re-runs are safe.

## See also

- **mage:learn** (`skills/learn/SKILL.md`) — the shared capture pipeline
  (classify → overlap-check → Gate 2 → confirm → write) this skill funnels into.
- **ADR-0018** (`mage/decisions/0018-mage-distill-observed-scratch-reader.md`) —
  distill as deterministic reader + judgment skill; first-sight capture;
  CLOSED-only watermark; mage reads only its own artifacts.
- **ADR-0015** (`mage/decisions/0015-mage-observe-capture-schema.md`) — the
  `.learnings/*.jsonl` event schema the reader consumes.
- **ADR-0014** (`mage/decisions/0014-two-gate-redaction.md`) — `mage redact`
  Gate 2 before any tracked write.
