# Brief — run mage's ladder by hand, on mage's own notes, before the code exists

This is a probe, not a cleanup. The cleanup is a by-product.

The operator wants the thing mage's redirection promises to do automatically,
done by hand first, on a real corpus, so the pits show up before anything is
built. What you write down about *why the routing was hard* is worth more than
the routing.

Repo `Sumit1993/mage-memory`, PUBLIC. Today is 2026-09-10.
Worktree, and the only place you may write:
`/home/sumit/sources/mage-memory/.claude/worktrees/fable-notes-probe`
on branch `docs/notes-ladder-probe`, off `main` at `a945759`.
Do not push. Do not open a pull request.

## The thing being tested

ADR-0051 (merged this morning) states the ladder: impossible, check, hook, rule,
note. Its entire **Why** section is one sentence of evidence:

> Routing this repo's 39 notes through the ladder gave 1 impossible, 11 checks,
> 5 hooks, 9 rules, 8 notes, 5 deletions: the store was enforcement debt.

That came from a single hand-routing on 2026-09-03, never replicated. A decision
that now governs the product rests on one un-repeated measurement. Repeat it.

If your routing agrees with the baseline, the premise is sound and the router is
worth building. If it diverges, the divergence is the most valuable thing you
will produce today, and it must not be smoothed over.

## Inputs, all under `~/ai-context/notes-probe/`

- `baseline-2026-09-03.md` — the prior routing, 39 notes, with mechanism and reason per row.
- `read-evidence.md` — read counts measured today, and why they are a weak signal. Read this before you weigh "unread" against anything.
- `notes-list.txt` (41), `note-sizes.tsv`, `stale-adr-citations.txt` (27).
- `OUT-contradictions.md` — today's contradiction pass, for how the code and the decisions currently disagree.

In the repo: `mage/notes/` (41 notes, 2,445 lines, median 54, max 194),
`mage/decisions/` (the ten survivors), `AGENTS.md`, `src/`.

## Deliverable 1 — route all 41, blind first

Route each note to its rung before you open the baseline. Anchoring to the prior
answer destroys the only thing this measures. Write your table, then compare.

Per row: note, rung, the concrete mechanism (the actual check, hook, rule or deny
you would write, one line), where it lands, the trigger moment if the rung is
note, and why every higher rung was ruled out.

`OUT-routing.md`.

## Deliverable 2 — the divergence

Compare to the baseline. Report the agreement rate as a number. For every note
whose rung changed, say which routing you think is right and why the other was
defensible. Two notes are new since 09-03; route them, do not count them as
divergence.

Then answer the question the operator actually needs: **would an automated router
have been stable here?** A rung that two careful passes disagree on is a rung a
program will get wrong silently.

`OUT-divergence.md`.

## Deliverable 3 — the pits

The point of the exercise. Write down, concretely:

- Every note where the ladder gave no clear answer, and what extra fact would have decided it.
- What input a router needs that `mage` does not capture today. Be specific about the event or field.
- Where routing needs knowledge that lives outside the note (the code, an issue, a PR). A router that only reads the note cannot see these; say how many rows that affects.
- Which rungs are cheap to judge and which are expensive. If `check` is easy and `impossible` needs an architect, the automation should not attempt both.
- What would make the router confidently wrong, as opposed to uncertain. Silent wrongness is the failure that matters.

`OUT-pits.md`.

## Deliverable 4 — the retrofit reality check

ADR-0051 requires every note to carry `trigger:`, `pointer:` and `skipped:`, and
says `mage index` rejects one that does not. **No note has these fields today.**

Take three notes that your routing keeps, and write their three fields for real.
Then say what retrofitting all the survivors would cost, and whether `skipped:`
can be written honestly after the fact or is only meaningful at capture time.
That last question decides whether the field is worth building.

`OUT-retrofit.md`.

## Deliverable 5 — the by-product

In the worktree, and only after the four files above exist:

- Repoint the 27 notes citing a deleted ADR (0001-0048) to the survivor. The map is `mage/decisions/README.md`.
- Do **not** delete or fold any note in this run. The routing is the recommendation; the operator rules on it.

Commit. `pnpm test` must stay green (1,552 tests, 88 files).

## Research

Spawn `sonnet` subagents for the legwork: reading the 41 notes, the `src/` sweep
for what each proposed check or hook would attach to, the baseline comparison
mechanics. Bounded question and explicit verification steps each; Sonnet needs
those stated. Judgement and prose stay yours.

## Output

Five files, commits in the worktree, and a final message of at most 20 lines
naming: the agreement rate, the sharpest pit, and what you would not automate.
