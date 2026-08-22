---
type: gotcha
tags:
  - mage/build
created: "2026-08-12"
last_reviewed: 2026-08-12
status: active
provenance:
  repo: mage-memory
  work: groom-2026-08-12
sources:
  - decisions/0015-mage-observe-capture-schema.md
  - decisions/0018-mage-distill-observed-scratch-reader.md
  - cc-session:60cf690b-5033-4003-a85a-882dacbd15df
  - cc-session:f0a4c7d6-14a5-4f07-a1f4-052892c791bc
keywords:
  - distill
  - corrections-lens
  - task-notification
  - monitor-event
  - user-prompt
  - capture-schema
  - signal-to-noise
  - background-agents
  - groom
---

# Gotcha — distill's corrections lens counts harness notifications as user corrections

[ADR-0018](../decisions/0018-mage-distill-observed-scratch-reader.md) makes lens ① (user
corrections) **first-class** — a human steer is standing intent, so groom looks there first.
But the reader classifies **any user-role message** as a prompt or correction, and in an
agentic session most user-role messages are harness-injected: `<task-notification>` blocks
when a background job finishes, `<summary>Monitor event: …` lines when a watcher fires.

Measured across both clusters of this repo's 2026-08-12 groom:

| lens | total | harness | human |
|---|---:|---:|---:|
| corrections | 23 | 16 | **7** |
| prompts | 41 | 32 | **9** |

**The noise scales with background work**, so the lens degrades worst in exactly the sessions
worth mining — both clusters here came from an overnight run with a dozen parallel agents. The
cluster `hint` string ("a user correction + a failure + a repeated workflow") is computed from
the unfiltered counts, so it overstates what is actually there.

**Procedure:** before applying lens ①, drop every signal whose text starts with
`<task-notification>` or contains `<summary>Monitor event:`. Judge what remains.

The durable fix is at capture, not judgment:
[ADR-0015](../decisions/0015-mage-observe-capture-schema.md)'s `user_prompt` event should not
record harness-injected user-role messages at all. Until it does, every groom pays the filter
by hand.

## Relations

- Lens definitions and the first-sight gate:
  [ADR-0018](../decisions/0018-mage-distill-observed-scratch-reader.md)
- The event schema that records the messages:
  [ADR-0015](../decisions/0015-mage-observe-capture-schema.md)
- Sibling failure in the soak's evidence path:
  [soak-monitor-blind-spots](soak-monitor-blind-spots.md)
