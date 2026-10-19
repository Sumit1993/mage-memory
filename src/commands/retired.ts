export const RETIRED_VERB_MESSAGES = {
  distill:
    "mage distill has retired. Run `mage groom` to walk your notes up the ladder, or `/mage:learn` to write one.",
  promote:
    "mage promote has retired. Run `mage groom`: a note climbs to a rule, hook or check instead.",
  graduate:
    "mage graduate has retired. Run `mage groom`: a note climbs to a rule, hook or check, not to a skill.",
  dashboard:
    "mage dashboard has retired. Use `mage index` instead.\nGraph and dashboard generation are folded into index.",
  footprint:
    "mage footprint has retired. Use `mage doctor` instead.\nContext footprint diagnostics are folded into doctor.",
  ingest:
    "mage ingest has retired. Use `/mage:learn --from <dir>` to turn a folder into notes.",
  stage:
    "mage stage has retired. Use `/mage:learn` to write a note, then `mage groom` to judge its rung.",
} as const;

export type RetiredVerb = keyof typeof RETIRED_VERB_MESSAGES;

export function printRetiredVerb(verb: RetiredVerb, quiet: boolean): void {
  if (quiet) return;
  console.log(RETIRED_VERB_MESSAGES[verb]);
}
