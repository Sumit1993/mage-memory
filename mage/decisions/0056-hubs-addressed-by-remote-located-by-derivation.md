---
type: decision
tags: [mage/decisions]
status: accepted
created: "2026-09-10"
last_reviewed: "2026-09-10"
keywords: [hub, external-mode, hub_repo, derivation, MAGE_HOME, machine-binding, reach-grant, project-subdir, scan, link]
---

# 0056 — A hub is addressed by its remote and located by derivation
## Decision
A hub is one Obsidian vault and one knowledge base: its own `notes/` and `decisions/` plus flat per-project
subdirectories (`projects/<name>/notes/`). The scanner recurses by deny-list (`archive/`, `artifacts/`,
`.mage/`, `node_modules/`) and never depends on the registry. A project subdirectory is an optional convention,
never inferred. An external hub is addressed by its git remote (`hub_repo`, committed) and located by derivation under
`$MAGE_HOME/hubs/<host>/<owner>/<repo>`; a machine path is never written to a committed file, and machine
bindings live in `settings.local.json`. On an origin mismatch at the derived path the derived path wins, loudly,
and mage never falls back to `hub_path`. An unreachable hub is reported, never silently replaced by the code
repo's own `mage/`. Harness reach to an out-of-repo knowledge base is a grant (`additionalDirectories`) gated on
hub shape and origin, independent of native memory. `link` takes an address and never clones; `local://<name>`
is the address of a local-only hub.
## Why
Cloud sessions and second machines broke on recorded paths; a path is a fact about one machine. A silent
fallback to the wrong store writes knowledge where nobody will read it.
## Forbids
`hub_path` or `code_repo_path` in committed metadata. A clone anywhere but the derived path. Silent fallback to
the repo knowledge base. A reach grant keyed on auto-memory being on. An index that needs the registry.
## Example
`metadata.json` holds `hub_repo: github.com/o/r-kb`; the hub is at `~/.mage/hubs/github.com/o/r-kb`. If that
directory's origin is `github.com/x/other`, doctor prints "hub at <path> has origin x/other, expected o/r-kb"
and every command that needs the hub stops there.
## Relations
Absorbs 0011, 0012, 0023, 0042, 0043, the address half of 0044, 0045, 0047. Enforced by `src/hub-url.ts:257`
(`deriveHubPath`), `:292` (`chosenHubRoot`), `src/paths.ts:869` (`resolveHubGrant`), `:836`, `src/scan.ts:38`.
Code still contradicts this: `src/paths.ts:686` falls back to `hub_path` on a mismatch (#191); `src/commands/init.ts:186`
writes `hub_repo: null` for `--local` instead of a `local://` address (no issue builds it); `code_repo_path` leaves in PR #242.
