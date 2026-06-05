---
name: clarify
description: |
  Identify and resolve underspecified areas in a feature spec by interviewing
  the user. Recommended before mage:plan — specs are routinely underspecified, and
  mage:plan produces better output when ambiguities are flushed out first. Operates
  on a spec note inside a mage work unit. Adapted from github/spec-kit (MIT) —
  see ATTRIBUTION.md.
allowed-tools: Read, Write, Edit, Glob, Grep, Bash
disable-model-invocation: true
---

<!-- Adapted from github/spec-kit (mage:clarify command), MIT licensed. See ATTRIBUTION.md. -->

# mage:clarify — interactively resolve underspecified spec areas

Spec-Driven Development is one authoring path within mage, a portable file-based
knowledge base. This skill sharpens a spec note inside its `work/<slug>/` lab
notebook before `mage:plan` turns it into a plan.

## Path resolution (added by mage)

Before reading or writing any file referenced as `.specify/...`, `work/...`, or
similar relative path in this skill, resolve the docs root for the current repo:

1. Find the nearest `mage/metadata.json` walking up from your current dir.
   If absent, abort: tell the user to run `mage init` first.
2. Parse it. Note `mode`, `project`, `hub_path`.
3. Compute docs root:
   - `mode == "in-repo"` → docs-root = `<code-repo>/mage/`
   - `mode == "external"` → docs-root = `<hub_path>/projects/<project>/mage/`
4. Treat `work/<slug>/` references as `<docs-root>/work/<slug>/`.
5. Suggest commits, never auto-execute. mage never auto-commits.

---

## What this skill does

Reads an existing spec, identifies areas where it's vague, ambiguous, or
silently under-specified, and **interviews the user** with targeted questions
to nail down the unknowns. Updates the spec in place with clarifications.

## When to invoke

- After `mage:specify`, before `mage:plan`. Strongly recommended even when the spec
  *looks* complete — there are almost always implicit assumptions to surface.
- After significant changes to a spec, to re-validate that it's still coherent.

## Workflow

1. **Identify the target spec**. If `mage:clarify` is invoked with a work-unit name
   or number, use that. Otherwise list `<docs-root>/work/*/` and prompt the
   user to pick the one to clarify.

2. **Read the full spec** at `<docs-root>/work/<NNN>-<name>/spec.md`.

3. **Read the constitution** at `<docs-root>/notes/principles.md`
   to know what principles must be respected.

4. **Scan the spec for underspecified areas**. Common categories:
   - **Edge cases not addressed**: what happens at boundary conditions?
   - **Failure modes**: what does the system do when X fails?
   - **Data shape ambiguities**: "user data" is mentioned but no schema.
   - **Cross-cutting concerns**: auth? logging? rate limits? observability?
   - **Out-of-scope unclear**: is X in or out?
   - **Acceptance criteria not testable**: "users like it" vs "p99 < 300ms".
   - **Success criteria missing measurable thresholds**.
   - **Open questions in the spec**: explicit ones that haven't been resolved.

5. **Generate a prioritized list of questions** — 3 to 7 questions max per
   round. Don't dump 30 questions on the user.

6. **Ask the questions one at a time** (or in small batches if related), and
   integrate each answer into the spec immediately. Don't batch everything for
   the end.

7. **Update the spec** with the resolutions. Add an "## Open questions"
   section if any remain, marking each with `(unresolved — needs decision before mage:plan)`.

8. **Suggest the commit** when done — mage never auto-commits, it only suggests.
   Pick the right repo: the code repo for `in-repo`, the hub for `external`:
   ```bash
   # mode=in-repo example (commit in the code repo):
   git -C <code-repo> add mage/work/<NNN>-<name>/spec.md
   git -C <code-repo> commit -m "clarify: <NNN>-<name> (<N> questions resolved)"

   # mode=external example (commit in the hub):
   git -C <hub_path> add projects/<project>/mage/work/<NNN>-<name>/spec.md
   git -C <hub_path> commit -m "clarify: <NNN>-<name> (<N> questions resolved) for <project>"
   ```

## Quality bar

A good `mage:clarify` session:
- Surfaces 3-7 substantive issues, not 30 nitpicks
- Each question is specific enough that the user can answer in 1-3 sentences
- The updated spec has no ambiguous "etc." or "and so on" phrasings
- "Out of scope" is concrete

## When to stop

`mage:clarify` is done when:
- All categories scanned have been addressed
- Remaining open questions are noted in the spec with an `(unresolved)` marker
- The user explicitly says "good enough — move on to mage:plan"
