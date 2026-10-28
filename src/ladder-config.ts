// `metadata.json -> ladder.gate`: how the memory hook treats the first rung-less memory write
// of a session. "deny-once" (default) refuses it once after keeping a copy under notes/.held/;
// "ask" allows it and attaches the ladder as context. Anything unreadable or unknown reads as
// the default (#282).

import { type ResolvedDocsRoot, readHubMetadata, readMetadata } from "./paths.js";

export type LadderGate = "ask" | "deny-once";

export const DEFAULT_LADDER_GATE: LadderGate = "deny-once";

let warned = false;

/** Narrow a raw `ladder.gate` value; an unknown string logs once per process to stderr. */
export function narrowLadderGate(value: unknown): LadderGate {
  if (value === "ask" || value === "deny-once") return value;
  if (value !== undefined && !warned) {
    warned = true;
    process.stderr.write(`mage: ladder.gate ${JSON.stringify(value)} is not "ask" or "deny-once"; using "${DEFAULT_LADDER_GATE}"\n`);
  }
  return DEFAULT_LADDER_GATE;
}

/** The gate for a resolved docs root; a hub reads its own root metadata, like grooming (ADR-0030). */
export async function readLadderGate(resolved: ResolvedDocsRoot): Promise<LadderGate> {
  try {
    const meta =
      resolved.kind === "hub" ? await readHubMetadata(resolved.repo) : await readMetadata(resolved.repo);
    return narrowLadderGate(meta?.ladder?.gate);
  } catch {
    return DEFAULT_LADDER_GATE;
  }
}

/** Test seam: forget that the unknown-value warning was printed. */
export function resetLadderGateWarning(): void {
  warned = false;
}
