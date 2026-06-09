# Contributing to mage

Thanks for your interest in improving mage. This is a small, focused project —
a portable, file-based, human-committed knowledge base for AI coding agents.
Contributions of all sizes are welcome.

## Ground rules

- **`main` is protected.** Every change lands through a pull request with green
  CI. Direct pushes to `main` are not allowed (for anyone, including the
  maintainer).
- **mage never runs git for you, and never commits secrets.** Capture *insight,
  procedure, and pointers* — never copies of sources. Redaction gates exist for
  a reason; do not weaken them.
- Keep PRs focused. One logical change per PR makes review fast.

## Development setup

Requirements: **Node >= 18** and **pnpm** (this repo pins pnpm via the
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
5. **Open a PR** against `main`. CI (build + typecheck + test on Node 18/20/22)
   must be green before it can merge.

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

Releases are cut by the maintainer: tag `vX.Y.Z`, GitHub release, then
`npm publish`. Contributors do not need to touch versioning.

## License

By contributing, you agree that your contributions are licensed under the
project's [MIT License](LICENSE).
