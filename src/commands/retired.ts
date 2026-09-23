export const RETIRED_VERB_MESSAGES = {
  distill:
    "mage distill has retired. Nothing replaces it yet.\nIts work moves to `mage groom` with the proposal digest (#219).",
  promote:
    "mage promote has retired. Nothing replaces it yet.\nIts work moves to `mage groom` with the proposal digest (#219).",
  graduate:
    "mage graduate has retired. Nothing replaces it yet.\nA skill becomes one proposal type in `mage groom` (#219, #235).",
  skills:
    "mage skills has retired. The wing skill is retired; `mage index` regenerates INDEX.md and MEMORY.md.\n`mage skills --metrics` keeps folding the context-match rollup until `mage ledger` (#237).",
  dashboard:
    "mage dashboard has retired. Use `mage index` instead.\nGraph and dashboard generation are folded into index.",
  footprint:
    "mage footprint has retired. Use `mage doctor` instead.\nContext footprint diagnostics are folded into doctor.",
  stage:
    "mage stage has retired. Use `mage observe` instead.\nDirect capture will route through observe, but the finding event is not built yet.",
} as const;

export type RetiredVerb = keyof typeof RETIRED_VERB_MESSAGES;

export function printRetiredVerb(verb: RetiredVerb, quiet: boolean): void {
  if (quiet) return;
  console.log(RETIRED_VERB_MESSAGES[verb]);
}

