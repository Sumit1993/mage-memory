# Contributing to mage

Thanks for your interest in improving mage. This is a small, focused project —
a portable, file-based, human-committed knowledge base for AI coding agents.
Contributions of all sizes are welcome.

## Ground rules

- **`main` is protected.** Every change lands through a pull request that
  passes CI and — unless it is a bot or release-please PR, which are exempt —
  carries review evidence (see [Making a change](#making-a-change)). Direct pushes to `main` are not allowed
  (for anyone, including the maintainer).
- **mage never runs git for you, and never commits secrets.** Capture *insight,
  procedure, and pointers* — never copies of sources. Redaction gates exist for
  a reason; do not weaken them.
- Keep PRs focused. One logical change per PR makes review fast.

## Development setup

Requirements: **Node >= 20** and **pnpm** (this repo pins pnpm via the
`packageManager` field; `corepack enable` will use the right version).

```bash
git clone https://github.com/Sumit1993/mage-memory.git
cd mage-memory
pnpm install

pnpm build       # bundle with tsup -> dist/
pnpm typecheck   # tsc --noEmit
pnpm test        # vitest run
pnpm test:watch  # vitest in watch mode
```

Run the built CLI locally:

```bash
node dist/cli.js --help
```

## Making a change

1. **Branch** off `main`: `git checkout -b fix/short-description`.
2. **Write a test first** where it makes sense (the suite is vitest; we aim for
   ~80% coverage). Fix the implementation, not the test, unless the test is
   wrong.
3. Make sure `pnpm typecheck`, `pnpm build`, and `pnpm test` all pass.
4. **Commit** using [Conventional Commits](https://www.conventionalcommits.org/):
   `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`, `ci:`, `perf:`.
5. **Open a PR** against `main`. The merge contract is exactly three things —
   two required status checks and one ruleset condition:
   - **`CI gate`** (`.github/workflows/ci.yml`) aggregates two matrices:
     **build & test** — typecheck, build, and test on Node **22 and 24** — and
     **cli smoke** — install the packed tarball and run the CLI on Node **20 and
     22**. Node 20 is the floor the package declares, so the smoke job is what
     holds that promise. The aggregating job is the single stable required
     context, so adding a matrix leg never changes the ruleset.
   - **`Validate PR title (conventional commits)`** — the PR *title* becomes the
     squash-merge commit subject, so the title is linted rather than the
     branch's individual commits.
   - **`required_review_thread_resolution`** — one unresolved review thread
     blocks the merge. This is the only mechanism that enforces a finding: a
     finding matters exactly as much as the thread it lives in.

   **Reviewers are advisory, and no check waits on them.** `claude[bot]` reviews
   every same-repo PR automatically; CodeRabbit is admitted by hand (add the
   `review-ready` label, or comment `@coderabbitai review`) because its quota is
   shared org-wide. Neither blocks the merge directly — but every thread they
   open does.

   > **A green job is never evidence of review.** A reviewing workflow can report
   > `success` having posted nothing, and one did for two weeks. Read for posted
   > comments; never read a check's colour as a review.

   The lifecycle end to end, including what a push does and does not invalidate:

   ```text
   push abc1234                     CI gate ............. pending → success
                                    Validate PR title ... success
                                    claude[bot] ......... 3 inline comments
                                    → merge BLOCKED (3 unresolved threads)

   fix + push def5678               CI gate re-runs against the new head.
                                    The 3 threads PERSIST — pushing a fix does
                                    not clear a thread; only a reply plus
                                    resolution does.

   reply in each thread             reviewer verifies 2 and resolves them;
                                    you resolve the 3rd yourself as declined,
                                    with the reason stated in-thread
                                    → merge ALLOWED

   gh pr merge --squash             PR title becomes the commit subject
   ```

   Bot-authored PRs (dependabot, github-actions) and release-please release PRs
   attract no review threads, so the two status checks are their whole contract.

   > **Superseded machinery.** A `review-evidence` commit status keyed to the head
   > SHA, and its `.github/scripts/review-evidence.sh`, were retired in #146.
   > A document still describing them is stale.

## Working with the mage knowledge base

This repo dogfoods mage: there is a knowledge base under `mage/`. Before
non-trivial work, read `mage/INDEX.md` and skim `mage/decisions/` for governing
ADRs (see [AGENTS.md](AGENTS.md)). When you learn something durable, capture it
as a note rather than letting it evaporate. Design decisions are recorded as
ADRs under `mage/decisions/`; substantial changes should reference or add one.

## Code style

- Small, cohesive files (prefer many small files over few large ones).
- Explicit error handling; fail fast at boundaries with clear messages.
- Prefer immutable updates over in-place mutation.
- No `console.log` debris and no hardcoded secrets.

## Reporting bugs and requesting features

Use the issue templates. For anything security-sensitive, **do not open a public
issue** — see [SECURITY.md](SECURITY.md).

## Releases

Releases are cut via Release Please (`release-please-config.json`): merging the
release PR tags `vX.Y.Z`, creates the GitHub release, and publishes to npm.
Contributors do not need to touch versioning.

## License

By contributing, you agree that your contributions are licensed under the
project's [MIT License](LICENSE).
