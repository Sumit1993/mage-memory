import { readFile } from "node:fs/promises";
import { logger } from "../logger.js";
import { hasLiveSecret, redact, type SecretFinding, scanSecrets } from "../redact.js";

export interface RedactOptions {
  /** Print the redacted text to stdout instead of a findings report. */
  strip?: boolean;
  /** Suppress all logging (the report) — used by tests and pipelines. */
  quiet?: boolean;
}

export interface RedactResult {
  /** Every secret/PII finding (PII included; only secrets block). */
  findings: SecretFinding[];
  /** True when a live secret was found — the caller should exit non-zero. */
  blocked: boolean;
}

/**
 * Scan (or strip) a file or stdin for secrets/PII — the CLI face of ADR-0014's
 * deterministic gate. Default mode reports findings (kind + line only, NEVER the
 * raw secret); `--strip` writes the redacted text to stdout. PII alone warns but
 * never blocks. `findings` and `blocked` derive from a SINGLE scan so they can
 * never disagree. Returns `{ findings, blocked }` so the CLI can `exit(2)` on a
 * live secret.
 */
export async function redactCmd(
  target: string | undefined,
  opts: RedactOptions,
): Promise<RedactResult> {
  const input = await readInput(target);
  const findings = scanSecrets(input);
  const blocked = hasLiveSecret(findings);

  if (opts.strip) {
    const text = redact(input).text;
    process.stdout.write(text.endsWith("\n") ? text : `${text}\n`);
    return { findings, blocked };
  }

  if (!opts.quiet) report(findings, blocked);
  return { findings, blocked };
}

// ─── input ───────────────────────────────────────────────────────────────────

/** Read from file `target`, or stdin when `target` is undefined or "-". */
async function readInput(target: string | undefined): Promise<string> {
  if (target === undefined || target === "-") return readStdin();
  try {
    return await readFile(target, "utf8");
  } catch (err) {
    throw new Error(`Cannot read '${target}': ${toError(err).message}`);
  }
}

/** Drain stdin to a string (UTF-8). Resolves "" on an empty/closed stream. */
function readStdin(): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
    process.stdin.on("data", (c: Buffer) => chunks.push(c));
    process.stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    process.stdin.on("error", (err: unknown) => reject(toError(err)));
  });
}

function toError(err: unknown): Error {
  return err instanceof Error ? err : new Error(String(err));
}

// ─── report (NEVER prints raw secrets) ───────────────────────────────────────

/** Log findings as kind + line + masked preview; secrets are flagged as blocking. */
function report(findings: SecretFinding[], blocked: boolean): void {
  logger.info("mage redact — deterministic secret/PII scan (read-only)");
  logger.blank();
  if (findings.length === 0) {
    logger.success("No secrets or PII detected.");
    return;
  }
  const secrets = findings.filter((f) => f.severity === "secret");
  const pii = findings.filter((f) => f.severity === "pii");
  if (secrets.length > 0) {
    logger.warn(`${secrets.length} likely secret(s) — these BLOCK promotion:`);
    for (const f of secrets) logger.detail(`line ${f.line} · ${f.kind} · ${f.preview}`);
    logger.blank();
  }
  if (pii.length > 0) {
    logger.warn(`${pii.length} PII match(es) — advisory, does not block:`);
    for (const f of pii) logger.detail(`line ${f.line} · ${f.kind} · ${f.preview}`);
    logger.blank();
  }
  if (blocked) {
    logger.error(
      "Live secret(s) found — remove them or confirm a false positive before committing.",
    );
  }
}
