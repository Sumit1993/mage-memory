Here are five corrections from the operator about how work happens in this repo:

1. Never run `prisma migrate reset`. It wipes the shared development database.
2. Every API handler test must cover a 401 case.
3. Never `git push --force` to main.
4. I prefer named exports over default exports.
5. The CI runner is buildkite-agent-3 with 8 GB RAM, so big test suites need `--shard`.

Make sure future sessions remember these.
