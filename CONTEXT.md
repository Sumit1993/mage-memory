# mage — code-architecture context

Architecture-level vocabulary for mage's source (`src/`), maintained by
`/improve-codebase-architecture`. The **product** glossary (note, wing, capture, groom,
recall, Gate-0, staging, …) lives in `mage/notes/context.md` — this file only adds terms
about how the *code* is structured, and defers to that note for everything else.

## Language

**cc-note adapter** (`src/adapters/claude-code/cc-note.ts`):
The single module that knows Claude Code's note shape — the `metadata.node_type: memory`
predicate (`isCcShaped`), the native→mage vocab map, recovery of mage's fields from a
CC-restamped note (`recoverCcFrontmatter`), and the capture-identity key. Grown from the
former `schema-map.ts`; the one import site for anything CC-shape.
_Avoid_: schema-map, cc-shim, format-bridge

**Neutral recovery** (`src/note.ts`):
The harness-neutral rule that surfaces a note's nested `metadata.*` fields to the top level
(top-level always wins). Lives in the neutral core so `scan`/`dream`/`groom` categorize a
transiently-restamped note without importing any harness adapter; the **cc-note adapter**
layers CC vocab (`mapType`) on top of it. Replaces `scan.ts`'s private `effectiveFm`.
_Avoid_: effectiveFm (the old private name), flatten (that is the durable *rewrite*, not the read)

**Capture identity** (`src/adapters/claude-code/cc-note.ts`):
The canonical key for "have we already lifted/adopted this capture?", derived from a note's
`cc-session:` source / `originSessionId`. Defined once; each caller chooses the dedup *scope*
(within-run set vs cross-run map).
_Avoid_: dedup-key, session-id (the raw field, not the key)

**Staging deep op** (`src/grooming/staging.ts`):
A bundled operation that is part of the staging module's interface — `stageDraft` (compose +
slug + dedup + write) and `promoteBatch` (stamp + promote) — which callers cross instead of
hand-assembling the low-level draft utilities. The utilities behind it (`composeDraft`,
`draftSig`, `uniqueSlug`, `writeDraft`) become internal; `readStagedDrafts` and `slugify`
stay exported as genuine shared primitives.
_Avoid_: helper, util (for these two operations — they are the interface, not helpers)

**Derived hub path** (`src/hub-url.ts`):
The deterministic local clone location mage computes from a hub's `hub_repo` remote
(`canonicalizeHubRepo` + `deriveHubPath`) — never a recorded path (ADR-0043). `chosenHubRoot`
picks it over the deprecated `hub_path` fallback whenever `hub_repo` resolves.
_Avoid_: hub path (bare, meaning the deprecated `hub_path` field — always say which one)

**Arrival verification** (`src/hub-url.ts`):
`verifyHubArrival` canonicalizes the `origin` of whatever clone sits at a derived path and
compares it against the requested `hub_repo`, before that clone is trusted. Distinct from
`looksLikeHub` (path-guards.ts), which only checks shape (`projects/` + `metadata.json`) —
derivation says where to look, arrival verification says whether what's there is the right hub.

**Displaced-clone scan** (`src/hub-scan.ts`):
`findDisplacedHubs` walks the hubs root looking for an existing clone of a wanted remote
sitting somewhere other than its derived path, so mage can suggest a `mv` instead of cloning a
duplicate. Read-only — never moves, never clones.

**path-guards split** (`src/path-guards.ts`):
`isUnder`/`looksLikeHub`/`exists` were pulled out of `paths.ts` so hub derivation
(`src/hub-url.ts`) can use them without importing `paths.ts` — `paths.ts` imports hub
derivation (for `chosenHubRoot`), so a leaf module is what keeps the two from being mutually
recursive. `paths.ts` re-exports everything here for existing call sites.

## Example dialogue

**Dev:** A CC capture comes in restamped — its real `type`/`tags` are buried under `metadata`.
Where does scan read them?

**Architect:** Through **neutral recovery** in `note.ts` — a plain nested-to-top read, no CC
vocabulary. `scan` stays harness-neutral. Only the durable rewrite (`flatten`) and the ingest
(`inbox`) reach into the **cc-note adapter** to also map CC's vocab and merge the `cc-session`
source. And when `inbox` writes the lifted draft, it crosses one **staging deep op**
(`stageDraft`) — not the five draft utilities by hand.
