import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  failureSkeleton,
  isProtocolFailure,
  isSubstantiveCorrection,
} from "../../distill/digest.js";
import { readSessionStreams } from "../../distill/reader.js";
import { sessionFilePath } from "../../observe/store.js";
import type { ObserveEvent } from "../../observe/types.js";
import { learningsPath, type ResolvedDocsRoot } from "../../paths.js";
import type { NudgeResult } from "./nudge.js";

export interface SessionReceiptCounts {
  denied: number;
  corrected: number;
  newSignatures: number;
  guardFires: number;
}

/**
 * Compute the four receipt counts from a single session's events.
 *
 * - denied: count guard_fired events (the schema does not have a settings-deny event type).
 * - corrected: substantive user prompts immediately preceded by tool_use or assistant_msg.
 * - newSignatures: distinct failure skeletons from non-protocol tool failures in this session.
 * - guardFires: total guard_fired events in this session.
 */
export function computeReceipt(events: ObserveEvent[]): SessionReceiptCounts {
  let guardFires = 0;
  let corrections = 0;
  const signatures = new Set<string>();

  let prevType: ObserveEvent["type"] | null = null;

  for (const e of events) {
    if (e.type === "guard_fired") {
      guardFires += 1;
    } else if (e.type === "user_prompt") {
      if (
        (prevType === "tool_use" || prevType === "assistant_msg") &&
        isSubstantiveCorrection(e.text)
      ) {
        corrections += 1;
      }
      prevType = "user_prompt";
    } else if (e.type === "tool_use") {
      if (e.ok === false) {
        const raw = e.error_summary ?? e.detail ?? `${e.tool} failed`;
        if (!isProtocolFailure(raw)) {
          const skel = failureSkeleton(raw);
          signatures.add(skel || `verbatim:${raw}`);
        }
      }
      prevType = "tool_use";
    } else if (
      e.type === "assistant_msg" ||
      e.type === "skill_load" ||
      e.type === "session_start"
    ) {
      prevType = e.type;
    }
  }

  return {
    denied: guardFires,
    corrected: corrections,
    newSignatures: signatures.size,
    guardFires,
  };
}

/**
 * Format the one-line session receipt. Returns null when all four counts are zero.
 */
export function formatReceipt(counts: SessionReceiptCounts): string | null {
  if (
    counts.denied === 0 &&
    counts.corrected === 0 &&
    counts.newSignatures === 0 &&
    counts.guardFires === 0
  ) {
    return null;
  }
  return `mage: ${counts.denied} denied · ${counts.corrected} corrected · ${counts.newSignatures} new signatures · ${counts.guardFires} guard fires`;
}

/**
 * Read the events for a single session from .mage/learnings.
 * Only returns events whose session field matches the requested sessionId.
 */
export async function readSessionEvents(
  learningsDir: string,
  sessionId: string,
): Promise<ObserveEvent[]> {
  if (!sessionId || sessionId.trim().length === 0) return [];
  const sid = sessionId.trim();
  const file = sessionFilePath(learningsDir, sid);

  let raw: string | null = await readFile(file, "utf8").catch(() => null);
  if (raw === null && file !== join(learningsDir, `${sid}.jsonl`)) {
    raw = await readFile(join(learningsDir, `${sid}.jsonl`), "utf8").catch(() => null);
  }

  if (raw !== null) {
    const events: ObserveEvent[] = [];
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (trimmed.length === 0) continue;
      try {
        const ev = JSON.parse(trimmed) as ObserveEvent;
        if (ev.session === sid) events.push(ev);
      } catch {
        // Skip torn or malformed lines
      }
    }
    return events;
  }

  const streams = await readSessionStreams(learningsDir).catch(() => []);
  return streams
    .filter((s) => s.session === sid)
    .flatMap((s) => s.events)
    .filter((e) => e.session === sid);
}

/**
 * Compute the Stop hook session receipt for the given docs root and session.
 * Fails open: returns notice: null if any read fails or all counts are zero.
 */
export async function sessionReceiptNudge(
  resolved: ResolvedDocsRoot,
  sessionId?: string,
): Promise<NudgeResult> {
  try {
    if (!sessionId || sessionId.trim().length === 0) {
      return { ran: true, drafted: 0, pending: 0, nudge: null, notice: null };
    }
    const dir = learningsPath(resolved.root);
    const events = await readSessionEvents(dir, sessionId.trim());
    const counts = computeReceipt(events);
    const notice = formatReceipt(counts);
    return { ran: true, drafted: 0, pending: 0, nudge: null, notice };
  } catch {
    return { ran: true, drafted: 0, pending: 0, nudge: null, notice: null };
  }
}
