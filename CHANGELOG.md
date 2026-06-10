# Changelog

mage (npm package `mage-memory`, CLI `mage`) is a portable, file-based, offline
knowledge base for AI coding agents: durable git-backed notes — insight,
procedure, and pointers, never copies of sources — navigable as an Obsidian
graph and usable by any agent. Nothing leaves your machine.

The roadmap is capped at **0.1.0**; there is no 1.0.

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

[0.0.9]: https://github.com/Sumit1993/mage-memory/compare/v0.0.8...v0.0.9
[0.0.8]: https://github.com/Sumit1993/mage-memory/compare/v0.0.7...v0.0.8
[0.0.7]: https://github.com/Sumit1993/mage-memory/compare/v0.0.6...v0.0.7
[0.0.6]: https://github.com/Sumit1993/mage-memory/compare/v0.0.5...v0.0.6
[0.0.5]: https://github.com/Sumit1993/mage-memory/compare/v0.0.4...v0.0.5
[0.0.4]: https://github.com/Sumit1993/mage-memory/compare/v0.0.3...v0.0.4
[0.0.3]: https://github.com/Sumit1993/mage-memory/compare/v0.0.2...v0.0.3
[0.0.2]: https://github.com/Sumit1993/mage-memory/compare/v0.0.1...v0.0.2
[0.0.1]: https://github.com/Sumit1993/mage-memory/releases/tag/v0.0.1
