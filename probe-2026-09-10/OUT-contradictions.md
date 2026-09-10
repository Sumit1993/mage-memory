# Contradiction pass: the 48 decisions, #206, the 54 open issues, AGENTS.md, and the product itself

Read 2026-09-10 against worktree A at `ef93c90` (PR #206 with today's fixes), the 54 open issues, the 14 open PRs, and `src/` at main's `1465b4f`. Counts come from the tsv census, not the road page (which reports 19 / 6 / 0; live is 54 / 14 / 6).

## Is it one product?

No, not yet, and the gap is in the code, not the documents. After the collapse the ten decisions and the 54 issues describe one product: the loop that turns a repeated failure into a guard landed by pull request. `src/` still ships the store: `src/cli-program.ts` registers `distill` (:223), `promote` (:242), `stage` (:261), `groom` (:297), `dashboard` (:550), `footprint` (:164), `skills` (:136); the memory hook at `src/adapters/claude-code/memory-hook.ts:93` scrubs and redirects instead of returning the ladder; `src/observe/types.ts:10` has no `tool_attempt`; nothing in `src/` knows a proposal type, a guard id, a ledger or `landing`. The five draft PRs #254 to #260 are the first code of the new product and none has been reviewed. Until they merge, the docs site, the README and the plugin manifests (`README.md` cites 0020 dashboard and 0021) advertise the store.

Four places where the three sources describe different products, each a row below: where a guard file lives (A20), who counts a settings deny (C6), how many visible verbs there are (C5), and the phase order the milestones encode against #204 (C1).

## A. Ruling versus Edit across the documents

| # | where | contradiction | verdict | resolution |
|---|---|---|---|---|
| A1 | ADR-0048 decisions 9, 10 (`mage/decisions/0048:101-102`) vs PR #206 committing `docs/plans/0048-road-to-0.1.0/` (2,426 lines) | The ADR forbids repo plan files; the same PR adds seven | Ruling | Directory removed, `1793346`; sections 12-14, 8, 10, 11 go to #204 as a comment (`OUT-204-mechanics.md`) |
| A2 | AGENTS.md:28-30 vs CONVENTIONS.md:191-219 | AGENTS.md retires `mage/work/`; CONVENTIONS.md routes plan and tasks there | Edit | `23515df` |
| A3 | Road page section 6 ("0005: native memory is off"; "0032 supersede: commandeer off, hook groups removed by migrate") vs ADR-0048 decision 7 and the #207 correction comment (migrate does not turn commandeer off) | The page predates the 09-07 ruling | Ruling | ADR-0048 wins; the page is gone |
| A4 | Road page section 2 table ("Ledger committed in the KB") vs ADR-0048 decision 6 ("Nothing new is committed") | | Edit | Page gone; 0059 forbids a committed ledger |
| A5 | ADR-0048 decision 10 ("fits on one screen") vs the file at 139 lines | | Edit | 0050 is 35 lines; every survivor under 40 |
| A6 | PR #206 body ("Superseded: ... 0032 ... (7)", "Amended: 12") vs the diff (6 superseded, 0032 amended, 20 amended) | | Edit | Seat replaces the body (`OUT-206-rulings.md` row 3) |
| A7 | `mage/MEMORY.md` "41 accepted decisions" (main) and "36" (#206) vs census 13 accepted, 28 active, 4 proposed, 2 superseded; `src/commands/index-cmd.ts:71` counts `accepted \|\| active` | The count is right for its filter; the word is wrong | Ruling | All ten survivors `accepted`; line reads "10 accepted decisions govern" |
| A8 | ADR-0021:32 ("the only network egress remains doctor's opt-in connectivity check") vs ADR-0046:62-65 (mage pushes a branch and opens a PR); no supersede or amend link between them; ADR-0048's 0021 amendment covers only the puller's reads | | Ruling | 0054: egress is doctor's probe plus operator- or hook-invoked reads and writes to the user's own forge with the user's credentials |
| A9 | ADR-0006:18 (index is "navigated (pull)") vs ADR-0033:53 ("deterministic launch-load"); 0033 says `extends` 0006, 0006 has no pointer back | | Edit | 0058: deterministic load; the `@import` line is the fallback |
| A10 | ADR-0026:25 (`detailed_by ../work/plan-docs-site.md`) vs ADR-0048 decision 9 (`work/` retired); 0026 is in none of 0048's three effect lists | | Ruling | 0059 absorbs 0026; the plan file is history until the fold moves it |
| A11 | ADR-0013:36-41 (scratch to note to skill ladder) vs its own 0048 amendment at :19 ("no graduation path") | | Edit | 0013 deleted; 0057 |
| A12 | ADR-0040:37-39, 74-83 (a1 gate binding; evidence ADR required) vs its amendment at :35 | | Edit | 0040 deleted; 0059 |
| A13 | ADR-0046:126 (`proposals: true` is the gate) vs ADR-0048 decision 5 (`landing` key) | | Edit | 0046 deleted; 0057 |
| A14 | ADR-0015 event table (no `tool_attempt`) vs its amendment; ADR-0017:77-82 hook table (no PreToolUse arm) vs its amendment | | Edit | 0052, 0055 |
| A15 | ADR-0034 (adopt is the dispatcher; connect consumes it) vs its amendment (import moves to migrate) | | Edit | 0055 |
| A16 | ADR-0048 decision 6 ("a unit other than mage-memory", undefined) vs plan 12.6 ("counts are per machine for 0.1.0") vs #248 ("unit: one knowledge base with its own ledger") | Three definitions | Ruling | Decision 6 now defines unit as one knowledge base (`ef93c90`); per-machine is a reading convenience, not the key |
| A17 | #248 (retire "note as a category" and "admitted" from docs, skills, CLI text, frontmatter) vs ADR-0048 decisions 4 and 7 ("a note is admitted") and #231, #245 titles | | Ruling | Survivors say "a note is the rung-5 guard" and "the hook lets through"; issue titles are the fold's problem |
| A18 | ADR-0048 decision 7 and ADR-0032 ("never blocks the host", `memory-hook.ts:224` comment) vs CodeRabbit's fail-closed finding on 0005:14 | An admission gate that fails open admits everything | Ruling | Decision 7 amended (`ef93c90`): deny a `notes/` write on hook failure, pass everything else |
| A19 | Road page 12.3 ("an issue closed as completed is landed") vs CodeRabbit on page:522 and #249 (inventory is the source of truth) | | Ruling | `landed` only when the inventory finds the carrier; 0057 Forbids |
| A20 | #249 ruling ("`.mage/guards/<id>.md`", committed, git-blamed, Obsidian-rendered) vs ADR-0025 (`.mage/` is gitignored transient state; `src/scan.ts:38` never scans it) and ADR-0048 decision 6 ("nothing new is committed") | The ruled path cannot be committed or rendered | Ruling, needs operator | 0057 puts the file in the vault beside `notes/`; the compiled cache stays under `.mage/` |
| A21 | ADR-0037:65 ("fail-open, never throws") and 0037 §4 (versioned `<!-- BEGIN mage vN -->` stamp promised) vs #198 ruling (content hash, warn, `--force-agents-md`) and `src/agents-md.ts:13` (unversioned marker) | | Ruling | 0055: the content hash is the stamp; the vN scheme is dropped |
| A22 | ADR-0039 ("footprint unchanged" for the observe arm, cited by the road page) vs #239 measurement (about 102 ms per call, rows +93 percent, bytes +47 percent) | | Edit | 0058 states the measurement and makes no such claim |

## B. Decisions versus the code

| # | decision | code | status | owner |
|---|---|---|---|---|
| B1 | ADR-0048 decision 9: `work/` retired | `src/commands/init.ts:166` scaffolds `work/.gitkeep` for every new knowledge base | code contradicts | #207 |
| B2 | ADR-0047 §3 and the #191 ruling: on an origin mismatch the derived path wins, never fall back to `hub_path` | `src/paths.ts:686` `hubRoot = meta.hub_path; // fall back ... (incl. on a mismatch)`; `src/paths.ts:869` `resolveHubGrant` was fixed, `externalDocsRoot` was not | code contradicts | #191 (P1) |
| B3 | ADR-0044 §3: `mage init --local` mints `local://<name>` | `src/commands/init.ts:186` writes `hub_repo: null`; `src/hub-url.ts:27` calls the scheme "proposed" | mandated, never built, no issue builds it | needs an issue; #191's comment says `hub_path` removal waits on it |
| B4 | ADR-0048 Consequences: soak, keep-rate, distill, promote, graduate leave the CLI | `src/cli-program.ts:223` distill, `:242` promote, `:261` stage, `:297` groom, `:211` ingest, `:136` skills, `:550` dashboard, `:164` footprint all registered; `crownThreshold` in `src/grooming/autonomy-ladder.ts`; `src/grooming/backlog.ts` wired into the nudge | lag, planned | #208 (PR #256), #210 (PR #257), #223 |
| B5 | ADR-0048 decision 3: `tool_attempt` with the invocation id | `src/observe/types.ts:10` union has no `tool_attempt` | lag, planned | #209 (PR #260) |
| B6 | ADR-0048 decision 7 (as amended): the hook returns the ladder and denies `notes/` on failure | `src/adapters/claude-code/memory-hook.ts:93` scrubs and redirects; `:243` catches everything and exits 0 | lag; the fail-closed clause is new today | #229 (PR #258) must add the deny |
| B7 | ADR-0035: flatten repairs harness-rewritten frontmatter | `src/adapters/claude-code/cc-note.ts:107` `isCcShaped` keys on `metadata.node_type`, which the harness stopped stamping; flatten has been a silent no-op | code silently dead | #200 (PR #259) |
| B8 | ADR-0014 / 0053: connect installs Gate-2 and doctor checks it | doctor skips the pre-commit check for external-mode knowledge bases | check not wired | #195 |
| B9 | ADR-0026, 0040, and every "tests green" claim in #204 | `.github/workflows/ci.yml` never runs `test:integration`; one integration test red since 2026-07-29 | check not wired | #243 (PR #254) |
| B10 | ADR-0021: doctor's probe is the only network call | `src/commands/doctor.ts:189` is the only call today | code matches; changes when PR #182 (push + PR) merges, covered by 0054 | none |
| B11 | ADR-0046: a branch and a PR are the only way knowledge lands | no `gh pr create`, branch or push code in `src/`; PR #182 carries it, BEHIND main, unreviewed | not built | #182, then #235 |
| B12 | ADR-0048 decision 5: `landing` consent key | `src/grooming/config.ts` has no `landing` | not built | #222 |

## C. Roadmap versus the issues and the milestones

| # | where | contradiction | resolution |
|---|---|---|---|
| C1 | Milestones `040 P0 hand` < `050 P1 clearing (0.0.19)` (numeric order) vs #204 body ("Count first" claude-kit#60 and #230, then P1, then P0) and the road page ("P1 and P0 run in parallel; P2 waits on P0's counts") | The prefixes encode an order the plan does not have | The fold renames to versions per the direction skill: 0.0.19 (P1 and P0 both), 0.1.0 (P2 and P3), later |
| C2 | #226 "ADR supersede flags and amendments" (P3 milestone `120`) vs #206 (already did it) vs this collapse (deletes the flags) | Three states of one task | Close #226 when #206 merges |
| C3 | #204 P2 line "#234 mage guards: the inventory from the six carriers of 12.1" vs #249 ruling (one file per guard; #234 folds into #237) | #204 is stale against a ruled issue | Fold rewrites the line |
| C4 | #201 comment reframes recall-at-need as "an ADR-0041 rung-3 design question" and #135 is "built on superseded ADR-0041" | Both anchor on a deleted decision | Re-anchor on 0058 in the umbrella |
| C5 | #248 (eight visible verbs, "no new verbs" in the end-to-end sketch) vs #250 (`mage why`, `mage mute`) and #251 (`mage try`) | Three new visible verbs against a ruled surface | Decide before P2: `ledger why`, `ledger mute`, and `try` under `doctor` or hidden; or amend #248 |
| C6 | ADR-0048 decision 3 and #209 (an attempt without a use is a prevented call, counted by mage) vs #230 comment ("a settings deny can never self-report; rung 1 counted by claude-kit's transcript miner") and #237 comment ("deny-prevented counting moves to claude-kit's miner") | Two counters for one number; #232 showed PreToolUse does fire on a settings deny, so `tool_attempt` can count it | Ruling: `tool_attempt` (PR #260) is the counter once it lands; the kit's miner is the P0 stopgap and its number is quoted, not summed |
| C7 | Road page section 7 ("#200 close: root cause removed, commandeer off") vs #200 reopened by the operator (commandeer stays; read through the wrapper) | | Page gone; #200's ruling stands |
| C8 | #215 (three guards by hand, with counts) has one seam recorded (WebFetch deny in the kit, before-count 24 in 8 sessions) and no after-count; 0059's gate needs three guards on two units | P0 exit criterion unmet; P2 code (PRs #254-#260 are P1) is not yet blocked by it | Nothing to change; the fold should mark #215 as the P2 gate holder |
| C9 | #175 still asks for `mage stage --repo-side`; `stage` retires in #208 | | #204 already notes the reword; the umbrella does it |
| C10 | Road page promises "one review-findings puller", "operator corrections tagged with a rule id", "the kit contract", "the ledger", "stale in dream" | All have issues: #217, #244, #216, #237, #221 | none |
| C11 | Road page section 8 lists 20 docs surfaces and 12.11 six more; #224 says "sections 8 and 12.11" of a page that is now a comment | | Fold copies the list into #224 from `OUT-204-mechanics.md` |
| C12 | #252 item 3 ("guards count humans too", parked after 0.1.0) vs its own comment (cost fell to near zero; pull forward) | | Fold decides; 0052 already accepts `guard_fired` from any source |

## Notes for the fold and the triage

- #226 close on #206 merge; #248 close on the collapse merge (0050 is its ADR).
- The 12.x citations in 15 issues point at a comment now; umbrellas link it.
- PR #258 must deny on hook failure for `notes/` (A18, B6). PR #256 retires eight verbs; check #250 and #251 against it (C5). PR #182 is the loop's only PR path and is BEHIND main.
- `src/` comment citations (about 500) and `.coderabbit.yaml` (8) need the README map applied; one agy lane, no code change.
