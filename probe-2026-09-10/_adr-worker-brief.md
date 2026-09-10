# ADR enforcement worker brief

Read-only task in the git worktree /home/sumit/sources/mage-memory/.claude/worktrees/fable-notes-probe (commit a945759). Use absolute paths only. Do not write any file. Do not run git commands that mutate.

You are given ONE decision file under mage/decisions/. Read it in full. It has sections Decision, Why, Forbids, Example, Relations.

Step 1. Split the `Decision` section and the `Forbids` section into clauses. A clause is one testable assertion: one sentence, or one item in a sentence that lists several things ("A, B and C" is three clauses if each is independently violable). Number them D1.. and F1.. Quote each clause verbatim (short clauses whole, long ones truncated at 120 chars with `...`).

Step 2. For EVERY clause, answer three columns:
  (a) What would enforce this? Name the concrete artifact kind and its content in one line: a settings deny rule, a CI check, a vitest test, a pre-commit line, a PreToolUse hook matcher, a doctor check, an `mage index` rejection, an AGENTS.md sentence, a GitHub ruleset, or "nothing can: it is a definition / a statement of intent / a design property with no violating action".
  (b) Does that artifact exist today? Cite file:line if yes (verified, see Step 4). If no, write "nothing enforces it". If a different, weaker artifact exists (a warning instead of a block, a rule sentence instead of a check), cite it and say "weaker:".
  (c) What happens right now when someone violates it? Pick exactly one: `blocked` (a write or commit is denied), `fails-test` (CI or pnpm test goes red), `warns` (something prints but nothing stops), `silent` (nobody would notice). Then one line of justification.

Step 3. If the clause is already covered by a row in /home/sumit/ai-context/notes-probe/OUT-contradictions.md (tables A, B, C, rows like A18, B6), cite the row id instead of re-deriving; still fill (c).

Step 4. Verification, mandatory: for every file:line you cite in (b), run `sed -n '<line>p' <file>` and confirm the line contains the thing you claim. Drop any citation that fails. Use /home/sumit/ai-context/notes-probe/_inventory.txt as a starting map of where enforcement points live (pre-commit body, CI jobs, hook matchers, doctor checks, index validation, redaction detectors, release tests); confirm anything you take from it with your own sed before citing.

Step 5. Output, plain text, under 150 lines:
  - The ADR number and title.
  - A table: clause id | clause (short) | (a) enforcer | (b) exists? file:line | (c) outcome | contradiction row if any.
  - Counts: number of Decision clauses, number of Forbids clauses, and for each of the four outcomes (blocked / fails-test / warns / silent) how many clauses.
  - One line listing the clause ids where you were unsure between two outcomes, and which two. Do not hedge in the table itself; commit to one and list the doubt here.
No recommendations. No prose beyond the table and the counts.
