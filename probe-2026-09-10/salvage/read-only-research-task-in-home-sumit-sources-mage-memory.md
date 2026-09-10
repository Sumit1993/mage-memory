<!-- salvaged from subagent transcript agent-a458a38973550afa2.jsonl, spawned 2026-09-10T08:37:52.960Z; the parent planner was killed by the session limit at 08:52 -->

# Task

Read-only research task in /home/sumit/sources/mage-memory/.claude/worktrees/fable-notes-probe (a git worktree; use absolute paths, do not write any file, do not run git commands that mutate).

Question: what enforcement attach points exist in this repo today, where a new automated check, hook or deny rule could be bolted on? I will later propose checks and hooks and need to know, per candidate, the concrete file and line where it would attach.

Produce an inventory with one line per attach point: path:line, what it currently does, what kind of thing could attach there (lint / test / CI job / pre-commit / PreToolUse hook / settings deny / release config / doctor check / index check). Cover at least:

1. Pre-commit: `src/git-hooks.ts` (what the installed hook runs; is it a plain shell script or husky; whether it is installed only by `mage connect`).
2. CI: every file under `.github/workflows/` (job names, what each runs, whether `pnpm test:integration` runs anywhere, whether typecheck runs, whether `pnpm lint` or biome runs).
3. Lint/format: `biome.json` or similar, `tsconfig.json` `include`/`exclude` (do test files get type-checked?), `vitest.config.*`, `vitest.integration.config.ts`.
4. Claude Code hooks the plugin installs: `src/adapters/claude-code/settings.ts` (which hook events: PreToolUse, PostToolUse, SessionStart, PreCompact, Stop, UserPromptSubmit; the matcher of each), `src/adapters/claude-code/memory-hook.ts` (what the PreToolUse memory hook currently matches and d

# Final report

Now producing the final report.

Enforcement attach-point inventory — mage-memory (worktree: .claude/worktrees/fable-notes-probe)
All paths verified to exist; all cited lines verified with `sed -n`.

1. PRE-COMMIT (src/git-hooks.ts)
src/git-hooks.ts:26 — REDACT_HOOK_MARKER const, the string that stamps a hook as mage-owned. Attach: change the marker scheme if adding a second hook.
src/git-hooks.ts:42-50 — REDACT_HOOK_BODY: plain POSIX `/bin/sh` script (not husky), runs `mage flatten --staged --quiet` then blocks commit if `mage redact --check --staged` fails. Attach: add another `mage <subcommand> --check --staged` line here for a new deny rule.
src/git-hooks.ts:44 — fail-open guard: `command -v mage` missing -> exit 0 (skip gate) rather than block.
src/git-hooks.ts:90-126 — installRedactHook(): only installed by `mage connect`/`mage disconnect`, never automatically; refuses to clobber a foreign (non-marker) hook. Attach: any new pre-commit check must ride this same installer or a sibling one.
src/git-hooks.ts:144-154 — detectRedactHook(): read-only status ("present"/"absent"/"foreign"/"not-a-repo") used by `mage doctor`. Attach point for a doctor check on a new hook.

2. CI — 8 workflow files under .github/workflows/
.github/workflows/ci.yml (115 lines) — job `test` (build & test, matrix node 22/24): checkout, pnpm install --frozen-lockfile, `pnpm typecheck` (ci.yml:50), `pnpm build`, `pnpm test` (ci.yml:56), packs tarball. Job `smoke` (needs test): installs published tarball, runs `mage --version`/`mage --help`. Job `gate` (needs [test, smoke]): single required status check. `pnpm test:integration` does NOT run anywhere in this file or any other workflow. No `pnpm lint` / biome step anywhere (no lint script exists — confirmed absent from package.json and from all workflow files).
.github/workflows/claude-code-review.yml (52 lines) — job `review`, draft-guarded, calls reusable `prismalens/gh-workflows/.github/workflows/claude-code-review.yml@main`; caller stub, no local logic. Attach: not a place to add checks (per its own comment, "Do not add logic here").
.github/workflows/claude.yml (44 lines) — job `claude`, mention/summon dispatch, calls the same external reusable workflow; caller stub.
.github/workflows/dependabot-auto-merge.yml (14 lines) — job `auto-merge`, calls reusable dependabot-auto-merge workflow; caller stub.
.github/workflows/docs.yml (97 lines) — job `build` (docs.yml:33): `pnpm docs:gen`, builds Astro site in docs/ subproject. Job `deploy` (needs build, only on release/workflow_dispatch): pushes to GitHub Pages.
.github/workflows/observation-digest.yml (63 lines) — job `digest`, cron `20 8 * * *` + workflow_dispatch, runs `.github/scripts/observation-digest.sh`, posts to a tracked issue. Marked for deletion once the observation week ends.
.github/workflows/pr-title.yml (47 lines) — job `validate`, `pull_request_target` + `merge_group`, calls `prismalens/gh-workflows/actions/pr-title@main` to enforce Conventional Commits titles. One job, step-level `if`, intentionally not job-level (see comment lines 34-41) — attach a new required-check job here only with the single-job discipline preserved.
.github/workflows/release-please.yml (76 lines) — job `release-please` (release-please-action, PAT-driven so it can trigger CI), job `publish` (needs release-please, only when release_created, npm OIDC publish).
Total workflow files: 8.

3. LINT / FORMAT / TYPECHECK / TEST CONFIG
No biome.json or any biome config file found anywhere in the repo (find turned up nothing); no `lint` script in package.json.
tsconfig.json:41 — `"include": ["src/**/*", "test/**/*"]` — test files (src/**/*.test.ts, test/**) ARE type-checked by `tsc --noEmit` (== `pnpm typecheck`, run in ci.yml:50). This is current state; contrasts with the older MEMORY.md gotcha note "test files were excluded from typecheck."
vitest.config.ts:9-10 — default suite includes `src/**/*.test.ts`, `test/**/*.test.ts`; excludes `test/integration/**` — the everyday `pnpm test` (ci.yml:56) never runs integration tests.
vitest.integration.config.ts:15 — includes only `test/integration/**/*.test.ts`; run via `pnpm test:integration` (package.json script), serial (fileParallelism:false), 300s timeouts. Never invoked from CI (grep confirms no workflow references it).

4. CLAUDE CODE PLUGIN HOOKS
src/adapters/claude-code/settings.ts:80 — SessionStart, id `mage:observe:SessionStart`, command `mage observe`.
src/adapters/claude-code/settings.ts:87 — SessionStart, id `mage:nudge:SessionStart`, command `mage nudge` (the boundary nudge; fires on compact/startup/resume, not clear).
src/adapters/claude-code/settings.ts:88 — UserPromptSubmit, id `mage:observe:UserPromptSubmit`, command `mage observe`.
src/adapters/claude-code/settings.ts:89 — PostToolUse (no matcher, all tools), id `mage:observe:PostToolUse`, command `mage observe`.
src/adapters/claude-code/settings.ts:90 — PostToolUseFailure, id `mage:observe:PostToolUseFailure`.
src/adapters/claude-code/settings.ts:91 — PreCompact, id `mage:observe:PreCompact`.
src/adapters/claude-code/settings.ts:92 — SessionEnd, id `mage:observe:SessionEnd`.
src/adapters/claude-code/settings.ts:93 — Stop, id `mage:metrics:Stop`, command `mage skills --metrics --quiet`.
src/adapters/claude-code/settings.ts:96 — Stop, id `mage:observe:Stop` (second Stop group; both coexist).
src/adapters/claude-code/settings.ts:101 — SubagentStop, id `mage:observe:SubagentStop`.
src/adapters/claude-code/settings.ts:109-115 — PreToolUse, matcher `"Write|Edit"`, id `mage:memory:PreToolUse`, command `mage memory-hook`, `commandeer: true` (gated on auto-memory + a resolvable docs root). This is the attach point for a new PreToolUse deny/rewrite rule on Write|Edit.
src/adapters/claude-code/settings.ts:116-121 — PostToolUse, matcher `"Write|Edit"`, id `mage:memory:PostToolUse`, command `mage memory-hook`, commandeer:true.
src/adapters/claude-code/settings.ts:127-132 — Stop, id `mage:flatten:Stop`, command `mage flatten --quiet`, commandeer:true.
No `permissions.deny` entries anywhere: repo `.claude/settings.json` (14 lines) carries only a SessionStart hook running `scripts/cloud-setup.sh`; no `permissions` block, no `deny` array.

src/adapters/claude-code/memory-hook.ts — the PreToolUse memory hook:
Line 98: only acts on `tool_name` Write or Edit; anything else → PASS (no stdout).
Lines 69-79 (flatInboxRel): only a flat `.md` file written directly at the docs root is in scope; subdir writes, non-.md, or paths outside the root → PASS.
Line 112: a generated artifact (INDEX.md/MEMORY.md/_index.*.md etc, via isGeneratedArtifact) → `{kind:"deny"}`.
Lines 120-131 / 133-142: a flat topic-note Write/Edit → redact() the content/new_string in-flight, return `{kind:"rewrite", updatedInput...}` (Gate-0 scrub).
Line 104 — fails open: `resolveDocsRoot(cwd).catch(() => null)` → PASS if the docs root can't resolve.
Line 161 — same fail-open pattern in memoryPostToolUse.
Lines 230-245 — the whole CLI action is wrapped in try/catch; any exception is swallowed silently (line 242-244), guaranteeing the hook never blocks the host on an internal error. This is the fail-open boundary a new check must respect — an added check inside this file must not throw past this catch if it's meant to actually deny.

src/adapters/claude-code/nudge.ts:1-25 (header) — session-start nudge: on `compact` renders the just-closed chapter's digest (failures, external commands, corrections) plus a capped three-part backlog tally (staged drafts / unmined chapters / graduation-eligible signatures); on every SessionStart source templates an autonomy-scaled mandate (operator/approver/overseer). Emits on two channels: `systemMessage` (human-visible) and `additionalContext` (model-only). Never blocks, never commits, exit 0 always (line 526).

5. `mage doctor` CHECKS (src/commands/doctor.ts + src/doctor/kb-checks.ts + src/doctor/link-checks.ts)
Total distinct check names: 24.
node version — doctor.ts:140-144 (Node major >= 20).
platform — doctor.ts:147 (informational, OS name).
git — doctor.ts:150-151 (hasGit()).
npx — doctor.ts:153-158.
gh (GitHub CLI) — doctor.ts:160-168, optional.
skills (Claude Code plugin) — doctor.ts:171/237-250, optional, checks plugin registry.
hub at cwd — doctor.ts:174-187, optional/informational.
github reachable — doctor.ts:192-211, optional, opt-in network probe.
genre tells — kb-checks.ts:101.
mage KB — kb-checks.ts:124/137.
hub projects — kb-checks.ts:178/210.
KB structure — kb-checks.ts:233.
INDEX.md — kb-checks.ts:235 (a READINESS_CHECK).
index freshness — kb-checks.ts:287/291 (a READINESS_CHECK).
AGENTS.md awareness — kb-checks.ts:336/338 (a READINESS_CHECK; flags retired command names).
gitignore (sinks) — kb-checks.ts:382/387 (the capture-sink leak guard; `--fix` self-heals).
connection — kb-checks.ts:509-561 (hook-drift health between installed hooks and current spec).
external hub — kb-checks.ts:605/613.
KB access grant — kb-checks.ts:655-684 (a READINESS_CHECK; ADR-0042 reachability).
redact hook — kb-checks.ts:719-740 (wraps detectRedactHook from git-hooks.ts).
metadata schema — kb-checks.ts:766/780/796.
state layout — kb-checks.ts:841/848.
recall budget — kb-checks.ts:900-932.
link integrity — link-checks.ts:24 (`const CHECK = "link integrity"`), two-way code-repo<->hub reference check.
merge candidate — doctor.ts:91-104 (informational, note-pair merge suggestions from analyzeDream).
Doctor's own fail-open pattern: doctor.ts:106-108 wraps merge-candidate detection in try/catch ("Fail-open: merge-candidate detection must never break doctor") — the same pattern any new check should follow if it's meant to be advisory-only.

6. `mage index` VALIDATION (src/commands/index-cmd.ts)
No hard rejection of frontmatter fields found here — index-cmd.ts renders INDEX.md/MEMORY.md and degrades gracefully under budget pressure rather than erroring:
index-cmd.ts:68-71 — counts entries with `status === "accepted" || status === "active"` for the governance line ("N accepted decisions govern this repo").
index-cmd.ts:654-659 (lifecycleSuffix) — a caution-status vocabulary is flagged inline (not rejected): `superseded`, `stale-suspect`, `archived`, `deprecated` — rendered as `_(status)_` suffix on the index line.
index-cmd.ts:456-475 (fillRoster) — MEMORY.md roster is bounded by both line count and byte count (budget.lineThreshold / budget.byteThreshold, from AUTO_MEMORY_MAX_BYTES=25,600 / AUTO_MEMORY_MAX_LINES=200 in src/adapters/claude-code/constants.ts:7-8); an oversized entry is silently omitted (`omitted = true`, index-cmd.ts:472) rather than erroring.
index-cmd.ts:545-561 — `logger.warn` on degraded/omitted roster ("bounded to N of M entries...", "keyword tails shed...") and on falling back to the category map when the fixed structure itself breaches budget. These warnings are the closest thing to a "validation" surface today — attach a new hard-fail check alongside this warn path if rejection (not just warning) is wanted.

7. src/redact.ts DETECTORS (18 kinds, DETECTORS array starts redact.ts:96)
redact.ts:98 private-key
redact.ts:107 url-credentials
redact.ts:113 aws-access-key
redact.ts:118 aws-secret-key
redact.ts:125 github-token
redact.ts:130 gitlab-token
redact.ts:141 anthropic-key
redact.ts:149 openai-key
redact.ts:154 slack-token
redact.ts:160 stripe-key
redact.ts:165 google-api-key
redact.ts:170 npm-token
redact.ts:175 jwt
redact.ts:180 bearer
redact.ts:190 generic-key-value
redact.ts:199 env-secret
redact.ts:207 high-entropy
redact.ts:213 email
No dedicated redaction fixture directory exists under mage/ or test/ (find turned up nothing). Fixtures are inlined synthetically in src/redact.test.ts:21-27 (POSITIVES array, one pattern-shaped fake per detector kind, built via a `tok()` string-joiner so no live-looking secret sits in committed source).

8. RELEASE
release-please-config.json:10-11 — `extra-files` list the version-bump surface beyond package.json: `.claude-plugin/plugin.json` ($.version) and `.claude-plugin/marketplace.json` ($.plugins[0].version). Attach a new artifact here if a check needs a version to stay in lockstep.
src/release-consistency.test.ts (47 lines) — asserts: package.json version is clean semver (line 26); plugin.json version matches package.json (line 30); marketplace.json's mage entry version matches (lines 33-38); CHANGELOG.md has a dated heading for the current version (lines 41-45).
src/docs/generated-data.test.ts (59 lines) — asserts: committed docs/src/generated/mage-data.json matches freshly-built output (drift test, lines 15-19, fails CI if `pnpm docs:gen` wasn't re-run); surfaces the K/M recurrence-gate symbols and `mage:nudge:SessionStart` in hooks data with non-empty purpose strings (lines 22-29); CLI command inventory derived from buildProgram() matches expected hidden/visible sets and every command/option has non-empty summary/flags (lines 32-57).

9. REPO-LEVEL CLAUDE SETTINGS
.claude/settings.json (14 lines, exists) — only a SessionStart hook (matcher `startup|resume`, .claude/settings.json:5) running `scripts/cloud-setup.sh`. No `permissions` block, no `deny` entries.
.claude/settings.local.json — NOT PRESENT.
.worktreeinclude — NOT PRESENT.
.gitignore — mage-related entries: line 10 `mage/**/artifacts/`; line 15 `mage/.learnings/`; line 16 `mage/.metrics/`; line 17 `mage/.staging/`; line 18 `mage/.mage/`; line 23 `mage/dashboard.html`.

10. PLUGIN SKILLS
skills/ (top level, matches .claude-plugin/plugin.json's `"skills": ["./skills/"]`): graduate, groom, guide, learn, optimize.
.claude-plugin/ contents: plugin.json, marketplace.json (no skills of its own; it's the marketplace manifest).

11. AGENTS.md / CLAUDE.md AT REPO ROOT
CLAUDE.md — 5 lines total. Content is just a title, one description line, and `@AGENTS.md` (imports AGENTS.md); no independent rules.
AGENTS.md — 41 lines total. Rule-like sentences present:
"Before non-trivial work in this repo: read `mage/INDEX.md` first... Open only the notes the task actually touches; don't read everything." (lines 11-16)
"Follow the links in those notes... and skim `mage/decisions/` for governing decisions." (line 17-18)
"Treat notes as point-in-time. If a note is `status: stale-suspect`... verify it against the current code before relying on it." (lines 19-21)
"After you learn something durable... capture it with `/mage:learn`, or add a note under `mage/notes/` and run `mage index`." (lines 23-25)
"This rule targets the memory genre only (`mage/notes/`). `mage/decisions/` (ADRs) is authored deliberately, not a destination for captured knowledge." (lines 27-28)
"`mage/work/` is retired (ADR-0050); plans, specs and task lists live in the issue tracker." (lines 28-29)
"An artifact with a done-state belongs in an issue or a decision, not in notes." (lines 29-30)
"Docs surfaces: Every implementation spec handed to a coding agent must include a 'Docs surfaces' deliverable section naming the specific files to update, or an explicit 'none affected because …'." (line 32)
"Where a named surface explains three or more interacting parts... the spec must also say which concrete artifact will carry it..." (line 32)
"Commit hygiene: mage never commits for you. It suggests `git` commands; you run them." (lines 34-35)
"The pinned tracking issue on GitHub is the order of work. Read it before picking anything up." (line 40)
"ADR-0050 is the charter; the plan, its mechanics and its evidence are comments on that issue (#204)." (line 41)

12. scripts/ (4 files)
scripts/cloud-setup.sh — SessionStart bootstrap for Claude Code cloud sessions; no-op outside `CLAUDE_CODE_REMOTE=true`; installs apt deps if root/sudo available (#175/#176).
scripts/gen-docs.mjs — regenerates docs/src/generated/mage-data.json from the built `dist/index.js` (thresholds + hooks); run via `pnpm docs:gen`; drift is caught by src/docs/generated-data.test.ts.
scripts/sync-repo-governance.sh — applies repo governance (settings, labels, branch-protection ruleset) from `.github/governance.json` idempotently via `gh api`; usable locally or from a governance workflow.
scripts/vendor-graph.mjs — vendors the `force-graph` UMD bundle into `src/dashboard/graph-lib.generated.ts` as an inline TS string for the offline dashboard.html (ADR-0020); also neutralizes `://` sequences so the offline-URL assertion test still passes.
