# mage docs site

The mage documentation website: an Astro Starlight static site, built to HTML and
hosted on GitHub Pages. This is an isolated sub-project with its own
`package.json` and lockfile; it is NOT part of the published npm package.

## Develop

Run everything from inside `docs/` (or via `pnpm --dir docs <script>` from the
repo root). Always pass `--ignore-workspace` for installs so pnpm does not walk
up to the repo root and inherit the CLI toolchain's workspace and `.npmrc`.

```sh
pnpm --dir docs install --ignore-workspace   # first time
pnpm --dir docs dev                           # local preview at http://localhost:4321/mage-memory/
pnpm --dir docs build                         # static build to docs/dist/
pnpm --dir docs preview                       # serve the built dist/
```

## Isolation: why `--ignore-workspace`

`docs/` is deliberately NOT a member of the root pnpm workspace (the root
`pnpm-workspace.yaml` declares no `packages:` glob). It carries its own
`docs/pnpm-lock.yaml` (committed) and its own `docs/.npmrc` /
`docs/pnpm-workspace.yaml`. Installing with `--ignore-workspace` keeps the docs
toolchain (Astro, Starlight, Mermaid) entirely separate from the published CLI's
supply chain, so adding docs deps never touches what `npm i -g mage-memory`
ships.

The local pnpm config also sets `strictDepBuilds: false` and
`verifyDepsBeforeRun: false` so a sandbox/policy that skips dependency build
scripts does not turn into a fatal install/build error. Astro's image pipeline
uses the passthrough (noop) image service, so no `sharp` native build is needed
for the text-first spine; a later illustration page can re-enable sharp.

## Generated data and the drift contract

The reference tables (commands, hooks, thresholds) are rendered FROM
`docs/src/generated/mage-data.json`, NOT hand-typed. That JSON is regenerated
from the live code by:

```sh
pnpm docs:gen   # run at the repo ROOT (builds the CLI, then writes the JSON)
```

A vitest drift test (`src/docs/generated-data.test.ts`, part of `pnpm test`)
fails CI if the committed JSON is stale. So a threshold / hook / command change
that skips `pnpm docs:gen` breaks CI, not the reader's trust. The table
components (`src/components/CommandsTable.astro`, `HooksTable.astro`,
`ThresholdsTable.astro`) only render that JSON; never retype a value into prose.

## Deploy model: on release

There is ONE hosted site, and it tracks the latest PUBLISHED npm release, so a
new user reads docs matching what they installed. The `.github/workflows/docs.yml`
workflow:

- on every pull request / push touching `docs/**` or `src/**`: regenerates the
  data, installs the docs deps, and runs `astro build` as a check (no deploy);
- on a published release (and via manual `workflow_dispatch`): builds and deploys
  `docs/dist` to GitHub Pages.

Unpublished changes are CI-validated and previewed locally with `pnpm dev` only;
they are not hosted.

One-time manual step: in the repo Settings -> Pages, set Source to "GitHub
Actions" (like the social-card upload, this is a human step the workflow cannot
do for you).
