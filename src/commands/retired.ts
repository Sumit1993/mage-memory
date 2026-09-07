export const RETIRED_VERB_MESSAGES = {
  distill:
    "mage distill has retired. Use `mage groom` instead.\nCandidate distillation is folded into groom.",
  promote:
    "mage promote has retired. Use `mage groom` instead.\nPromotion proposals are folded into groom.",
  graduate:
    "mage graduate has retired. Use `mage groom` instead.\nProcedure skill proposals are reviewed and applied through groom.",
  skills:
    "mage skills has retired. Use `mage index` instead.\nGenerating navigation skills is folded into index.",
  dashboard:
    "mage dashboard has retired. Use `mage index` instead.\nGraph and dashboard generation are folded into index.",
  footprint:
    "mage footprint has retired. Use `mage doctor` instead.\nContext footprint diagnostics are folded into doctor.",
  ingest:
    "mage ingest has retired. Use `mage groom` instead.\nSource enumeration is folded into groom.",
  stage:
    "mage stage has retired. Use `mage observe` instead.\nDirect capture will route through observe, but the finding event is not built yet.",
} as const;

export type RetiredVerb = keyof typeof RETIRED_VERB_MESSAGES;

export function printRetiredVerb(verb: RetiredVerb): void {
  console.log(RETIRED_VERB_MESSAGES[verb]);
}
