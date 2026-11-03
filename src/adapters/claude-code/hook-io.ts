// Hook stdin and narrowing helpers shared by the Claude Code hook commands. No commander
// import: recall-hook runs on a latency-critical path (#282).

export function obj(v: unknown): Record<string, unknown> | undefined {
  return v !== null && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : undefined;
}

export function str(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

/** Drain stdin to a UTF-8 string; resolves "" on empty/closed/errored streams. */
export function readStdinSafe(): Promise<string> {
  return new Promise<string>((resolve) => {
    const chunks: Buffer[] = [];
    process.stdin.on("data", (c: Buffer) => chunks.push(c));
    process.stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    process.stdin.on("error", () => resolve(""));
  });
}

/** Parse stdin → a plain object, or null for invalid/array/primitive/null JSON. */
export function parseHookPayload(raw: string): Record<string, unknown> | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  return obj(parsed) ?? null;
}
