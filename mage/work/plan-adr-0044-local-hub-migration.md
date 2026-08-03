---
type: plan
tags:
  - mage/roadmap
created: "2026-08-03"
last_reviewed: "2026-08-03"
status: active
provenance:
  repo: mage-memory
  work: adr-0044-local-hub-migration
sources:
  - decisions/0044-setup-is-a-conversation-over-one-address.md
  - decisions/0043-hub-addressed-by-remote-located-by-derivation.md
  - decisions/0037-readiness-doctor-remit-and-autofix-line.md
keywords:
  - local-hub
  - migration
  - hub-path-removal
  - mage-migrate
  - rollback
  - mixed-version
  - name-derivation
---
# Plan — the `local://` hub migration (ADR-0044, issue #123)

The one-time migration ADR-0044 names in its Consequences: existing local-only
hubs carry a filesystem path in `hub_repo` (or only a `hub_path`), which throws
on canonicalization once the `local://` scheme lands. This plan is the
implementation design; it blocks the removal of `hub_path` (ADR-0043 §6).

## Vehicle — extend `mage migrate`, no new command

One-time shape migrations already live in `mage migrate`
(`src/commands/migrate.ts`: pre-`mage.v2` schema, `.redactignore` fold), with
`mage doctor` surfacing drift as an advisory check. This migration extends that
pipeline. **One deliberate difference from the schema migration: `doctor --fix`
does NOT run it.** The schema fold rewrites bytes in place; this migration can
move a directory. Doctor detects and names the command; only an explicit
`mage migrate` (with confirmation) acts.

## Detection — what marks a metadata file as needing this migration

Any of, in a `mage/metadata.json`:

1. top-level `hub_repo` holding a value the ADR-0043 canonicalizer rejects as a
   local path (absolute path or `file://`),
2. top-level `hub_repo: null` with `hub_path` set (external mode pre-0043 shape),
3. any `hub_refs[]` entry still carrying `hub_path`, or carrying a
   local-path `hub_repo` (the old `{ hub_repo, hub_path, project }` shape —
   ADR-0044 reshapes refs to `{ hub_repo, project }`).

Remote-backed hubs (canonicalizable `hub_repo`) are untouched; their `hub_path`
is dropped at the same time refs are reshaped (it is already a dead fallback for
them).

## Name derivation — deterministic, from the hub directory

Input: the hub's resolved location — `realpath` of the local-path `hub_repo` if
present, else of `hub_path`. Candidate name = the basename, folded to ADR-0044
§3's segment grammar: lowercase; characters outside `[a-z0-9._-]` become `-`;
runs of `-` collapse; leading/trailing `-` and `.` trim; result must not be
empty, `.`, or `..` (an empty fold falls back to the literal `hub`).

Worked examples:

| on-disk path                         | derived address      |
| ------------------------------------ | -------------------- |
| `/home/s/hubs/My Hub`                | `local://my-hub`     |
| `/home/s/knowledge/team-kb.git`      | `local://team-kb.git`|
| `/data/Notes_2026`                   | `local://notes_2026` |

`realpath` first: two references reaching one directory through different
spellings (symlink, `..`) are the SAME hub and must derive the same name.

## Conflict resolution — identity check, then a fallback chain

The claimed-name registry is the `_local/` directory itself plus each hub's
self-address (below). For candidate `<name>`:

- `~/.mage/hubs/_local/<name>` absent → claim it.
- Present and its `metadata.json` self-address records THIS hub (same realpath
  identity) → already migrated; the run is an idempotent no-op for that hub.
- Present but a DIFFERENT hub → fallback chain, first free wins:
  `<parent-segment>-<basename>` (both folded), then `<basename>-2`, `-3`, …
  The chain is deterministic given the same `_local/` contents, and the chosen
  name is always shown at confirmation.
- `--name <n>` overrides the chain entirely (grammar-checked, conflict-checked,
  refuses a taken name rather than chaining).

Two distinct hubs sharing a basename migrate in path-sorted order, so which one
gets the bare name is reproducible.

## Rewrite surface — hub-side first, then every referrer

Per hub, in this order (each step idempotent):

1. **Move** the hub directory to `~/.mage/hubs/_local/<name>` — `rename(2)`
   only; a cross-device move (EXDEV) is refused with the exact `mv` command
   printed for the user instead. The ADR's identity check requires the hub AT
   the derived path, so registering-in-place is not an option.
2. **Hub-side self-address**: the hub's own `metadata.json` records
   `local://<name>` — this is the arrival-verification anchor that replaces
   origin-match for local hubs (ADR-0044 amends §2).
3. **Each referring code repo's `mage/metadata.json`**:
   - top-level: `hub_repo` → `local://<name>`; `hub_path` →
     `~/.mage/hubs/_local/<name>` (kept POINTING AT THE NEW LOCATION — see
     mixed-version reads; removed entirely only in the follow-up release that
     deletes the field),
   - every `hub_refs[]` entry: reshape to `{ hub_repo, project }`, local-path
     entries getting their hub's `local://<name>` address.
4. `schema` bumps (`mage.v2` → `mage.v3`) so the EXISTING doctor drift check
   flags un-migrated files with zero new wiring.

A single `mage migrate` run only rewrites metadata files it can see (the current
repo/walk-up, per existing migrate scope). Other machines/repos referencing the
same hub are caught by the doctor advisory when they next run anything.

## Confirmation — one plan, one yes, per hub

`mage migrate` prints the full plan before touching anything: the derived name
and why (basename + fold), the move (`src → dst`), and every field rewrite
(`file: old → new`). One confirmation per hub (not per file); `-y` accepts all
(the existing non-interactive convention). mage never rewrites silently
(house rule), and per commit hygiene it stages nothing — it prints the
`git add`/commit suggestion for each touched tracked file.

## Mixed-version reads — the transition window, both directions

- **New mage, old metadata** (fs-path `hub_repo`): canonicalization fails →
  `chosenHubRoot` falls back to `hub_path` exactly as today → works; doctor
  nags with the migrate advisory. No breakage.
- **Old mage, migrated metadata**: `local://` fails the OLD canonicalizer →
  falls back to `hub_path` — which the migration deliberately rewrote to the
  hub's NEW location. Old mage follows the plain path and works. This is the
  load-bearing reason `hub_path` is rewritten rather than nulled.
- **The one gap**: reshaped `hub_refs[]` have no `hub_path` (ADR-0044 drops it
  from refs), so an OLD mage resolving a migrated HYBRID repo's local-hub ref
  cannot. Accepted narrow breakage, warned at confirmation when a hybrid ref is
  reshaped: "older mage releases will not resolve this ref — update mage
  everywhere this repo is used."

`hub_path` (top-level) is deleted for good in the release AFTER this migration
ships and the doctor advisory has had a bake window — that deletion, not this
migration, closes ADR-0043 §6.

## Restore / rollback

Before any write, the run journals to
`~/.mage/state/migrations/local-hub-<ISO timestamp>.json`: every metadata file's
prior field values and the directory move (`src`, `dst`). Then:

- **Metadata files** are git-tracked — the printed restore is
  `git checkout -- mage/metadata.json` (per repo), listed in the journal.
- **The directory move** is reversed by `mage migrate --rollback <journal>`,
  which `rename(2)`s the hub back and rewrites the journal's recorded fields.
  Rollback refuses if the destination has new commits since the journal
  (`git log` count check) rather than guess.

## Out of scope

- `mage init --local <name>` minting fresh `local://` hubs (ADR-0044 §3's own
  implementation, not migration).
- The `link` address argument + storage-mode confirmation (ADR-0044 §4/§5).
- Deleting `hub_path` from the schema (the follow-up release).

## Docs surfaces

- `docs/src/content/docs/model/modes.md` + `reference/commands.mdx` — replace
  the ADR-0043 forward-marker asides with real behavior; the mixed-version
  resolution precedence (hub_repo → derived, local:// → derived _local,
  hub_path fallback) is 3+ moving parts and carries the worked-example table
  from this plan plus a `mage migrate` terminal transcript.
- `skills/guide/SKILL.md:40`, `skills/groom/SKILL.md:106`,
  `skills/graduate/SKILL.md:39`, `skills/learn/SKILL.md:32`,
  `skills/optimize/SKILL.md:64` — docs-root lines gain the `_local/<name>`
  form (issue #113's checklist).
- `src/paths.ts` mode doc comment; `src/cli-program.ts` migrate/doctor help
  strings.
- README quickstart: unaffected (local hubs are not the quickstart path) —
  stated per the docs-surfaces rule rather than omitted.
