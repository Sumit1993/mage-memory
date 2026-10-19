// `metadata.json -> ladder.gate`: how the memory hook treats the first rung-less memory write
// of a session. "ask" (default) allows it and attaches the ladder as context; "deny-once"
// refuses it once. Fail-open: anything unreadable or unknown reads as "ask" (#282).

import { type ResolvedDocsRoot, readHubMetadata, readMetadata } from "./paths.js";

export type LadderGate = "ask" | "deny-once";

export const DEFAULT_LADDER_GATE: LadderGate = "ask";

let warned = false;

/** Narrow a raw `ladder.gate` value; an unknown string logs once per process to stderr. */
export function narrowLadderGate(value: unknown): LadderGate {
  if (value === "ask" || value === "deny-once") return value;
  if (value !== undefined && !warned) {
    warned = true;
    process.stderr.write(`mage: ladder.gate ${JSON.stringify(value)} is not "ask" or "deny-once"; using "ask"\n`);
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
