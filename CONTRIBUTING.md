# Contributing to mage

Thanks for your interest in improving mage. This is a small, focused project —
a portable, file-based, human-committed knowledge base for AI coding agents.
Contributions of all sizes are welcome.

## Ground rules

- **`main` is protected.** Every change lands through a pull request that
  passes CI and carries review evidence (see
  [Making a change](#making-a-change)). Direct pushes to `main` are not allowed
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
5. **Open a PR** against `main`. Two required checks gate the merge:
   - **CI** (`.github/workflows/ci.yml`) runs two matrices: **build & test** —
     typecheck, build, and test on Node **22 and 24** — and **cli smoke** —
     install the packed tarball and run the CLI on Node **20 and 22**. Node 20
     is the floor the package declares, so the smoke job is what holds that
     promise.
   - **`review-evidence`** (`.github/scripts/review-evidence.sh`) is a commit
     status keyed to the PR's **head SHA** — every push invalidates prior
     evidence until the new head is reviewed. It is satisfied by either a
     **formal CodeRabbit review at the current head** (auto-review is opt-in:
     add the `review-ready` label, or comment `@coderabbitai review`) or a
     **local CodeRabbit CLI review** whose marker comment
     (`<!-- cr-cli-review: <head sha> -->`) is posted by a maintainer.
     Bot-authored PRs (dependabot, github-actions) and release-please release
     PRs are exempt — the CI gate still applies to them. During the
     observation week, a temporary workflow
     (`.github/workflows/observation-digest.yml`) posts daily review-lane
     metrics to issue #130 (the observation-week digest thread).

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
