---
type: feedback
tags: [mage/release]
created: "2026-06-27"
sources:
  - cc-session:0c762176-4434-4798-8bb2-abd402eed957
provenance:
  repo: mage-memory
  commit: 295298e
---
# No emojis in releases

User wants GitHub release descriptions (and published/outward-facing prose) free of emojis


No emojis in GitHub release descriptions / notes. On the mage-memory v0.0.3 release the user asked to strip the emoji section headers (✨/🔒/🗺️) and keep future release notes emoji-free.

**Why:** Preference for clean, professional release prose.
**How to apply:** When drafting `gh release create` / `gh release edit` notes for this user, use plain-text section headers — no emoji. Treat it as the default for other outward-facing/published prose too (changelogs, announcements). Plain CLI status output to the user is unaffected.
