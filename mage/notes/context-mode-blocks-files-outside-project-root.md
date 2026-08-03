---
type: gotcha
tags: [mage/build]
created: "2026-08-03"
last_reviewed: "2026-08-03"
status: active
sources:
  - cc-session:8fca047a-2c83-4245-a405-111a0fa68480
  - cc-session:ee0349da-df7e-4672-b8be-dc8cb25cb2c5
  - cc-session:f9674d57-5fc5-44bf-990c-37375a968941
  - cc-session:f826625a-291c-4d8c-9c57-36f5336d8dd7
provenance:
  repo: mage-memory
  work: groom-2026-08-03
keywords:
  - context-mode
  - ctx-execute-file
  - project-root
  - scratchpad
  - ai-context
  - file-access-blocked
  - allow-rule
  - sandbox
---
# Gotcha — context-mode refuses any file outside the project root, and the scratchpad always is

`ctx_execute_file` (and file reads inside `ctx_execute`) hard-fail with
*"File access blocked: … resolves outside the project root"* for any path not under the
current repo. This is deliberate confinement (context-mode issue #852: the sandbox must not
bypass the host's permission controls), **but the two places an agent most wants to analyze
are always outside the root**: the harness scratchpad
(`/tmp/claude-1000/<project>/<session>/scratchpad/`) and `~/ai-context/`. It has burned an
attempt in at least four distinct sessions across mage-memory and prismalens — each time the
agent piped a big artifact to the scratchpad precisely to keep it out of context, then could
not process it there.

**Procedure (pick one, in order of preference):**

1. **Generate the artifact inside the repo** in a throwaway dir (e.g. `.mage/tmp/`), process
   it, and `rm -rf` the dir before any commit — check `git check-ignore` first; `.mage/tmp/`
   is NOT gitignored.
2. **Copy an existing outside file in**, same cleanup rule.
3. **Permanent fix for a recurring path:** add the allow rule the error message itself
   prints — `"permissions": { "allow": ["Read(<path>)"] }` in `.claude/settings.local.json`.
   Worth doing once for `~/ai-context/` if analysis there keeps recurring.

**The tell you're about to hit it:** you just wrote a large tool output to the scratchpad
"to save context" and your next step is "now summarize it with ctx_execute_file".

Scope note: this is a user-level environment constraint living here because this KB doubles as
the user store — see [route-memories-to-the-matching-store](route-memories-to-the-matching-store.md).
Sibling harness gotcha: [stopped-background-workflows-leave-no-record](stopped-background-workflows-leave-no-record.md).
