---
type: gotcha
tags: [mage/redaction]
created: "2026-06-08"
updated: "2026-06-08"
last_reviewed: "2026-06-08"
status: active
provenance:
  repo: mage-memory
  work: 0.0.7-distill-build-dogfood
sources:
  - src/staged-scan.ts
  - src/git-hooks.ts
  - src/commands/connect.ts
keywords: [gate2, pre-commit, hook, redaction, scope, docs-root, fixtures, connect, dogfood]
---

# Gotcha — scope Gate-2 to the knowledge base, not the whole repo

The 0.0.7 dogfood installed the redaction **pre-commit hook** (ADR-0018 §7) and
then could not commit the build: it flagged ~16 "live secrets" — **all of them
redaction *test fixtures*** in `src/**/*.test.ts`. A redaction tool's tests
*must* contain secret-shaped strings (`sk-ant-…`, `ghp_…`, high-entropy blobs) to
prove the detectors fire; a deterministic scanner cannot tell a fixture from a
live key.

**Root cause (a scope bug, now fixed).** `scanStaged` scanned the **whole** staged
set. But Gate-2's mandate ([ADR-0014](../decisions/0014-two-gate-redaction.md) §2)
is the **tracked, *shared* knowledge base** — the notes/skills mage authors under
the docs root (`mage/` in-repo, or the hub root). That is the *only* surface mage
writes to and the only seam where a distilled secret becomes public. App source
(`src/`, incl. its fixtures) is **out of scope by design** — mage is not a general
repo secret-scanner ([ADR-0010](../decisions/0010-durable-memory-not-coordination-layer.md);
that's gitleaks' job).

**Fix / principle.** `scanStaged` now resolves the docs root and scans only staged
files under it (a hub scans everything, since the repo *is* the KB; no KB ⇒ a no-op
gate). The general lesson: **scope a security gate to exactly the surface it
protects, never "everything"** — and a scanner run over its own repo must
scope-exclude its own fixtures (here by path; alternatively an allowlist or
runtime-concatenated fixtures). Because of the scoping, **mage can run its own
Gate-2 hook** — it scans `mage/`, never the `src/` fixtures.

**Topology check (verified).** The scope follows `resolveDocsRoot`, so it adapts:
**in-repo / hybrid / external** code repos scope to `mage/` (app `src/` skipped);
a **hub** scopes to the repo root and scans the whole vault (correct — the hub
*is* the KB; no `src/` to worry about). **Known edge** (fail-*open*, not a
false-block): the commit-time hook runs from the git worktree root and
`resolveDocsRoot` only walks *up*, so a `mage/` buried in a non-root **subdir**
isn't found by the hook → a no-op gate there. Keep the KB at the repo root (the
conventional layout).

**Sibling gotcha (test isolation).** `connect({ user: true })` installed the git
hook into the **real cwd**: the git-hook target is `process.cwd()`-based and
**independent of the `--user` settings target**, so a test that mocked `HOME` but
not `cwd` leaked a hook into the real repo. When testing `connect`/`disconnect`,
isolate **both** the settings path *and* `cwd` (or pass `gitHook: false`).

See [ADR-0018 §7](../decisions/0018-mage-distill-observed-scratch-reader.md).
