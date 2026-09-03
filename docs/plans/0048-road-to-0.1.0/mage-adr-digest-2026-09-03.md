# Mage ADR digest -- 2026-09-03

One structured entry per ADR. Format:

```
### NNNN - Title
date:       YYYY-MM-DD (created)
status:     active | accepted | proposed | superseded
because:    one sentence on the forcing function
decides:    one sentence on the decision made
constrains: files or patterns it governs
amends:     ADRs this amends (if any)
supersedes: ADRs this supersedes (if any)
```

Branch: docs/adr-0048-enforcement-redirection.
ADR count verified against ls mage/decisions/*.md | wc -l = 48.

---

### 0001 - A memory-first product (mage) supersedes specshub
date:       2026-05-29
status:     active
because:    specshub's "spec-driven development" name actively misled about a product whose real purpose was durable, portable, cleanup-resistant memory.
decides:    launch a clean product named mage rather than reframe specshub in place; archive specshub with a README pointer.
constrains: mage/decisions/*.md (ADR numbering starts fresh here); npm and GitHub identities.
amends:     none
supersedes: none

### 0002 - mage forks specshub (clean copy, fresh history) and reorients
date:       2026-05-29
status:     active
because:    specshub's existing hub/metadata/CLI plumbing was about 60-70% reusable without rebuilding from scratch.
decides:    take a clean file copy (no git history) of specshub and rename identities; prune spec-era framing; add the memory layer (note schema, index generator, wing tags, learn/dream, Obsidian authoring).
constrains: src/ (imports, names), plugin.json, README.
amends:     none
supersedes: none

### 0003 - Track work units and notes; git-ignore only artifacts and scratch
date:       2026-05-29
status:     active
because:    mage's founding goal is "durable portable knowledge that doesn't get lost," which fails if in-progress work units are ignored.
decides:    commit notes/, decisions/, work/*.md; git-ignore only work/*/artifacts/ (raw/large/binary) and .mage/learnings/ (pre-promotion scratch).
constrains: .gitignore, mage/work/, mage/notes/.
amends:     none
supersedes: none

### 0004 - Capture insight, procedure, and pointers -- not copies of sources
date:       2026-05-29
status:     active
because:    copying external sources creates lossy, staleness-prone mirrors; the goal is "do it faster / fewer mistakes next time."
decides:    notes capture the reusable insight, the procedure (steps + bad calls to avoid), and pointers to canonical sources in sources: -- never a copy of the source body.
constrains: skills/learn/SKILL.md, skills/groom/SKILL.md, note frontmatter conventions.
amends:     none
supersedes: none

### 0005 - Exactly one canonical durable memory; native memories are feeders, not rivals
date:       2026-05-29
status:     active
because:    two competing "durable" stores produce a split-brain where neither is trustworthy.
decides:    mage is the canonical source of truth for durable knowledge; CC native auto-memory stays on as a feeder but is not canonical or portable; mage:learn harvests insights from it.
constrains: src/adapters/claude-code/, metadata.json, skills/learn/SKILL.md.
amends:     amended by ADR-0048 (native memory is off, not a feeder)
supersedes: none

### 0006 - Two-layer recall: per-wing auto-loaded skills + a hierarchical factual index
date:       2026-05-29
status:     active
because:    no single recall surface can serve both "load the right procedural context immediately" and "find any fact that exists."
decides:    two surfaces: one auto-loaded SKILL.md per wing for hot procedural context, plus a hierarchical INDEX.md for cold factual lookup; note-to-skill promotion ladder deferred until needed.
constrains: src/commands/skills-cmd.ts, src/commands/index-cmd.ts, .claude/skills/, .agents/skills/.
amends:     amended by ADR-0048 (roster bounded to notes that passed admission)
supersedes: none

### 0007 - Mine agentmemory's design; don't depend on it
date:       2026-05-31
status:     active
because:    agentmemory's server-shaped, 4-decay-tier model was incompatible with mage's offline, git-native, human-confirmed ethos.
decides:    harvest specific algorithms (promote-when-recurrence, instinct-to-skill ladder) as inspiration; never introduce a runtime dependency on agentmemory.
constrains: src/ (no agentmemory import).
amends:     none
supersedes: none

### 0008 - In-repo knowledge base lives in a visible mage/ dir (not hidden .mage/)
date:       2026-06-01
status:     active
because:    Obsidian's "open folder as vault" picker hides dot-folders, so .mage/ was invisible to the graph and contradicted the "discoverable and navigable as an Obsidian graph" founding value.
decides:    knowledge base lives in mage/ (visible); .mage/ is reserved for machine-written transient state only.
constrains: src/paths.ts, metadata.json schema key "mode": "in-repo".
amends:     none
supersedes: none

### 0009 - No runtime of our own; automation rides the host agent's hooks + the agent's reasoning
date:       2026-06-01
status:     active
because:    a persistent daemon introduces operational overhead, security surface, and offline failure modes incompatible with a portable knowledge tool.
decides:    mage has no daemon; all automation rides the host agent's hook events (SessionStart, PostToolUse, Stop, etc.); the agent itself is the reasoner -- mage's engine is deterministic-only.
constrains: src/cli-program.ts (only hook-friendly plumbing), src/adapters/claude-code/ (the CC adapter).
amends:     none
supersedes: none

### 0010 - mage is durable memory, not a multi-agent coordination layer
date:       2026-06-01
status:     active
because:    conflating durable knowledge storage with real-time multi-agent messaging would require a server and would make mage depend on network availability.
decides:    mage stores knowledge; it does not route messages or coordinate agents at runtime; cross-agent sharing happens through git commits.
constrains: src/ (no coordination protocol, no pub/sub).
amends:     none
supersedes: none

### 0011 - A hub is one vault; the scanner recurses; projects are wings
date:       2026-06-02
status:     active
because:    the container-of-independent-vaults model fragmented the graph and orphaned cross-project notes; notes tagged engine/x should index under the engine wing wherever they physically sit.
decides:    a hub is one Obsidian vault; the scanner deny-lists .obsidian/, .git/, node_modules/, artifacts/, archive/, generated indexes; notes/, decisions/, work/ lose privileged status; projects are indexed by tag/wing, not by folder structure.
constrains: src/scan.ts, src/commands/index-cmd.ts, hub layout (projects/<name>/ flat, no nested mage/).
amends:     none
supersedes: none

### 0012 - A wing is an optional convention; hubs are standalone-first
date:       2026-06-03
status:     active
because:    nine gaps surfaced during a grill session showed mage was coded for software developers only; a wing being mandatory blocked non-developer hubs.
decides:    a wing is optional (untagged notes index under "Cross-cutting"); hubs can be created standalone (mage init with no code repo); mage init is detection-first; --external retired in favour of --hub; multi-home by tags; no level above wing.
constrains: src/commands/init.ts, src/commands/link.ts, src/scan.ts, skills/guide/SKILL.md.
amends:     amended by ADR-0046 (git-posture invariant re-keyed on outcome, not the action)
supersedes: none

### 0013 - Procedure skills and the self-grooming loop
date:       2026-06-05
status:     active
because:    proven procedural notes accumulate but stay invisible once the knowledge base is large; an auto-loaded SKILL.md makes them surface at the right moment without burdening INDEX.md.
decides:    a proven procedural note (procedure or gotcha) graduates to its own auto-loadable mage-skill-<slug>/SKILL.md via mage dream --apply (the single serialized writer); the note stays the substrate; the human's git commit is the only confirm gate; mage never commits.
constrains: src/dream.ts, skills/graduate/SKILL.md, skills/optimize/SKILL.md, .claude/skills/, .agents/skills/.
amends:     amended by ADR-0024 (batch confirm bends the per-note confirm), ADR-0048 (skills are one output type, measured by firing)
supersedes: none

### 0014 - Two-gate redaction (strip secrets before write, not before display)
date:       2026-06-05
status:     active
because:    a note or skill carrying a secret becomes a liability the moment it is committed; blocking display without blocking writes leaves the secret on disk.
decides:    Gate 1 at mage observe (capture): fast regex scrub before writing to .mage/learnings/. Gate 2 at mage redact (write): full scrub of a draft before any tracked write; a LIVE secret exits non-zero and stops the write.
constrains: src/observe/scrub.ts, src/redact.ts, skills/learn/SKILL.md, skills/groom/SKILL.md, src/adapters/claude-code/memory-hook.ts.
amends:     none
supersedes: none

### 0015 - mage observe: the capture schema (the keystone .jsonl)
date:       2026-06-06
status:     active
because:    without a versioned, additive-only schema, every reader and writer risks incompatibility as the event vocabulary grows.
decides:    lock a versioned envelope (v: 1) plus an additive-only evolution rule; event types are session_start, user_prompt, assistant_msg, skill_load, tool_use, compact, session_end; bounds on free-text fields to bound file size.
constrains: src/observe/types.ts, src/observe/events.ts, src/commands/observe.ts, .mage/learnings/*.jsonl.
amends:     none
supersedes: none

### 0016 - Context-match, the confidence ladder, and the single applier
date:       2026-06-06
status:     active
because:    a skill that keeps loading where it does not belong costs context with no payoff; measuring match rate lets the self-grooming loop tune or retire stale triggers.
decides:    context-match is computed deterministically from the skill_load match snapshot vs. the 20-event forward window; three advisory rungs (ok / reword-suggested / demote-suggested); reword and demote proposals go through mage dream --apply (the single writer with four hard ceilings: no auto-commit, no bespoke-skill rewrite, no hard-delete, no write past Gate 2).
constrains: src/metrics/context-match.ts, src/metrics/rollup.ts, skills/optimize/SKILL.md.
amends:     none
supersedes: none

### 0017 - mage connect: the host hook adapter (capture is opt-in)
date:       2026-06-06
status:     active
because:    bundling capture hooks with the skills plugin would silently capture sessions for users who only wanted the knowledge-navigation skills.
decides:    capture is a separate explicit opt-in: mage connect wires hooks into settings.local.json (gitignored); mage disconnect cleanly reverses the wiring without touching the user's own hooks.
constrains: src/commands/connect.ts, src/commands/disconnect.ts, src/adapters/claude-code/settings.ts (MAGE_HOOKS).
amends:     none
supersedes: none

### 0018 - mage distill: the observed-scratch reader (capture, on first sight)
date:       2026-06-08
status:     active
because:    the raw .learnings/ event stream is too noisy for a host agent to mine manually; a deterministic reader must filter and cluster before the agent judges.
decides:    mage distill --json is pure plumbing: reads .mage/learnings/ from the per-session watermark forward, clusters un-distilled CLOSED segments, emits a DistillManifest; mage:groom is the judgment skill layered on top; watermark advances only on explicit --seen.
constrains: src/distill/, src/commands/distill-cmd.ts, skills/groom/SKILL.md (Phase 1).
amends:     amended by ADR-0048 (distill leaves the CLI)
supersedes: none

### 0019 - mage promote: self-grooming (recurrence, graduation, merge/split)
date:       2026-06-08
status:     active
because:    a note proven by recurrence across many sessions earns auto-loading as a skill without manual curation.
decides:    mage promote --json is a second deterministic fold over .mage/learnings/: per-pattern (wing+tags) recurrence tally, distinct-session counting; proposals are only action: "graduate" (ADR-0038 deleted the note-proposal rung); notes at or above M chapter-reads with type procedure/gotcha become graduate proposals.
constrains: src/grooming/, src/commands/promote-cmd.ts, .mage/metrics/tally.json.
amends:     amended by ADR-0024 (graduation deferred in 0.0.12), ADR-0038 (note-proposal rung deleted)
supersedes: none

### 0020 - The dashboard: a per-KB, no-server generated view (option D)
date:       2026-06-09
status:     active
because:    a server-based dashboard would contradict mage's offline-first, no-phone-home posture; Obsidian Dataview required a community plugin with lock-in risk.
decides:    three tiers: Dashboard.md (portable static), Knowledge.base (Obsidian data, core plugin), dashboard.html (self-contained HTML cockpit, opens in any browser). The HTML cockpit is the hero; the curator's proposal queue is the centerpiece; nothing writes until the human says so.
constrains: src/commands/dashboard-cmd.ts, src/dashboard/.
amends:     none
supersedes: none

### 0021 - mage stays offline: no phone-home telemetry; signal is local + voluntarily shared
date:       2026-06-09
status:     active
because:    "we don't track you; your memory and its metrics stay on your machine" is a positioning win, and the improvement signal is already fully local (context-match, tally, accept/reject ledger).
decides:    no phone-home telemetry in core, never on by default; the only network egress is doctor's opt-in connectivity check; voluntary on-demand export via mage doctor --report (redacted, anonymized, user-inspectable).
constrains: src/ (no analytics import), src/commands/doctor.ts (--report only).
amends:     none
supersedes: none

### 0022 - Remove the spec-kit-derived SDD skills
date:       2026-06-13
status:     active
because:    the seven SDD skills advertised mage as a spec-driven-development tool, contradicting the memory-first pivot.
decides:    delete all seven SDD skill directories; keep only the memory loop skills (learn, distill, promote, graduate, optimize, guide); update all plugin/marketplace descriptions; Spec/Plan/Tasks note types stay in the type vocabulary.
constrains: skills/ (only five skills remain), plugin.json, marketplace.json, README.
amends:     none
supersedes: none

### 0023 - A hub keeps its own notes AND flat per-project subdirs (ratification)
date:       2026-06-14
status:     active
because:    the hub layout drew a recurring "isn't that duplication?" question that needed a single authoritative answer.
decides:    the hub has its own top-level notes/ (cross-cutting knowledge) and projects/<name>/ (project-scoped knowledge, hub-owned) -- scope-separation, not duplication; project docs root is projects/<name>/ directly (flat, no nested mage/).
constrains: src/commands/init.ts, src/commands/link.ts, src/paths.ts.
amends:     none
supersedes: none

### 0024 - Organic grooming loop: the lesson path (inline-primary + boundary nudge)
date:       2026-06-16
status:     active
because:    three months of capture-only design produced zero organic note creations; CC memory over the same period minted real first-sight lessons, proving the "lesson path" (first-sight -> note) matters more than the "procedure path" (recurrence -> skill).
decides:    three epistemic states (.learnings/ raw, .staging/ judged drafts, notes/ committed); inline-primary via mage stage + always-on AGENTS.md instruction; boundary safety-net via mage nudge on SessionStart(compact); no embedded judge (model-free); anti-flood budget of 3 drafts per pass + reject ledger.
constrains: src/commands/stage-cmd.ts, src/commands/groom-cmd.ts, src/adapters/claude-code/nudge.ts, src/grooming/staging.ts.
amends:     ADR-0013 (batch confirm bends the per-note confirm), ADR-0019 (graduation deferred in 0.0.12)
supersedes: none

### 0025 - One transient-state home (.mage/) + redact config in metadata.json
date:       2026-06-16
status:     active
because:    ADR-0024 introduced .staging/ and a nudge-throttle JSON at the docs root, scattering transient state and risking accidental commits of scratch.
decides:    all machine-written transient state lives under ONE gitignored .mage/ directory (.mage/learnings/, .mage/staging/, .mage/metrics/); the redact allowlist moves from .redactignore into metadata.json under a redact field.
constrains: src/paths.ts, .gitignore generation.
amends:     none
supersedes: none

### 0026 - A hosted documentation website, generated from code
date:       2026-06-18
status:     accepted
because:    hand-authored reference docs inevitably drift from the implementation; a drift test that guards volatile facts prevents silent divergence.
decides:    build a static Astro Starlight docs site under docs/, hosted on GitHub Pages; volatile facts (thresholds, dials, schema fields) are generated from live code by a pure builder; a drift test fails CI if the generated snapshot is stale.
constrains: docs/ (a separate package.json), src/docs/generated-data.ts.
amends:     none
supersedes: none

### 0027 - Faultline: a friction/derivation capture trigger (prefilter, not miner)
date:       2026-06-20
status:     superseded
because:    a deterministic tool-transition detector was needed to narrow which events to surface to the agent; building one and pre-registering a gate was the correct experimental posture.
decides:    Faultline narrows and ranks chapter events by approach-key and tried-to-worked arcs; the host agent judges whether each is a durable lesson. Gate ran: 0/62 confirmed keeps -- structural sensor mismatch (detected position of friction but not content).
constrains: src/distill/ (faultline.ts, a documented dead-end, not wired).
amends:     none
supersedes: superseded by ADR-0028

### 0028 - Prose-keyed capture: corrections + recurrent failures (supersedes Faultline)
date:       2026-06-20
status:     superseded
because:    Faultline's 0/62 gate kill proved the sensor was structurally blind to durable lessons; a prose-keyed approach targets the right content but the wrong unit.
decides:    supersede Faultline; pivot to fix the existing distill path by keying on correction prose and recurrent-failure strings. Gate ran: 0/55 -- surfaced cheap conversational steering, not lessons.
constrains: src/distill/ (reader.ts corrections/failures extraction).
amends:     none
supersedes: ADR-0027, superseded by ADR-0029

### 0029 - Digest-to-agent capture: deterministic narrowing, agent judgment (supersedes prose-keyed)
date:       2026-06-20
status:     active
because:    two pre-registered gates (Faultline 0/62, prose-keyed 0/55) both killed by deterministic candidate-selection; the model swept the same events at near-Opus precision, proving the agent is the judge.
decides:    supersede deterministic candidate-selection entirely; the boundary nudge emits a read-only DIGEST as additionalContext; the host agent mines it and stages what it judges worthy via mage stage; .mage/staging/ holds only agent-chosen lessons.
constrains: src/adapters/claude-code/nudge.ts, src/distill/digest.ts.
amends:     none
supersedes: ADR-0028

### 0030 - Opt-in agent autonomy ladder for the grooming loop (Operator / Approver / Overseer)
date:       2026-06-21
status:     active
because:    soak KBs stalled at raw .mage/learnings/ and never produced notes because the maintainer reliably forgot to run mage:groom; the boundary nudge was blind to the backlog.
decides:    three opt-in autonomy levels (Operator HITL per note, Approver HITL at batch commit, Overseer HOTL); Gate-2 redaction runs before every write at all levels; the commit stays the irreducible human gate; mage never commits.
constrains: src/grooming/autonomy-ladder.ts, src/adapters/claude-code/nudge.ts, skills/groom/SKILL.md, metadata.json grooming.autonomy.
amends:     none
supersedes: none

### 0031 - Programmatic provenance stamping + the autonomy reject-ledger (phase 1)
date:       2026-06-22
status:     active
because:    without reliable attribution on autonomously-written notes, the keep-vs-revert ratio (the signal that justifies higher autonomy) cannot be measured.
decides:    mage's deterministic writer stamps provenance (autonomy, repo, commit) at note creation as a side-effect of the write -- never by agent instruction; Phase 2 (the reject-ledger reconciler) is sketched but not built.
constrains: src/provenance.ts, src/grooming/ (groom --accept writer), note frontmatter.
amends:     none
supersedes: none

### 0032 - Capture-redirect: co-opt the host's native-memory write into mage's git-durable pipeline
date:       2026-06-25
status:     accepted
because:    the host agent writes lessons to its own native memory at the moment of discovery; intercepting that write is the lowest-friction capture path.
decides:    when CC auto-memory is on and a docs root resolves, commandeer autoMemoryDirectory to the KB docs root; Gate-0 (memory-hook PreToolUse) scrubs topic note writes in-flight and denies writes to generated indexes; Gate-0 does not reshape frontmatter (CC overrides it post-write; flatten owns the durable normalization).
constrains: src/adapters/claude-code/memory-hook.ts, src/adapters/claude-code/settings.ts, src/commands/connect.ts (commandeer tier).
amends:     none
supersedes: ADR-0048 supersedes this

### 0033 - Recall: @import the bounded root index into the host's auto-loaded context
date:       2026-06-25
status:     accepted
because:    the agent needs mage's bounded index at session launch; without it the knowledge base is invisible until the agent explicitly reads INDEX.md.
decides:    with autoMemoryDirectory = docs root, CC auto-loads MEMORY.md at session launch; MEMORY.md is a CC-adapter twin of the portable INDEX.md, containing only the top-K memory-genre notes by rank (bounded by ADR-0039).
constrains: src/commands/index-cmd.ts (MEMORY.md generation), src/adapters/claude-code/.
amends:     amended by ADR-0048 (roster bounded to notes that passed admission)
supersedes: none

### 0034 - Adopt: a dispatcher for onboarding pre-existing knowledge
date:       2026-06-27
status:     accepted
because:    an existing code repo may have Claude Code memories or note files predating mage; onboarding them manually one by one is impractical.
decides:    mage adopt is a front-end dispatcher to the existing inbox pipeline (not a new pipeline); in-shape captures are placed into the docs-root top (the capture inbox); out-of-shape sources are reported for manual distill; no downstream machinery is added.
constrains: src/commands/adopt.ts, src/ingest.ts.
amends:     none
supersedes: none

### 0035 - Notes are memories: one unified store; normalize at the durable boundary
date:       2026-06-28
status:     accepted
because:    fighting the CC post-write restamp at write-time (Gate-0 frontmatter mapping) was unwinnable; CC normalizes its own format after the hook runs.
decides:    one unified store (mage notes ARE the memory store); Gate-0 does only the irreplaceable job (secret scrub) and never reshapes frontmatter; normalization to mage's neutral flat schema happens at the durable boundary (mage flatten --staged pre-commit hook, plus the scanner's dual-format tolerance).
constrains: src/adapters/claude-code/memory-hook.ts (no frontmatter mapping), src/adapters/claude-code/flatten.ts, src/commands/connect.ts (pre-commit hook install).
amends:     ADR-0005 (clarified: native memory IS the canonical store, made durable)
supersedes: none

### 0036 - Defer the HarnessAdapter seam until a second harness exists
date:       2026-06-28
status:     accepted
because:    a PR review of the CC adapter surfaced friction that seemed to justify a HarnessAdapter interface, but the interface would have been guessed from one example and likely mis-shaped.
decides:    do not build a HarnessAdapter interface yet; defer until a second harness lands and two concrete adapters reveal the genuinely shared surface; consolidate CC note-shape into src/adapters/claude-code/cc-note.ts now.
constrains: src/adapters/ (CC-only; no abstract interface).
amends:     none
supersedes: none

### 0037 - doctor's remit extends to recall + skills readiness, on a bounded auto-fix line
date:       2026-07-02
status:     accepted
because:    mage doctor originally diagnosed only capture health; a KB can have perfect capture but broken recall and still fail agents silently.
decides:    doctor's remit is three layers: capture (existing checks), recall (INDEX.md freshness, MEMORY.md presence), skills (per-wing skills generated, context-match loaded); --fix is bounded to adding missing capture-sink ignore rules only; larger fixes are suggested, never auto-applied.
constrains: src/commands/doctor.ts, src/doctor/.
amends:     none
supersedes: none

### 0038 - promote's note-proposal rung is deleted; graduate repoints to note-read usage
date:       2026-07-19
status:     accepted
because:    a live soak across four KB roots produced ~115 recurrence buckets and 0 durable proposals; the note-proposal rung was the killed deterministic-selection pattern from ADR-0029 one step further removed.
decides:    delete the action: "note" rung from promote; every proposal is now action: "graduate"; graduation gating switches from context-match to note-read usage across distinct chapters; context-match governs only reword/demote post-graduation.
constrains: src/commands/promote-cmd.ts, src/grooming/note-reads.ts, src/grooming/tally.ts, skills/groom/SKILL.md (Phase 2).
amends:     ADR-0019 (note-proposal rung deleted), ADR-0016 (context-match scope narrowed to post-graduation)
supersedes: none

### 0039 - Measure the context footprint; bound the generated launch surface
date:       2026-07-19
status:     accepted
because:    the generated MEMORY.md + per-wing skills can silently grow to consume most of the context window, displacing the working context the agent actually needs.
decides:    mage footprint measures occupancy (bytes, lines) vs. CC's cap, yield, pointer leverage; MEMORY.md is hard-capped (byte cap and line cap from CC constants); the trend is appended per session to footprint-trend.jsonl by the nudge hook.
constrains: src/metrics/footprint.ts, src/adapters/claude-code/constants.ts, src/adapters/claude-code/nudge.ts.
amends:     none
supersedes: none

### 0040 - Version numbers are mechanical; the announcement is a named release backed by evidence
date:       2026-07-19
status:     accepted
because:    release-please bumps the minor for any breaking change in a pre-1.0 repo, so a milestone version like "0.1.0" could be spent by an unrelated commit without warning.
decides:    no Release-As overrides; version numbers carry no quality claim; the announcement for ADR-0024's a1 gate (organic note creation observed) is a named GitHub release plus an ADR recording the evidence.
constrains: .release-please-config.json, CHANGELOG.md process.
amends:     ADR-0024 (a1 gate preserved; version attachment struck)
supersedes: none

### 0041 - Genre decides the recall rung: one store, three recall paths
date:       2026-07-27
status:     proposed
because:    the existing type vocabulary mixed note types that should be auto-loaded with types that should only be recalled on demand, causing INDEX.md bloat.
decides:    one store, three recall rungs: Rung 1 skill (context-triggered, graduated notes), Rung 2 index line (always loaded, MEMORY.md-eligible, memory-genre only), Rung 3 on demand (note body, every note); genre is derived from a closed type: vocabulary exported from src/scanner/ -- no second field.
constrains: src/scan.ts (genre map), src/commands/index-cmd.ts (MEMORY.md filter), skills/guide/SKILL.md (type table).
amends:     ADR-0035 (genre filter added to recall)
supersedes: ADR-0048 supersedes this

### 0042 - The reach tier: mage grants the harness access to an out-of-repo knowledge base
date:       2026-07-27
status:     accepted
because:    an external or hybrid KB lives outside the code repo root, so CC cannot read it without an explicit filesystem grant; disabling CC auto-memory must not sever access to the KB.
decides:    a grant tier independent of the commandeer tier, gated on local scope and a KB outside the code repo; mage adds the KB root(s) to permissions.additionalDirectories in settings.local.json; ownership tracked in mageOwnedAdditionalDirectories.
constrains: src/commands/connect.ts (reach tier), src/adapters/claude-code/settings.ts.
amends:     none
supersedes: none

### 0043 - A hub is addressed by its remote, located by derivation
date:       2026-07-29
status:     accepted
because:    recording hub_path in committed metadata meant every team member's absolute home directory path was committed to the repo, making the file wrong on every machine except the one that wrote it.
decides:    the local path of an external hub is DERIVED from hub_repo + MAGE_HOME (~/.mage/hubs by default) -- one deterministic location per remote, same on every machine; hub_path is a deprecated fallback read only when hub_repo is absent or unresolved.
constrains: src/paths.ts (resolveDocsRoot, hub derivation), metadata.json (hub_repo is authoritative).
amends:     amended by ADR-0045 (MAGE_HOME is the documented public relocation contract)
supersedes: none

### 0044 - Setup is a conversation over one address (ADR-C, wave C of ADR-0041)
date:       2026-07-31
status:     accepted
because:    the setup flow asked too many questions and had two resolution paths (remote vs. local hubs), confusing users about how many steps they faced.
decides:    there is exactly ONE resolution path (derivation from hub_repo + MAGE_HOME); local-only hubs get a derived home too; init/link/connect ask for one address and infer everything else; hub_path dies rather than surviving as a local-hub fallback.
constrains: src/commands/init.ts, src/commands/link.ts, src/commands/connect.ts (setup conversation UX).
amends:     none
supersedes: none

### 0045 - Cross-environment presence: one state root, one place a hub can be, and no silent substitute
date:       2026-08-22
status:     proposed
because:    a live GitHub Actions run derived the correct hub path from hub_repo and MAGE_HOME without incident, proving the mechanism; but a committed hub_path that overrides correct derivation still existed and could win on the next run.
decides:    all machine-wide state lives under $MAGE_HOME (default ~/.mage); MAGE_HOME is a supported public contract (not a test hook); a hub lives at its derived path and nowhere else; no registry, no redirect, no alternative clone location.
constrains: src/paths.ts (MAGE_HOME env var), .github/workflows (CI sets MAGE_HOME).
amends:     ADR-0043 (MAGE_HOME documented as the relocation contract)
supersedes: none

### 0046 - A branch and a pull request are the only way knowledge lands
date:       2026-08-22
status:     proposed
because:    the "mage never runs git" invariant was already false (connect clones on consent; the pre-commit gate re-stages files); the invariant needed to be re-keyed on what mage PRODUCES rather than the git actions it performs.
decides:    mage may run git in the KB repo; what it may produce is bounded: a branch and a pull request only; never a commit on the default branch; never a push outside that branch; only when explicitly invoked, never as a side effect of capture or grooming.
constrains: src/commands/connect.ts (clone on consent), src/git-hooks.ts (pre-commit re-stages), any future PR-creating command.
amends:     ADR-0012 (git-posture invariant re-keyed)
supersedes: none

### 0047 - Machine bindings leave committed metadata
date:       2026-08-29
status:     proposed
because:    committed metadata.json mixed portable values (hub_repo, mode) with machine-local values (hub_path, code_repo_path), making the file wrong on every machine except the one that last wrote it; doctor --fix was actively churning shared files against every other machine.
decides:    one carrier per key class, carriers never merge; portable identity and policy live in committed metadata.json; machine bindings that are derivable (hub path) live nowhere (computed at runtime); machine bindings materialized locally (CC grants) live in gitignored settings.local.json; code_repo_path is removed with no replacement.
constrains: src/paths.ts, src/commands/link.ts, src/doctor/link-checks.ts, metadata.json schema.
amends:     ADR-0012 (committed metadata now portable-only)
supersedes: none

### 0048 - Repeated failures become enforcement; memory is the queue, not the product
date:       2026-09-03
status:     proposed
because:    three months of capture produced 39 notes of which 3 chapters in this repo read any note; routed through an enforcement ladder, 17 notes were programs waiting to be written and 9 were one-line rules -- the store was enforcement debt, not memory.
decides:    mage is the loop that turns a repeated failure into enforcement by proposing the highest-rung fix (architecture > check > hook > rule > note) and landing it by pull request; a note is admitted only with a named trigger moment and is expected to leave when the trigger is fixed; native auto-memory is off; two numbers gate 0.1.0: bad actions prevented by a landed fix, and notes that left the queue.
constrains: all prior ADRs (see Effect on prior decisions in the ADR file).
amends:     ADR-0001 (charter), ADR-0005 (native memory off), ADR-0006 (roster bounded), ADR-0013 (skills measured by firing), ADR-0033 (roster bounded)
supersedes: ADR-0018, ADR-0019, ADR-0024, ADR-0029, ADR-0032, ADR-0038, ADR-0041

---

## Issues that motivated decisions

The following GitHub issues are cited or traceable to ADR decisions in this repository.
Compiled from ADR text references and the closed/open issue lists as of 2026-09-03.

### Closed issues

| # | Title | Related ADR |
|---|---|---|
| #71 | promote's note-proposal rung is the killed deterministic-selection pattern | ADR-0038 (kept 0 of ~115 noise buckets; deleted the note-proposal rung) |
| #96 | Plugin cache bloat: directory-source marketplace copies the whole working tree (556 MB) | ADR-0022 (SDD skills removal reduced plugin footprint) |
| #103 | Research: worktree propagation for the reach-tier grant (ADR-0042 out-of-scope) | ADR-0042, ADR-0043 (chose doctor-detects, human runs mage connect per worktree) |
| #104 | Wave C -- grill and draft ADR-C (connect/external layers) | ADR-0044 (setup-is-a-conversation wave C) |
| #106 | connect points code repos at a wing dir that mage index never writes -- MEMORY.md permanently stale | ADR-0033, ADR-0041 (MEMORY.md generation fixed to write at docs root) |
| #113 | 0.0.18 docs checklist: hub_path surfaces to update when ADR-0043 derivation ships | ADR-0043 (hub_path deprecated; docs updated) |
| #123 | Spec the local:// hub migration before hub_path is removed (ADR-0044) | ADR-0044 (local hub derivation from file:// address) |
| #150 | connect never reaps pre-id legacy hook groups (and doctor reports them as healthy) | ADR-0017 (LEGACY_MAGE_COMMANDS list added; id-tagged groups introduced) |
| #151 | doctor: connection check reports DISCONNECTED while mage hooks are wired and firing | ADR-0037 (doctor checks three layers; connection check fixed) |
| #152 | learn/groom: replace the merge preference with a merge procedure (the one-question test) | ADR-0004, ADR-0018 (one-question test formalized in capture pipeline) |
| #153 | doctor/nudge: deterministic merge-candidate detection in the index scan | ADR-0037 (doctor recall-readiness check) |
| #156 | AGENTS.md capture rule fires on plans and decisions, which are not note material | ADR-0041 (genre filter restricts MEMORY.md to memory-genre notes) |
| #158 | resolveDocsRoot: external-mode repo whose hub is unreachable silently captures into repo KB | ADR-0043 (derivation from hub_repo; unreachable hub is an error, not a silent fallback) |

### Open issues (as of 2026-09-03)

| # | Title | Related ADR |
|---|---|---|
| #114 | docs-governance rollout: finish Phase 1 audit, run docs-refresh + prevention nets | ADR-0026 (drift test for generated docs) |
| #135 | Accepted decisions are invisible to keyword search | ADR-0015 (schema keywords field), ADR-0026 (docs) |
| #137 | playbook: recommended by groom's lens table, absent from the genre map -- unclassified at rung 3 | ADR-0041 (genre map; playbook is a legacy alias for procedure) |
| #154 | KB curation: two genre miscalls, one verified merge, and the audit's not-merge record | ADR-0041 (genre decides recall rung) |
| #175 | Ephemeral VM story (CC cloud sessions): committable hook registration, fail-loud hub bootstrap | ADR-0046 (branch and PR as the only output), ADR-0045 (MAGE_HOME in CI) |
| #177 | Review-lane memory: what a GitHub Actions consumer needs from the store | ADR-0048 (enforcement loop; review findings are the top-weight signal) |
| #191 | hub_path overrides correct derivation even when the derived path exists | ADR-0043, ADR-0047 (hub_path removed from committed metadata) |
| #193 | Remove code_repo_path and the hub-side fan-out it exists for | ADR-0047 (code_repo_path removed with no replacement) |
| #194 | Non-interactive connect exits 0 while refusing to clone and skipping commandeer tier | ADR-0032 (commandeer tier requires clone consent) |
| #195 | doctor skips the Gate-2 redact pre-commit hook check in external mode | ADR-0037 (doctor's remit extended) |
| #196 | doctor --fix writes a machine-local path into committed hub metadata | ADR-0047 (machine bindings must never land in committed metadata) |
| #197 | Bare mage link invents a project from the worktree basename and corrupts the hub | ADR-0023 (hub layout; link must require explicit project name) |
| #198 | mage link regenerating the AGENTS.md block destroys hand-written content | ADR-0012, ADR-0044 (setup conversation; regeneration must be additive) |
| #199 | flatten silently drops object-form sources entries | ADR-0035 (flatten owns neutral schema normalization) |
| #200 | The harness memory layer rewrites mage frontmatter, so flatten is a repair with no prevention | ADR-0048 (enforcement; Gate-0 prevention is the missing rung above flatten) |
| #201 | Recall has no mid-task trigger, and 91.9 percent of notes are never read | ADR-0048 (motivating evidence; memory is the queue, not the product) |
| #202 | Wire pushReachGrantCheck into the session-start nudge | ADR-0042 (reach tier grant check) |
| #204 | Tracking: order of work to 0.1.0, as of 2026-09-02 | ADR-0048 (release gate: two numbers replace keep-rate) |
