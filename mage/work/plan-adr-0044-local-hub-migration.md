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
2. top-level `hub_repo` **absent or null** with `hub_path` set (external mode
   pre-0043 shape — old writers may omit the key entirely, and omission must
   not dodge detection),
3. any `hub_refs[]` entry still carrying `hub_path`, or carrying a
   local-path `hub_repo` (the old `{ hub_repo, hub_path, project }` shape —
   ADR-0044 reshapes refs to `{ hub_repo, project }`),
4. a canonical remote `hub_repo` still accompanied by a top-level `hub_path`,
   or by old-shape refs.

Case 4 is IN scope, deliberately: the migration's unit is "old-shape metadata
file", not "local hub". For remote-backed files the plan is field-only — drop
the dead `hub_path`, reshape refs, bump `schema` — with no move, no name
derivation, and the same confirmation/journal/rollback path as every other
rewrite. One detection rule, one flow; local hubs are the subset that also
needs an address minted.

## Name derivation — deterministic, from the hub directory

Input: the hub's resolved location — `realpath` of the local-path `hub_repo` if
present, else of `hub_path`. A `file://` value is converted to a filesystem
path FIRST, by `url.fileURLToPath` semantics: only the no-authority absolute
form (`file:///abs/path`) is accepted, percent-escapes decode as part of that
conversion (this is URL-to-path plumbing, distinct from ADR-0044 §3's rule that
`local://` NAMES never decode), and a `file://host/...` authority form is
refused with the offending value named — mage has no mount table to resolve a
remote authority against. Candidate name = the basename, folded to ADR-0044
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

**The claim is the rename itself — no lockfile.** `rename(2)` into
`~/.mage/hubs/_local/<name>` fails (`ENOTEMPTY`/`EEXIST`) if the destination
appeared after the plan was shown, so the atomic conflict check happens at the
only moment that matters. On that failure the run re-derives against the now-
current `_local/` contents and re-confirms; it never overwrites. A lockfile
would be the wrong mechanism here (house precedent: prefer the lock-free
convention; see notes/prefer-the-repos-lock-free-convention.md).

## Rewrite surface — hub-side first, then every referrer

Per hub, in this order (each step idempotent, and each step's completion
recorded in the journal as it lands — see Restore/rollback — so a run that dies
mid-hub is visibly incomplete rather than silently half-done):

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

**Re-runs resume.** `mage migrate` reads the newest journal before normal
detection; an incomplete hub (some phases recorded, some not) is finished
first — every step is idempotent, so replaying a completed one is a no-op —
or, when resumption is unsafe (the journal's recorded state no longer matches
disk), the run refuses and points at `--rollback`. Only then does normal
detection proceed.

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
`~/.mage/state/migrations/local-hub-<ISO timestamp>.json`: every metadata
file's prior field values plus a content hash of the file at journal time, the
directory move (`src`, `dst`), and per-phase completion flags (see Rewrite
surface). Then `mage migrate --rollback <journal>`:

- **Restores journaled FIELDS only** — a surgical rewrite of the recorded
  values, never `git checkout` of the whole file, so an unrelated edit made
  after migration survives rollback.
- **Refuses on divergence rather than guess**: a metadata file whose relevant
  fields no longer match the migrated values, or a moved hub with commits made
  after the journal (`git log` count check), stops the rollback with both
  states named. Git remains the deeper restore for tracked files; the journal
  prints the exact paths involved.
- **Reverses the move** by `rename(2)`ing the hub back, only after the field
  checks pass.

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
  from this plan plus a `mage migrate` terminal transcript. Invalidation
  triggers, stated with the artifacts: regenerate both whenever the
  canonicalization precedence, the metadata `schema` version, migrate's
  printed plan/output, or rollback behavior changes.
- `skills/guide/SKILL.md:40`, `skills/groom/SKILL.md:106`,
  `skills/graduate/SKILL.md:39`, `skills/learn/SKILL.md:32`,
  `skills/optimize/SKILL.md:64` — docs-root lines gain the `_local/<name>`
  form (issue #113's checklist).
- `src/paths.ts` mode doc comment; `src/cli-program.ts` migrate/doctor help
  strings.
- README quickstart: unaffected (local hubs are not the quickstart path) —
  stated per the docs-surfaces rule rather than omitted.
