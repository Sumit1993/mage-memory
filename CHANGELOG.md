# Changelog

mage (npm package `mage-memory`, CLI `mage`) is a portable, file-based, offline
knowledge base for AI coding agents: durable git-backed notes — insight,
procedure, and pointers, never copies of sources — navigable as an Obsidian
graph and usable by any agent. Nothing leaves your machine.

The roadmap is capped at **0.1.0**; there is no 1.0.

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.0.12](https://github.com/Sumit1993/mage-memory/compare/v0.0.11...v0.0.12) (2026-07-02)


### Features

* **0.0.12:** Claude-Code capture adapter (inline-capture instruction + boundary nudge) ([#27](https://github.com/Sumit1993/mage-memory/issues/27)) ([d11dc25](https://github.com/Sumit1993/mage-memory/commit/d11dc25f2e716a9fa74f919603551fca9525a16d))
* **0.0.12:** offer the npx skills install route alongside the plugin (init hint + README) ([#34](https://github.com/Sumit1993/mage-memory/issues/34)) ([5a04601](https://github.com/Sumit1993/mage-memory/commit/5a046011923e98deaca6aaa92d554f6b077244e3))
* **0.0.12:** one .mage/ state home + redact config in metadata.json (ADR-0025) ([#31](https://github.com/Sumit1993/mage-memory/issues/31)) ([ca01271](https://github.com/Sumit1993/mage-memory/commit/ca012718bbef72de82816df165e1d35b849cf6b8))
* **0.0.12:** organic grooming loop — portable core (mage stage/groom + .staging) ([#25](https://github.com/Sumit1993/mage-memory/issues/25)) ([e1b3014](https://github.com/Sumit1993/mage-memory/commit/e1b3014b55dcee23b3e4baf0980a5f59dbabee95))
* **adopt:** mage adopt onboarding dispatcher + dream scan-scope fix ([fbe6ea5](https://github.com/Sumit1993/mage-memory/commit/fbe6ea521086efe3c6caed62ff364825a4f0b77a))
* **autonomy:** opt-in Operator/Approver/Overseer grooming autonomy ladder (ADR-0030) ([#37](https://github.com/Sumit1993/mage-memory/issues/37)) ([5926e0e](https://github.com/Sumit1993/mage-memory/commit/5926e0e1b02d09befe374eb653b6fc7c4b4eeb77))
* **cc-adapter:** commandeer CC auto-memory — Gate-0 capture + MEMORY.md recall (ADR-0032/0033) ([552756e](https://github.com/Sumit1993/mage-memory/commit/552756e11be8af10b61f331c2ad8b3df27555019))
* **cc-adapter:** Gate-0 PreToolUse capture hook + PostToolUse nudge (ADR-0032 Phase 3) ([30d5cf5](https://github.com/Sumit1993/mage-memory/commit/30d5cf58e14241ef0f50a4b9e118f0fff195a376))
* **cc-adapter:** groom ingest of the capture inbox (ADR-0032 Phase 6) ([997d439](https://github.com/Sumit1993/mage-memory/commit/997d439bd9145b22640480bb702d3a29da16286f))
* **cc-adapter:** native CC memory -&gt; mage note schema-map (ADR-0032 Phase 2) ([0367c16](https://github.com/Sumit1993/mage-memory/commit/0367c16ab493899eca0aac2e7436c3a01c929b4e))
* **cc-adapter:** wire the commandeer tier into connect/disconnect (ADR-0032 Phase 4) ([016ccf8](https://github.com/Sumit1993/mage-memory/commit/016ccf84a95763a286f3029bca6ae6295c635550))
* digest-&gt;agent boundary capture (ADR-0029) — replace deterministic drafting ([#36](https://github.com/Sumit1993/mage-memory/issues/36)) ([aad31f0](https://github.com/Sumit1993/mage-memory/commit/aad31f0c90dbbf02dfd5af23d094feb75009caa1))
* **doctor:** add recall+skills readiness checks and a setup summary ([4e5491c](https://github.com/Sumit1993/mage-memory/commit/4e5491cecefefe9139383523a3d8f31936b34c06))
* **doctor:** recall+skills readiness checks and a setup summary ([81f179d](https://github.com/Sumit1993/mage-memory/commit/81f179d35c17ac820c9fc47f18087a999a6cbef6))
* **flatten:** normalize harness frontmatter at the durable boundary (ADR-0035) ([b5bbf93](https://github.com/Sumit1993/mage-memory/commit/b5bbf9352b6ba1117fe18e99b0f248c2f5e2a59a))
* **flatten:** Stop-hook working-tree sweep (ADR-0035 best-effort layer) ([cad6545](https://github.com/Sumit1993/mage-memory/commit/cad6545d0671b7ff056ced36a7b9e4f53794f49d))
* **index:** emit MEMORY.md, the Claude Code adapter index twin (ADR-0032/0033, Phase 1) ([df4760c](https://github.com/Sumit1993/mage-memory/commit/df4760cdcd8ae109e5bc79b6235086c2f211c5da))
* **nudge:** user-visible systemMessage + operator asks + weekly dream-health tick ([5ce48d7](https://github.com/Sumit1993/mage-memory/commit/5ce48d74bd75d2d098f700981d26fa1175cd0f0f))
* **nudge:** user-visible systemMessage + operator asks + weekly dream-health tick ([2649ac4](https://github.com/Sumit1993/mage-memory/commit/2649ac4e5ca6a2b4dbd95e303266917469db0d96))
* **nudge:** warm, keeper-naming offer + agent-offered dream scan ([44a25c9](https://github.com/Sumit1993/mage-memory/commit/44a25c9a9ee44ea54d4ab73eb3971c57a2886779))
* **provenance:** stamp provenance at note creation (ADR-0031 Phase 1) ([5915664](https://github.com/Sumit1993/mage-memory/commit/5915664aa3a870e6a9f3c11a7f89d6c995701905))
* **provenance:** stamp provenance at note creation (ADR-0031 Phase 1) ([#43](https://github.com/Sumit1993/mage-memory/issues/43)) ([1a526e5](https://github.com/Sumit1993/mage-memory/commit/1a526e537465858e71b7ddba763e9bef419cff31))


### Bug Fixes

* **0.0.12:** one shared hub-scope enumerator + fan-out hint for bare hub distill/promote ([#33](https://github.com/Sumit1993/mage-memory/issues/33)) ([3344bae](https://github.com/Sumit1993/mage-memory/commit/3344baef7fae1640f04078014044610e3b5b00b4))
* **cc-adapter:** Gate-0 never falls through unscrubbed; POSIX-normalize paths (ADR-0032 review) ([a9eae63](https://github.com/Sumit1993/mage-memory/commit/a9eae63b80e60ae7fda47d197e2ba544d29a07c1))
* **cc-adapter:** Gate-0 spike refinements + autoMemoryDirectory ownership (ADR-0032 Phase 5) ([06d4a7a](https://github.com/Sumit1993/mage-memory/commit/06d4a7a47b0ef2f303f680feea564144eba24978))
* **cc-adapter:** harden inbox ingest — non-destructive cover, fail-soft, idempotent (ADR-0032 review) ([c11ba34](https://github.com/Sumit1993/mage-memory/commit/c11ba3479c5e8c7d32e46cadad72d23af32a466b))
* **cc-adapter:** key inbox-ingest idempotency on capture identity, not session id ([f1a04b1](https://github.com/Sumit1993/mage-memory/commit/f1a04b1aa486a1c5d4a1abd590fa599e90868f68))
* **doctor:** skip the GitHub network probe under test (flaky 5s timeout) ([0357e19](https://github.com/Sumit1993/mage-memory/commit/0357e19281709fa02206aff070e5deb83a06ad2f))
* **doctor:** skip the GitHub network probe under test (flaky 5s timeout) ([deabf0e](https://github.com/Sumit1993/mage-memory/commit/deabf0e4d46a1b69488c5dee4fbcbd1005c0d281))
* **flatten:** recover ALL mage fields from a CC-restamped note (no data loss) ([6bcba13](https://github.com/Sumit1993/mage-memory/commit/6bcba13467e7f909ad2cb63540ee7db2d19fd166))
* **integration:** close stdin for live claude runs; gate capture test on the scrub ([f1639f9](https://github.com/Sumit1993/mage-memory/commit/f1639f9a3ae4a32205475fffbcf4ecdc4729d759))
* **nudge:** exempt compact from the backlog throttle (resume-then-compact) ([cacb49c](https://github.com/Sumit1993/mage-memory/commit/cacb49c0548ba75d6998188e3e427553d696cd3e))
* **nudge:** exempt compact from the backlog throttle (resume→compact) ([c767563](https://github.com/Sumit1993/mage-memory/commit/c76756353923f6c6b94085a2bee0f3fef04ebd00))
* **redact:** clear Gate-2 false positives + add a non-bypass .redactignore allowlist ([#26](https://github.com/Sumit1993/mage-memory/issues/26)) ([726b5bf](https://github.com/Sumit1993/mage-memory/commit/726b5bf229b37adaae14ee628c3fa4a7de519e7b))
* **scan:** accept unquoted YAML dates for last_reviewed ([333c897](https://github.com/Sumit1993/mage-memory/commit/333c897c77ad4cbef72c3547738f8f5c8fcf74ef))
* **scan:** accept unquoted YAML dates for last_reviewed ([b2ea189](https://github.com/Sumit1993/mage-memory/commit/b2ea1897466532b8f49a9ecc378829310506e70a))
* symmetric commandeer reconciliation + doctor drift + clean --json (ADR-0032 review) ([41a59e3](https://github.com/Sumit1993/mage-memory/commit/41a59e3d9c4afdc59aa94f733827f3f5736789bb))

## [0.0.11](https://github.com/Sumit1993/mage-memory/compare/v0.0.10...v0.0.11) (2026-06-15)


### Features

* **0.0.11:** signal quality + autonomous capture ([#17](https://github.com/Sumit1993/mage-memory/issues/17)) ([434e3fb](https://github.com/Sumit1993/mage-memory/commit/434e3fba8c553f634a543548051b092ae589076a))


### Bug Fixes

* **deps:** clear all security advisories (drop gray-matter for yaml; pin esbuild) ([#22](https://github.com/Sumit1993/mage-memory/issues/22)) ([9eb76bb](https://github.com/Sumit1993/mage-memory/commit/9eb76bb9ced0cceac406085365f0c928fae5f97a))

## [0.0.10] - 2026-06-14

Coherence — one consistent vocabulary, one grooming skill, and a metadata schema
that migrates itself.

### Added

- Metadata schema **`mage.v2`** with a lenient v1 read and a first-class
  `mage migrate`.
- `mage doctor --fix` repairs drift — a missing hook block, the redaction hook, or
  an out-of-date metadata schema.
- `init` / `link` **auto-connect** capture hooks, so a fresh KB starts capturing
  without a separate `mage connect`.

### Changed

- The self-grooming skills merged into a single **`mage:groom`** (first-sight and
  recurrence phases); the engine output is now labelled and the plumbing commands
  are hidden from `mage --help`.
- Vocabulary reconciled across the codebase — shapes are **in-repo · hybrid ·
  external**, and a **hub** is one repo that is both a KB and a registry.
- **Node 18 is no longer supported — the runtime floor is now Node 20.** Node 18
  reached end-of-life on 2025-04-30, and the upgraded CLI dependencies
  (commander 15, ora 9, @inquirer/prompts 8) use `node:util.styleText`, available
  only on Node 20.12+. `engines.node` is now `>=20`.
- Dependency modernization: commander 12 → 15, ora 8 → 9, @inquirer/prompts 7 → 8;
  dev: TypeScript 5.7 → 6.0, @types/node 22 → 25, @types/tar 6 → 7.

### Removed

- The spec-driven (SDD) skills.

## [0.0.9] - 2026-06-10

Readiness release — make the self-grooming loop observable and adoptable.

### Added

- `mage dashboard` generates a committable `Dashboard.md` and an Obsidian
  `Knowledge.base` so you can read your proposal queue, wings, notes, skills,
  durability ladder, and health from inside your vault.
- `mage dashboard --html` builds a self-contained, offline `dashboard.html`
  cockpit — no server, gitignored, with an interactive force-directed knowledge
  graph (zoom/pan, type-colored nodes, click-to-open).
- `mage dashboard --open-with <file|obsidian|vscode>` chooses what a node/row
  click opens. Default `file` is a relative link that opens the raw note from the
  page's own origin — works in any browser/OS (incl. WSL), no app required;
  `obsidian` and `vscode` emit the respective deep-links.
- `mage doctor --fix` repairs `.gitignore` entries so capture sinks stay out of
  commits, and `mage doctor --report` produces a redacted, content-free support
  bundle you can paste into an issue.
- `mage doctor` checks code-repo<->hub link integrity, and `--fix` heals a stale
  hub back-reference after a code repo is moved (the forward `hub_path` and the
  hub's `code_repo_path` drift independently on a move; `mage connect` never
  repaired them — only `mage link` did).
- `mage doctor` now distinguishes a never-connected KB from one that WAS capturing
  and is now disconnected (capture history present but no hooks wired) — so a
  silently-dropped connection is reported instead of looking like a fresh KB.
- Brand assets: the graph-"m" mark and a social card under `assets/`.

### Changed

- `mage connect` now self-heals `.gitignore` so capture sinks (`.learnings/`,
  `.metrics/`) can never be committed.
- `mage doctor` grows from an env-only check into full KB and connection health:
  KB structure, a gitignore-leak guard, and hook-block and version-drift
  detection.
- Reaffirmed: mage sends nothing off your machine. The only improvement signal
  is the local `.metrics/` accept-reject ladder — no telemetry, fully offline.

### Fixed

- Capture now routes for external/hub knowledge bases. `resolveDocsRoot`
  (the resolver behind every capture, grooming, and dashboard run) read but
  never *honored* a code repo's `mode: "external"` metadata, so work in a
  member code repo never reached its hub and hub KBs silently produced no
  `.learnings/`. It now follows `hub_path` to `<hub>/projects/<project>/`.
  (A member repo must still be linked with `mage link` and connected with
  `mage connect` for its sessions to capture.)

## [0.0.8] - 2026-02-XX

Self-grooming — your notes can now earn their way up to skills, and stale ones
can step back down, all proposal-only.

### Added

- `mage promote` tallies per-signature recurrence across distinct sessions and
  proposes note-to-skill graduation when a pattern keeps recurring.
- `mage:optimize` rewords or demotes skills based on how well they actually
  match context.
- The single-writer dream applier handles graduate, demote, merge, split, and
  reword with safety ceilings.

### Changed

- The whole loop is propose-only: nothing is written until you confirm, and
  nothing is ever auto-committed.

## [0.0.7] - 2026-01-XX

### Added

- `mage distill` reads observed scratch (`mage distill --json`) and the
  `mage:distill` judgment skill turns first-sight observations into notes.
- `mage connect` now installs a Gate-2 pre-commit hook so redaction runs before
  anything is committed.

### Changed

- Capture reads only your own `.learnings/`; external feeders were cut.

## [0.0.6] - 2026-01-XX

### Added

- `mage connect` / `mage disconnect` wire capture hooks into Claude Code
  settings for you.
- `mage skills --metrics` surfaces read-only context-match metrics over a
  `.metrics/` rollup.

### Fixed

- Keyword derivation now produces cleaner, more accurate keywords.
- Hardened Anthropic-key redaction so keys are reliably scrubbed.

## [0.0.5] - 2025-12-XX

### Added

- `mage observe` — the hook-fired capture seam that writes `.learnings/*.jsonl`,
  including skill-load events.
- Redaction Gate 1: secrets are scrubbed at capture time, before anything
  touches disk.

## [0.0.4] - 2025-12-XX

### Added

- `mage learn --from` ingest tooling: deterministic source enumeration,
  adopt-in-place skill ingest, and an ingest skeleton to start from.

## [0.0.3] - 2025-11-XX

### Added

- Skills now ship as a Claude Code plugin under the `mage:` namespace, callable
  by bare name.
- `mage redact` — Redaction Gate 2, pulled forward.
- `mage:learn --from` prose ingest, pulled forward.

## [0.0.2] - 2025-11-XX

### Added

- Recursive note discovery so nested notes are found automatically.
- Multi-home wings: a single note can live under several wings.
- Hub-project indexing and standalone hubs.
- `mage link` is now aware of external vaults.

### Changed

- `mage init --hub` is detection-first: it inspects what is already there before
  proposing a layout.

## [0.0.1] - 2025-10-XX

Initial release — a memory-first knowledge base, forked and reoriented from
specshub.

### Added

- The vault: `mage/` with `notes/`, `work/`, `decisions/`, `INDEX.md`, and an
  `.obsidian/` config.
- Capture-by-pointer notes — record insight, procedure, and pointers, never
  copies of sources.
- `mage index` builds a hierarchical `INDEX.md` of everything known.
- Awareness and `mage:learn` skills.
- In-repo, external, and hybrid modes, plus a hub registry.

[0.0.10]: https://github.com/Sumit1993/mage-memory/compare/v0.0.9...v0.0.10
[0.0.9]: https://github.com/Sumit1993/mage-memory/compare/v0.0.8...v0.0.9
[0.0.8]: https://github.com/Sumit1993/mage-memory/compare/v0.0.7...v0.0.8
[0.0.7]: https://github.com/Sumit1993/mage-memory/compare/v0.0.6...v0.0.7
[0.0.6]: https://github.com/Sumit1993/mage-memory/compare/v0.0.5...v0.0.6
[0.0.5]: https://github.com/Sumit1993/mage-memory/compare/v0.0.4...v0.0.5
[0.0.4]: https://github.com/Sumit1993/mage-memory/compare/v0.0.3...v0.0.4
[0.0.3]: https://github.com/Sumit1993/mage-memory/compare/v0.0.2...v0.0.3
[0.0.2]: https://github.com/Sumit1993/mage-memory/compare/v0.0.1...v0.0.2
[0.0.1]: https://github.com/Sumit1993/mage-memory/releases/tag/v0.0.1
