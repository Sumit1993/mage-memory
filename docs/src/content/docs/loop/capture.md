---
title: Capture (observe)
description: How mage captures session signal into the git-ignored learnings scratch without ever blocking your work.
sidebar:
  order: 2
---

Capture is the first stage of the loop. It is how mage builds up the raw material that everything else distills, promotes, and grooms. It is passive: you never type a capture command. Your coding host fires hooks as you work, and each one runs `mage observe`, which appends a single event to a git-ignored scratch directory.

This passive seam is distinct from the *deliberate* capture you trigger on the spot: the `/mage:learn` skill, which drafts a finished note for you (insight, procedure, pointers) and writes it after you confirm. See [Install and Quickstart](../start/quickstart.md) for `/mage:learn`; the rest of this page is the passive `mage observe` seam that feeds the loop.

## What `mage observe` is

`mage observe` is a hook-fired capture seam. It reads one Claude Code hook payload on stdin, maps it to one structured event, scrubs the free-text fields for secrets, and appends it to `.mage/learnings/` — the observed scratch. It is a plumbing command: you do not run it by hand, the hooks run it for you (see how to wire those in [Install and quickstart](../start/quickstart.md), via `mage connect`).

The scratch is **git-ignored** and auto-pruned. It is not knowledge yet — it is the deterministic trail of what happened, the substrate the later stages read.

## It never blocks your work

This is the load-bearing property of capture. `mage observe` is **fail-open**: every path resolves to a clean exit, so a malformed payload, an unreadable scratch, a missing knowledge base, or any filesystem error silently does nothing rather than breaking your session. If there is no knowledge base under the working directory, it writes nothing at all. Capture is meant to be invisible — it should never be the reason a tool call or a session start hangs.

Secret-scrubbing runs the other way: if the redactor itself throws on a field, that field degrades to a sentinel rather than leaking the raw value. Capture fails open; redaction fails closed.

## What each hook captures

mage wires several hooks, each firing `mage observe` at a different moment, so the scratch carries a complete trail of a chapter. The events it records:

- **SessionStart** — the session-start context (harness, working directory, mage version, and the start `source`).
- **UserPromptSubmit** — the intent of each prompt you submit.
- **PostToolUse** — each tool use: which tool ran, which files it touched, and whether a Skill loaded.
- **PostToolUseFailure** — tool failures, captured as a distinct, high-value signal (an error followed by the fix that worked is exactly the kind of gotcha worth a note).
- **PreCompact** — a marker for the chapter boundary, written just before the host compacts.
- **SessionEnd** — the session ending.
- **Stop** — the agent's final reply (read from the transcript).
- **SubagentStop** — an autonomous subagent's final reply; this is the one capture point for multi-agent work, since a subagent's tool calls never reach the main session's hooks.

A separate hook, `mage:metrics:Stop`, is not capture — it rolls up context-match (did the skills that auto-loaded match the work?). That feeds [Optimize](./optimize.md), not the scratch.

## Capture on Claude Code: the native-memory redirect (Gate-0)

The `mage observe` seam above records the *trail*; the lesson and recurrence stages distill notes from it. On Claude Code there is a second, more direct capture seam: the host's own native-memory reflex, **redirected into mage**.

Claude Code writes memories on its own. `mage connect` points its `autoMemoryDirectory` at the knowledge base and wires a **Gate-0** `PreToolUse` hook on `Write`/`Edit`. When the host saves a memory, Gate-0 fires before the file touches disk and:

- **scrubs** secrets and PII out of the content before it touches disk (the same redactor the rest of the pipeline uses), so the write lands redacted — the frontmatter is deliberately left alone, since normalization to mage's schema happens later, at the durable boundary. The scrub is a pure-regex rewrite of the raw bytes — no parse step that could fail — and the hook honors the same fail-open contract as `mage observe`: an infrastructure error passes the write through rather than breaking the session (a generated-index target, a failed secret scan and the first rung-less write of a session are the only denials); or
- **denies** the write outright if it targets a generated index (`INDEX.md`, `MEMORY.md`, a wing index) — mage owns those and regenerates them; or
- **asks the ladder once** per session when the memory carries no `rung` (below).

The result lands flat at the docs-root top. `mage groom` lists it where it lies and walks it up the ladder with the other notes. See [Stage and groom](./stage-groom.md).

```mermaid Gate-0 on Claude Code: a native-memory write is intercepted before disk — a generated-index target is denied, a flat topic note is scrubbed in-flight and lands at the docs-root top, and groom walks it up the ladder. Anything else passes untouched.
flowchart TD
  w["host native-memory Write / Edit"] --> g0{"Gate-0 · PreToolUse intercept"}
  g0 -->|"targets a generated index<br/>(INDEX.md · MEMORY.md · _index.*.md)"| d["deny — mage owns it;<br/>mage index regenerates it"]
  g0 -->|"a flat .md note at the docs root"| s["scrub secrets in-flight —<br/>redacted before any byte hits disk"]
  g0 -->|"anything else"| p["pass untouched"]
  s --> i["flat note at the docs-root top"]
  i --> gr["mage groom lists it where it lies —<br/>climb, delete or keep"]
```

Like `mage observe`, Gate-0 is **fail-open**: any stdin/parse/redact/filesystem error emits nothing and exits clean, so a capture gate can never block the host's write. It is adapter-specific and active only when Claude Code's `autoMemoryEnabled` is on; on other harnesses the volitional directive (write a mage note to the inbox) is the capture path.

For the exact event names, hook ids, and the command each runs, see the [Hooks reference](../reference/hooks.mdx).

## The ladder, asked once per session

A memory write is a Write or Edit to a file under `notes/`, or to a flat `.md` file at the docs root where Claude Code's native memory lands. Gate-0 looks at the file as it will read after the write.

If that frontmatter carries a `rung`, the write passes. If it does not, the first such write of a session is denied with the ladder below. The agent can take a fact up a rung, or add `rung` and write again. Every later write in that session passes, and so does any write that carries a `rung`, so the gate never stops the same session twice. The fields a note needs after that are in [Admission and triggers](../model/notes.md#admission-and-triggers).

The decision path:

1. **Target check**: a write outside `notes/` and outside the flat root passes untouched. A write to a generated index (`MEMORY.md`, `INDEX.md`, `_index.*.md`) is denied, because `mage index` regenerates it.
2. **Scrub**: the content goes through redaction first. If the scan itself fails, the write is denied and no marker is written; a secret in a committed knowledge base is published. Otherwise a secret is masked in place, and a clean `notes/` write is left to your normal permission prompt.
3. **Ladder**: a write with no `rung`, in a session with an id, where this session has not been asked yet, is denied with the text below. Asking is recorded in a marker file under `.mage/ladder/`. If the marker cannot be written, the write passes.

The reply, quoted from `LADDER_TEXT` in `memory-hook.ts`:

```text
mage:ladder (asked once this session; write again and it passes)
Before saving this memory, take each fact in it to the highest rung that can carry it.
Build that, then keep as a note only what no rung above can carry. Copy the template that fits.

1 impossible: a deny rule in .claude/settings.json
  {"permissions": {"deny": ["Edit(generated/**)", "Write(generated/**)"]}}
2 check: a test, lint rule or pre-commit check that fails on the mistake
  # .git/hooks/pre-commit
  if git diff --cached -U0 -- src | grep -q '^+.*console\.log'; then echo "use logger, not console.log"; exit 1; fi
3 hook: a PreToolUse hook in .claude/settings.json that blocks with a reason
  {"hooks": {"PreToolUse": [{"matcher": "Bash", "hooks": [{"type": "command", "command": "node .claude/hooks/commit-issue.mjs"}]}]}}
  The script reads the tool call JSON on stdin; to block it prints
  {"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": "deny", "permissionDecisionReason": "commit subjects need (#N)"}}
4 rule: one line in AGENTS.md carrying an id
  - Keep commit subjects under 60 characters. [mage:repo/rule/short-commit-subjects]
5 note: add to the note's frontmatter
  rung: note
  trigger: {when: "<the moment it matters>", match: ["Bash(<cmd> *)", "Edit(<glob>)"]}
  pointer: "[<source>](<path or issue>)"
A memory that carries rung: is never stopped.
```

## What happens to the scratch

Capture only writes the trail. The later stages read it:

- The **boundary nudge** distills the just-closed chapter from the scratch and drafts forgotten lessons. See [The boundary nudge](./nudge.md).
- **Distill** and **promote** read closed chapters of the scratch to surface first-sight insights and recurring patterns. See [Promote and graduate](./promote-graduate.md).

Capture is the only stage that runs automatically on every event. Everything downstream is gated on a chapter closing and on your confirmation.
