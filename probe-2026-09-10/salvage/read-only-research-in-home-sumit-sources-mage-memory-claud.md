<!-- salvaged from subagent transcript agent-a9e0c31b78ee8bf41.jsonl, spawned 2026-09-10T08:44:46.405Z; the parent planner was killed by the session limit at 08:52 -->

# Task

Read-only research in /home/sumit/sources/mage-memory/.claude/worktrees/fable-notes-probe. Use absolute paths. Do not write files or run mutating git commands.

For each of the eight claims below, answer: EXISTS (cite the test file and the line of the `it(` or `test(` that pins it, and quote that line), PARTIAL (say what is pinned and what is not), or ABSENT (say what you searched for, with the grep commands). Then answer the follow-up question if one is given.

1. A test asserts that `scratchFingerprint` (or whatever the nudge's scratch-fingerprint function is called; look in src/adapters/claude-code/nudge.ts and nudge-state.ts) changes when one session file under `.mage/learnings/` grows (size or mtime), independent of the directory mtime.
2. A test asserts that the wing-skill link harvest in src/commands/skills-cmd.ts (or src/skills-shared.ts) filters harvest SOURCES to memory-genre notes, i.e. that N fully cross-linked decision notes plus k memory-linked notes harvest exactly k governing decisions.
3. A test asserts that `mage migrate` (src/commands/migrate.ts) or `adopt` (src/commands/adopt.ts) leaves an imported note's body byte-identical after prepending frontmatter.
4. A test in src/redact.test.ts iterates every entry of the DETECTORS table and asserts a POSITIVES fixture exists for each kind (not just that the listed fixtures are caught). Also: does the never-leak loop (a RAW_SECRETS array or similar) exist? Quote its `it(` line.
5. A test asserts tsconfig.json's `ex

# Final report

Ran from `/home/sumit/sources/mage-memory/.claude/worktrees/fable-notes-probe`. All quoted lines verified with `sed -n '<line>p'`.

**1. EXISTS** — `src/adapters/claude-code/nudge-state.test.ts:32`
`it("changes when a session_end is APPENDED to an existing stream file (not just on dir changes)", async () => {`
Appends a line to an existing `.jsonl` file (grows it) and asserts the fingerprint changes, explicitly framed as "not just on dir changes."

**2. EXISTS** — `src/commands/skills-cmd.test.ts:278`
`it("a fully cross-linked ADR corpus does not become the wing's governing list", async () => {`
38 decision notes cross-link each other via `## Relations`; one memory-genre note links 3 of them; asserts exactly 3 governing decisions harvested. (A companion test at line 233, `"harvests from memory-genre sources ONLY — ADR-to-ADR Relations links do not govern"`, covers the smaller N=3 case.)

**3. ABSENT.** Searched `grep -rn "prependFrontmatter\|addFrontmatter\|stampFrontmatter" src`, `grep -n "frontmatter" src/commands/migrate.test.ts src/commands/migrate.ts src/commands/adopt.ts`, and read both test files' `byte-identical` assertions — those cover directory *moves* under `.mage/` (migrate) and in-shape capture placement (adopt), not "prepend frontmatter to a raw body, verify byte-identical body after." The actual "prepend frontmatter, keep body byte-identical" procedure lives only as a manual shell recipe in `mage/notes/migration-field-notes.md` (`{ printf '...'; cat "$src"; } > "$dst"`), not as implemented+tested product code.

**4. PARTIAL.** `DETECTORS` (`src/redact.ts:96`) is not exported, and no test iterates it — `grep -n "DETECTORS.length\|DETECTORS.map\|DETECTORS.forEach\|for (const d of DETECTORS)" src/redact.test.ts` returned nothing, so the coverage-by-construction check does not exist. The never-leak loop does exist, twice: `src/redact.test.ts:213` `it(\`masks the raw value in the ${kind} preview\`, () => {` (iterates `POSITIVES` × `RAW_SECRETS`) and `src/redact.test.ts:496` `it(\`redacted output never contains a raw secret substring: ${input.slice(0, 28)}…\`, () => {`.

**5. ABSENT.** `grep -rn "tsconfig" src test --include=*.test.ts` returned no hits. `tsconfig.json`'s `exclude` is only `["node_modules", "dist"]` (confirmed by reading the file) — the fix is in place but untested.

**6. EXISTS** — `src/staged-scan.test.ts:84`
`it("does NOT scan a staged secret OUTSIDE the docs root (e.g. src/ test fixtures)", async () => {`

**7. PARTIAL.** Gitignore side exists but the pattern is `.mage/`-based, not `.learnings/`/`.metrics/`: `src/commands/connect.test.ts:327` `it("in-repo KB: connect gitignores the mage/-prefixed capture sinks at the repo root", async () => {` asserts `.gitignore` contains `mage/.mage/`. The doctor side also exists: `src/commands/doctor.test.ts:245` `it("KB whose sinks are NOT ignored → gitignore check fails; --fix makes it pass and writes patterns", async () => {`, backed by `src/doctor/kb-checks.ts:424` `const r = await run("git", ["-C", repoRoot, "check-ignore", ...probes]);`.

**8. ABSENT.** `grep -rn "task-notification" src --include=*.ts` and `grep -rn "Monitor event\|<summary>" src --include=*.ts` both returned zero hits anywhere in `src/`. No filter exists for `user_prompt` text starting with `<task-notification>` or containing `<summary>Monitor event:`. This matches the open gotcha in `mage/notes/harness-notifications-pollute-the-corrections-lens.md` — an acknowledged unresolved problem, not shipped/tested code.

**Follow-up — `pnpm test`:**
```
 Test Files  88 passed (88)
      Tests  1552 passed (1552)
```
