---
title: Stage and groom (retired)
description: Retired in 0.0.18; see the ladder and mage groom.
---

This page is a retired pointer to ADR-0060. It described part of the self-grooming loop (streams, digests, proposals, a ledger and a counting gate). 0.0.18 cut that loop from the surface; see [ADR-0060, the ladder reset](https://github.com/Sumit1993/mage-memory/blob/main/mage/decisions/0060-the-ladder-reset.md).

What replaced it:

- [The ladder](./overview.md): a remembered fact climbs to a rule, hook or check where it can, and stays a note only where it must.
- [Recall at the action](../model/recall.md): a note whose `trigger.match` hits a tool call is injected on PreToolUse.
- `mage groom` walks existing notes up the ladder and lands the result by pull request.
