---
type: doc
tags: [mage/decisions]
status: accepted
created: "2026-09-10"
last_reviewed: "2026-09-10"
keywords: [decisions, map, collapse, superseded, precedence]
---

# The decisions, and where the old ones went

Ten decisions govern this repo, numbered 0050 to 0059. On 2026-09-10 they replaced forty-eight (#262). The old
files are deleted, not marked; git keeps them at commit `ef93c90`. Numbers 0001 to 0048 are never reused, so an
old citation in code or a changelog is unambiguous: look it up here.

Precedence when two texts disagree: the newest of the ten wins over an older one; any of the ten wins over an
issue body; an issue comment ruled by the operator wins over an issue body; nothing under `~/ai-context/` or
in a deleted file is a source. A decision is under 40 lines and has five parts: Decision, Why, Forbids,
Example, Relations. Every status is `accepted`; the 0.1.0 gate in 0059 is a release gate, not an ADR status.

## The ten

| number | title | enforced today by |
|---|---|---|
| [0050](0050-mage-turns-a-repeated-failure-into-enforcement.md) | mage turns a repeated failure into enforcement; memory is the queue | none yet; the loop is PRs #254 to #260 and #217 to #251 |
| [0051](0051-the-ladder-runs-before-anything-is-remembered.md) | The ladder runs before anything is remembered | `src/adapters/claude-code/memory-hook.ts:93` (0032 form; #229 repoints), `src/commands/index-cmd.ts` (#231 adds the schema check) |
| [0052](0052-streams-and-the-observe-schema.md) | Streams and the observe schema | `src/observe/types.ts:10`, `src/observe/scrub.ts`, `src/adapters/claude-code/settings.ts:80` |
| [0053](0053-redaction-two-gates-one-engine.md) | Redaction: two gates, one engine | `src/redact.ts:227`, `src/git-hooks.ts:29` (pre-commit, ran on every commit of this series), `src/observe/scrub.ts` |
| [0054](0054-files-in-the-repo-no-runtime-no-server.md) | Files in the repo, no runtime, no server, nothing leaves the machine | `src/paths.ts:17`, `src/paths.ts:39`, `src/scan.ts:38`, `src/commands/doctor.ts:189` |
| [0055](0055-connect-doctor-migrate.md) | Connect, doctor, migrate | `src/commands/connect.ts:85`, `src/adapters/claude-code/settings.ts:328`, `src/agents-md.ts:13`, `src/commands/doctor.ts:66` |
| [0056](0056-hubs-addressed-by-remote-located-by-derivation.md) | A hub is addressed by its remote and located by derivation | `src/hub-url.ts:257`, `src/hub-url.ts:292`, `src/paths.ts:869`, `src/paths.ts:836`; contradicted by `src/paths.ts:686` (#191) |
| [0057](0057-a-guard-lands-by-pull-request.md) | A guard lands by pull request; the human merges | `src/provenance.ts:57`, `src/commands/autonomy.ts:35`; PR path is PR #182, unmerged |
| [0058](0058-recall-one-bounded-index.md) | Recall is one bounded index, loaded every session | `src/commands/index-cmd.ts:55`, `src/adapters/claude-code/projects.ts:29`, `src/metrics/footprint.ts:16`, `src/adapters/claude-code/constants.ts:7` |
| [0059](0059-versions-are-mechanical-the-release-is-two-counts.md) | Versions are mechanical; the release is named by two counts | `release-please-config.json`, `.github/workflows/release-please.yml`, `src/docs/generated-data.test.ts` |

## Where each of the forty-eight went

| old | title | survivor | what moved |
|---|---|---|---|
| [0001](https://github.com/Sumit1993/mage-memory/blob/ef93c90/mage/decisions/0001-memory-first-product-supersedes-specshub.md) | A memory-first product (mage) supersedes specshub | [0050](0050-mage-turns-a-repeated-failure-into-enforcement.md) | the charter sentence |
| [0002](https://github.com/Sumit1993/mage-memory/blob/ef93c90/mage/decisions/0002-fork-and-reorient-specshub.md) | mage forks specshub (clean copy, fresh history) and reorients | [0050](0050-mage-turns-a-repeated-failure-into-enforcement.md) | the fork; history only |
| [0003](https://github.com/Sumit1993/mage-memory/blob/ef93c90/mage/decisions/0003-track-work-ignore-artifacts.md) | Track work units and notes; git-ignore only artifacts and scratch | [0054](0054-files-in-the-repo-no-runtime-no-server.md) | commit everything but artifacts and .mage/; work/ retired |
| [0004](https://github.com/Sumit1993/mage-memory/blob/ef93c90/mage/decisions/0004-capture-insight-not-copies.md) | Capture insight, procedure, and pointers — not copies of sources | [0051](0051-the-ladder-runs-before-anything-is-remembered.md) | insight, procedure, pointers; never a copy |
| [0005](https://github.com/Sumit1993/mage-memory/blob/ef93c90/mage/decisions/0005-one-canonical-memory-others-are-feeders.md) | Exactly one canonical durable memory (mage); native memories are feeders, not rivals | [0051](0051-the-ladder-runs-before-anything-is-remembered.md) | native memory is a feeder through the hook |
| [0006](https://github.com/Sumit1993/mage-memory/blob/ef93c90/mage/decisions/0006-two-layer-recall-per-wing-skills.md) | Two-layer recall: per-wing auto-loaded skills + a hierarchical factual index | [0058](0058-recall-one-bounded-index.md) | index plus generated wing skills |
| [0007](https://github.com/Sumit1993/mage-memory/blob/ef93c90/mage/decisions/0007-mine-agentmemory-design-not-depend.md) | Mine agentmemory's design; don't depend on it | [0050](0050-mage-turns-a-repeated-failure-into-enforcement.md) | no dependency on another memory engine |
| [0008](https://github.com/Sumit1993/mage-memory/blob/ef93c90/mage/decisions/0008-visible-mage-dir-for-obsidian.md) | In-repo knowledge base lives in a visible `mage/` dir (not hidden `.mage/`) | [0054](0054-files-in-the-repo-no-runtime-no-server.md) | visible mage/ |
| [0009](https://github.com/Sumit1993/mage-memory/blob/ef93c90/mage/decisions/0009-no-runtime-automation-rides-host-hooks.md) | No runtime of our own; automation rides the host agent's hooks + the agent's reasoning | [0054](0054-files-in-the-repo-no-runtime-no-server.md) | no runtime; rides host hooks |
| [0010](https://github.com/Sumit1993/mage-memory/blob/ef93c90/mage/decisions/0010-durable-memory-not-coordination-layer.md) | mage is durable memory, not a multi-agent coordination layer | [0050](0050-mage-turns-a-repeated-failure-into-enforcement.md) | no coordination layer |
| [0011](https://github.com/Sumit1993/mage-memory/blob/ef93c90/mage/decisions/0011-recursive-scan-hub-projects.md) | A hub is one vault; the scanner recurses; projects are wings | [0056](0056-hubs-addressed-by-remote-located-by-derivation.md) | deny-list scan, registry-independent |
| [0012](https://github.com/Sumit1993/mage-memory/blob/ef93c90/mage/decisions/0012-wings-optional-convention-standalone-hubs.md) | A wing is an optional convention; hubs are standalone-first | [0056](0056-hubs-addressed-by-remote-located-by-derivation.md) | wing optional; standalone hub |
| [0013](https://github.com/Sumit1993/mage-memory/blob/ef93c90/mage/decisions/0013-procedure-skills-self-grooming-loop.md) | Procedure skills and the self-grooming loop | [0057](0057-a-guard-lands-by-pull-request.md) | a skill is one output rung |
| [0014](https://github.com/Sumit1993/mage-memory/blob/ef93c90/mage/decisions/0014-two-gate-redaction.md) | Two-gate redaction (strip secrets before write, not before display) | [0053](0053-redaction-two-gates-one-engine.md) | two gates |
| [0015](https://github.com/Sumit1993/mage-memory/blob/ef93c90/mage/decisions/0015-mage-observe-capture-schema.md) | `mage observe`: the capture schema (the keystone `.jsonl`) | [0052](0052-streams-and-the-observe-schema.md) | v1 additive schema |
| [0016](https://github.com/Sumit1993/mage-memory/blob/ef93c90/mage/decisions/0016-context-match-confidence-ladder-applier.md) | Context-match, the confidence ladder, and the single applier | [0057](0057-a-guard-lands-by-pull-request.md) | single applier and its ceilings; context-match window in 0058 |
| [0017](https://github.com/Sumit1993/mage-memory/blob/ef93c90/mage/decisions/0017-mage-connect-host-hook-adapter.md) | `mage connect`: the host hook adapter (capture is opt-in) | [0055](0055-connect-doctor-migrate.md) | connect writes marked hooks |
| [0018](https://github.com/Sumit1993/mage-memory/blob/ef93c90/mage/decisions/0018-mage-distill-observed-scratch-reader.md) | `mage distill`: the observed-scratch reader (capture, on first sight) | [0052](0052-streams-and-the-observe-schema.md) | deterministic narrowing; Gate-2 scope rule in 0053; verb retired |
| [0019](https://github.com/Sumit1993/mage-memory/blob/ef93c90/mage/decisions/0019-mage-promote-self-grooming.md) | `mage promote`: self-grooming (recurrence, graduation, merge/split) | [0057](0057-a-guard-lands-by-pull-request.md) | promote retired; proposals by PR |
| [0020](https://github.com/Sumit1993/mage-memory/blob/ef93c90/mage/decisions/0020-no-server-tiered-dashboards.md) | the dashboard: a per-KB, no-server generated view (Option D) | [0054](0054-files-in-the-repo-no-runtime-no-server.md) | no server; generated views |
| [0021](https://github.com/Sumit1993/mage-memory/blob/ef93c90/mage/decisions/0021-offline-no-telemetry-local-signal.md) | mage stays offline: no phone-home telemetry; signal is local + voluntarily shared | [0054](0054-files-in-the-repo-no-runtime-no-server.md) | no phone-home; forge carve-out |
| [0022](https://github.com/Sumit1993/mage-memory/blob/ef93c90/mage/decisions/0022-remove-sdd-skills.md) | Remove the spec-kit-derived SDD skills | [0050](0050-mage-turns-a-repeated-failure-into-enforcement.md) | no SDD skills |
| [0023](https://github.com/Sumit1993/mage-memory/blob/ef93c90/mage/decisions/0023-hub-own-notes-and-flat-projects.md) | A hub keeps its own notes AND flat per-project subdirs (ratification) | [0056](0056-hubs-addressed-by-remote-located-by-derivation.md) | hub keeps own notes and flat projects |
| [0024](https://github.com/Sumit1993/mage-memory/blob/ef93c90/mage/decisions/0024-organic-grooming-loop.md) | Organic grooming loop: the lesson path (inline-primary + boundary nudge) | [0057](0057-a-guard-lands-by-pull-request.md) | first sight, budget 3; a1 gate replaced in 0059 |
| [0025](https://github.com/Sumit1993/mage-memory/blob/ef93c90/mage/decisions/0025-one-transient-state-home.md) | One transient-state home (`.mage/`) + redact config in `metadata.json` | [0054](0054-files-in-the-repo-no-runtime-no-server.md) | one transient home .mage/ |
| [0026](https://github.com/Sumit1993/mage-memory/blob/ef93c90/mage/decisions/0026-hosted-docs-website.md) | A hosted documentation website, generated from code | [0059](0059-versions-are-mechanical-the-release-is-two-counts.md) | docs generated from code, drift test |
| [0027](https://github.com/Sumit1993/mage-memory/blob/ef93c90/mage/decisions/0027-faultline-friction-capture-trigger.md) | Faultline: a friction/derivation capture trigger (prefilter, not miner) | [0052](0052-streams-and-the-observe-schema.md) | killed gate; chronological digest |
| [0028](https://github.com/Sumit1993/mage-memory/blob/ef93c90/mage/decisions/0028-prose-keyed-capture.md) | Prose-keyed capture: corrections + recurrent failures (supersedes Faultline) | [0052](0052-streams-and-the-observe-schema.md) | killed gate; chronological digest |
| [0029](https://github.com/Sumit1993/mage-memory/blob/ef93c90/mage/decisions/0029-digest-to-agent-capture.md) | Digest-to-agent capture: deterministic narrowing, agent judgment (supersedes prose-keyed) | [0052](0052-streams-and-the-observe-schema.md) | code narrows, agent judges |
| [0030](https://github.com/Sumit1993/mage-memory/blob/ef93c90/mage/decisions/0030-agent-autonomy-ladder.md) | Opt-in agent autonomy ladder for the grooming loop (Operator / Approver / Overseer) | [0057](0057-a-guard-lands-by-pull-request.md) | autonomy; merge is the gate |
| [0031](https://github.com/Sumit1993/mage-memory/blob/ef93c90/mage/decisions/0031-programmatic-provenance-stamp.md) | Programmatic provenance stamping + the autonomy reject-ledger (Phase 1: stamp at creation) | [0057](0057-a-guard-lands-by-pull-request.md) | provenance stamped by the applier |
| [0032](https://github.com/Sumit1993/mage-memory/blob/ef93c90/mage/decisions/0032-capture-redirect-native-memory.md) | Capture-redirect: co-opt the host's native-memory write into mage's git-durable pipeline (relocation where the host allows it, coexist nudge as the floor) | [0051](0051-the-ladder-runs-before-anything-is-remembered.md) | memory hook repointed to the ladder |
| [0033](https://github.com/Sumit1993/mage-memory/blob/ef93c90/mage/decisions/0033-recall-import-bounded-index.md) | Recall: `@import` the bounded root index into the host's auto-loaded context (the capture companion to ADR-0032) | [0058](0058-recall-one-bounded-index.md) | @import bounded index |
| [0034](https://github.com/Sumit1993/mage-memory/blob/ef93c90/mage/decisions/0034-adopt-preexisting-knowledge.md) | Adopt: a dispatcher for onboarding pre-existing knowledge | [0055](0055-connect-doctor-migrate.md) | adopt folds into migrate |
| [0035](https://github.com/Sumit1993/mage-memory/blob/ef93c90/mage/decisions/0035-decouple-harness-memory-from-notes.md) | Notes are memories: one unified store; embrace the harness format at rest, normalize at the durable boundary | [0051](0051-the-ladder-runs-before-anything-is-remembered.md) | notes are memories; one store |
| [0036](https://github.com/Sumit1993/mage-memory/blob/ef93c90/mage/decisions/0036-defer-harness-adapter-seam.md) | Defer the `HarnessAdapter` seam until a second harness exists; consolidate CC note-shape into one named module now | [0054](0054-files-in-the-repo-no-runtime-no-server.md) | no adapter seam yet |
| [0037](https://github.com/Sumit1993/mage-memory/blob/ef93c90/mage/decisions/0037-readiness-doctor-remit-and-autofix-line.md) | doctor's remit extends to recall + skills readiness, on a bounded auto-fix line | [0055](0055-connect-doctor-migrate.md) | doctor remit and --fix line |
| [0038](https://github.com/Sumit1993/mage-memory/blob/ef93c90/mage/decisions/0038-promote-note-rung-deleted-graduate-on-usage.md) | promote's note-proposal rung is deleted; graduate repoints to note-read usage; recurrence becomes a digest annotation | [0057](0057-a-guard-lands-by-pull-request.md) | graduation retired |
| [0039](https://github.com/Sumit1993/mage-memory/blob/ef93c90/mage/decisions/0039-context-footprint-measure-and-bound.md) | measure the context footprint; bound the generated launch surface | [0058](0058-recall-one-bounded-index.md) | footprint caps |
| [0040](https://github.com/Sumit1993/mage-memory/blob/ef93c90/mage/decisions/0040-versions-are-mechanical-announcement-is-named.md) | version numbers are mechanical; the announcement is a named release backed by evidence | [0059](0059-versions-are-mechanical-the-release-is-two-counts.md) | versions mechanical |
| [0041](https://github.com/Sumit1993/mage-memory/blob/ef93c90/mage/decisions/0041-genre-decides-the-recall-rung.md) | Genre decides the recall rung: one store, three recall paths (amends ADR-0035) | [0058](0058-recall-one-bounded-index.md) | genre-decides-rung superseded; forbidden in 0051 |
| [0042](https://github.com/Sumit1993/mage-memory/blob/ef93c90/mage/decisions/0042-reach-tier-harness-grants.md) | the reach tier: mage grants the harness access to an out-of-repo knowledge base | [0056](0056-hubs-addressed-by-remote-located-by-derivation.md) | reach grant |
| [0043](https://github.com/Sumit1993/mage-memory/blob/ef93c90/mage/decisions/0043-hub-addressed-by-remote-located-by-derivation.md) | A hub is addressed by its remote, located by derivation | [0056](0056-hubs-addressed-by-remote-located-by-derivation.md) | hub by remote |
| [0044](https://github.com/Sumit1993/mage-memory/blob/ef93c90/mage/decisions/0044-setup-is-a-conversation-over-one-address.md) | Setup is a conversation over one address (ADR-C, Wave C of ADR-0041) | [0056](0056-hubs-addressed-by-remote-located-by-derivation.md) | one address; conversation half in 0055 |
| [0045](https://github.com/Sumit1993/mage-memory/blob/ef93c90/mage/decisions/0045-cross-environment-presence.md) | Cross-environment presence: one state root, one place a hub can be, and no silent substitute | [0056](0056-hubs-addressed-by-remote-located-by-derivation.md) | presence, MAGE_HOME, unreachable never substituted |
| [0046](https://github.com/Sumit1993/mage-memory/blob/ef93c90/mage/decisions/0046-derived-hub-git-and-merge-ratification.md) | A branch and a pull request are the only way knowledge lands | [0057](0057-a-guard-lands-by-pull-request.md) | branch and PR only |
| [0047](https://github.com/Sumit1993/mage-memory/blob/ef93c90/mage/decisions/0047-machine-bindings-leave-committed-metadata.md) | Machine bindings leave committed metadata | [0056](0056-hubs-addressed-by-remote-located-by-derivation.md) | machine bindings off committed files |
| [0048](https://github.com/Sumit1993/mage-memory/blob/ef93c90/mage/decisions/0048-repeated-failures-become-enforcement.md) | Repeated failures become enforcement; memory is the queue, not the product | [0050](0050-mage-turns-a-repeated-failure-into-enforcement.md) | decisions 1,2,9,10 here; 3 in 0052, 4 and 7 in 0051, 5 in 0057, 6 in 0059, 8 in 0055 |

## Rules a code path or hook enforces, and the decision that now carries them

| rule | enforced by | decision |
|---|---|---|
| Gate-2 blocks a commit with a live secret in the knowledge base | `src/git-hooks.ts:29`, pre-commit | 0053 |
| Gate-1 scrubs every observe event | `src/observe/scrub.ts` | 0052, 0053 |
| Observe events are v1, additive | `src/observe/types.ts:10` | 0052 |
| Knowledge base is visible `mage/`; state is `.mage/` and never scanned | `src/paths.ts:17`, `:39`, `src/scan.ts:38` | 0054 |
| The only network call is doctor's opt-in probe | `src/commands/doctor.ts:189` | 0054 |
| Hooks are marked `mage:*` entries in settings.local.json, written by connect only | `src/adapters/claude-code/settings.ts:80`, `:328` | 0055 |
| AGENTS.md block is delimited and regenerated | `src/agents-md.ts:13` | 0055 |
| Hub path is derived from `hub_repo`; grant refuses on mismatch | `src/hub-url.ts:257`, `src/paths.ts:869` | 0056 |
| Reach grant computed from metadata shape | `src/paths.ts:836` | 0056 |
| Provenance stamped by code, never by the agent | `src/provenance.ts:57` | 0057 |
| Autonomy level is a tracked metadata field | `src/commands/autonomy.ts:35` | 0057 |
| INDEX.md and MEMORY.md are generated; the memory hook denies hand edits | `src/commands/index-cmd.ts:55`, `src/adapters/claude-code/projects.ts:29` | 0058 |
| Roster bounded at 25,600 bytes and 200 lines; warn 70%, fail 90% | `src/adapters/claude-code/constants.ts:7`, `src/metrics/footprint.ts:16` | 0058 |
| Versions from conventional commits; a breaking marker mints 0.1.0 | `release-please-config.json` | 0059 |
| Docs numbers derive from code; drift test fails CI | `src/docs/generated-data.test.ts` | 0059 |
| Native-memory write is intercepted on PreToolUse | `src/adapters/claude-code/memory-hook.ts:93` | 0051 |
