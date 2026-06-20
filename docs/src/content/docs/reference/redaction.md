---
title: Redaction (two gates)
description: The two redaction gates that keep secrets out of your committed knowledge base — an inline scrub on capture and a blocking pre-commit scan.
sidebar:
  order: 5
---

mage captures what you do as you work, and turns the recurring parts into committed notes. That is exactly the kind of pipeline where a secret can leak: an API key pasted into a prompt, a token in a tool output, a connection string in an error. mage's job is to keep those out of anything that gets written — and especially out of anything that gets committed and shared.

It does this with **one deterministic redaction engine applied at two write boundaries** (ADR-0014). The engine is pure mage code: regex detectors plus a high-entropy check, no model and no network. What differs between the two gates is *behaviour at the boundary*, not the strength of the rules.

```mermaid
flowchart LR
  capture[Capture and distill] --> g1[Gate 1: scrub and continue]
  g1 --> scratch[Gitignored scratch]
  commit[git commit] --> g2{Gate 2: scan staged}
  g2 -->|live secret| block[Commit blocked]
  g2 -->|clean| land[Commit lands]
```

## Gate 1 — scrub and continue (on capture)

The first boundary is every write into the gitignored capture scratch (`mage observe`) and the note/lesson drafts mage distills. Here the engine runs in **scrub-and-continue** mode: it finds secret-shaped values, replaces them in place, and keeps going. Nothing blocks.

The replacement keeps the surrounding context but masks the value, so a draft stays readable:

```text
before:  api_key=sk-ant-XXXXXXXXXXXXXXXXXXXX
after:   api_key=[REDACTED:generic-key-value]
```

This is defense-in-depth. The scratch is gitignored, so it never commits — but it can still escape a machine via a sync, a backup, or sharing a file for debugging, so mage scrubs it before it is written, not before it is displayed. By the time a secret is on disk unredacted, redaction is already too late.

Because Gate 1 follows the [capture insight, not copies](../model/notes.md) principle, most verbatim secrets never reach a note in the first place — a note records the *insight*, not a paste of the source. Gate 1 is the net under that.

## Gate 2 — scan and block (on commit)

The second boundary is the commit. This is the one that matters most, because a commit is **tracked and shared**: the moment a missed secret reaches a commit, it is effectively public. So at this boundary the engine runs in **scan-and-block** mode.

Gate 2 is a git `pre-commit` hook that mage installs when you run `mage connect`. The hook runs:

```bash
mage redact --check --staged
```

If that scan finds a **live secret** in the staged changes, the hook prints where it is and **fails the commit** so the secret cannot land. PII (for example, an email address) is reported as advisory and does **not** block — only credential-shaped findings block.

A blocked commit looks like this (the value is always masked — mage never prints the raw secret):

```text
mage/notes/payments.md:line 12 · github-token · gh****cd
commit blocked — staged changes contain a live secret; remove it or commit with --no-verify
```

### What Gate 2 scans — and what it does not

Gate 2 is **not** a whole-repo secret scanner. It protects the one surface mage writes to and shares: the knowledge base. Concretely:

- It scans only **staged** files (the git index blobs — exactly what the commit would write), and only those **under the docs root** (`mage/` in-repo, or the whole repo in a hub).
- Your application source — `src/`, config, fixtures, everything outside the docs root — is **out of scope** and never scanned by this gate.
- A repository with no mage knowledge base is a no-op: the gate has nothing to protect, so it passes.

This narrow scope is deliberate: mage gates the seam *it* is responsible for, and stays out of the way of whatever secret-scanning you already run on the rest of the repo.

### The hook is installed for you

- `mage connect` installs the pre-commit hook. Pass `--no-git-hook` to skip it.
- `mage disconnect` removes it (again, `--no-git-hook` skips touching it).
- mage **never clobbers a hook it did not write.** If you already have a `pre-commit` hook, mage leaves it untouched and tells you to add the check yourself. It recognizes its own hook by an embedded marker.
- The hook **fails open on infrastructure, not on secrets.** mage ships as a Claude Code plugin, so `mage` may not be on the minimal PATH a git hook runs with. If `mage` is not found, the hook prints a skip notice and exits cleanly rather than blocking every commit with a false alarm. It only ever blocks on a genuine live-secret verdict.

The human escape hatch is the standard one: `git commit --no-verify` bypasses the hook. Prefer the allowlist below for confirmed false positives — it keeps the gate on.

## The redaction allowlist (non-bypass)

Deterministic detectors sometimes flag something that is not actually a secret — a generated artifact whose path looks high-entropy, or a documentation example. Reaching for `--no-verify` to get past it disables the *entire* gate for that commit, which is exactly when you do not want it off.

So mage gives you a **non-bypass** allowlist, kept in your committed `metadata.json` under a `redact` field (at the docs root). It lets a strict, no-`--no-verify` environment confirm a false positive while leaving the gate fully armed for everything else. Because `metadata.json` is committed and shared, the whole team gets the same allowlist.

It has two lists:

```json
{
  "redact": {
    "ignore": [
      "notes/generated-report.md",
      "work/**/fixtures.md"
    ],
    "allow": [
      "AKIAIOSFODNN7EXAMPLE"
    ]
  }
}
```

- **`ignore`** is a list of path globs (gitignore-style `*`, `**`, `?`, trailing `/` for a directory), each relative to the docs root. Any staged file whose docs-root-relative path matches is skipped.
- **`allow`** is a list of exact values, so a known-safe credential-shaped string (a documented example, a placeholder) stops being flagged anywhere it appears.

If `metadata.json` has no `redact` field, the allowlist is simply empty — it never changes gate behaviour by being absent. Note that the allowlist suppresses *false positives*; it does not weaken detection of real secrets you have not listed.

> **Upgrading from a `.redactignore` file?** Earlier releases kept this allowlist in a committed `mage/.redactignore` file. `mage migrate` (and `mage doctor --fix`) folds a leftover file into `metadata.redact` for you, then removes it — bare lines become `ignore` globs and `literal:` lines become `allow` values.

:::caution[Use real placeholders in examples]
Never put a real key or token in a note, an example, or the `redact` allowlist — not even to "test" the gate. Use obvious placeholders (`sk-ant-XXXXXXXX`, `<your-token>`, `AKIAIOSFODNN7EXAMPLE`). The allowlist is for confirmed false positives, not for parking live secrets.
:::

## What it detects

The engine ships deterministic detectors for the common credential shapes, including: private-key blocks, URL credentials (`scheme://user:password@host`), AWS access/secret keys, GitHub and GitLab tokens, Anthropic and OpenAI keys, Slack, Stripe, Google, and npm tokens, JWTs, `Authorization: Bearer` headers, generic `key=value` / `"key": "value"` assignments, `SCREAMING_SNAKE` env secrets, and standalone high-entropy blobs. Email addresses are detected as advisory PII (warn, never block).

It is intentionally conservative to limit false positives — for example, `${ENV}` interpolation placeholders and already-redacted markers are recognized and left alone, and common hash digests are not mistaken for secrets. The detector table is single-sourced in `src/redact.ts`; treat that file as the authority on exactly which patterns fire.

## Where to next

- [Knowledge-base layout](./layout.md) — the committed surface the gates protect.
- [The self-grooming loop](../loop/overview.md) — where capture and distill (Gate 1) sit in the lifecycle.
- [Commands](./commands.mdx) — `mage connect`, `mage disconnect`, and the `--no-git-hook` flag.
