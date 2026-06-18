import { readFile } from "node:fs/promises";
import { logger } from "../logger.js";
import { hasLiveSecret, redact, type SecretFinding, scanSecrets } from "../redact.js";
import { scanStaged, type StagedFinding } from "../staged-scan.js";

export interface RedactOptions {
  /** Print the redacted text to stdout instead of a findings report. */
  strip?: boolean;
  /** Suppress all logging (the report) — used by tests and pipelines. */
  quiet?: boolean;
  /**
   * Gate-2 mode (ADR-0018 §7): scan the STAGED git blobs in cwd instead of a
   * file/stdin. The blocking pre-commit gate `mage redact --check --staged`.
   */
  staged?: boolean;
  /**
   * Accepted intent flag for the pre-commit gate. The default report already
   * returns `blocked`, so `--check` needs no behavior of its own — it reads as
   * "exit non-zero on a live secret", which is already what `blocked` drives.
   */
  check?: boolean;
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
  // Gate-2 staged scan: an entirely different source (git index blobs in cwd),
  // not a file/stdin. It fails open inside scanStaged (never throws), so a
  // missing git / non-repo yields a clean, non-blocking result.
  if (opts.staged) {
    // A positional file with --staged is a mistake (e.g. `mage redact x.env --staged`):
    // the scan is of the git index, not that file. Warn so the user isn't misled into
    // thinking their file was scanned, rather than silently ignoring the argument.
    if (!opts.quiet && target !== undefined && target !== "-") {
      logger.warn(`--staged scans the git index, not '${target}' — the file argument is ignored.`);
    }
    const { findings, blocked } = await scanStaged(process.cwd());
    if (!opts.quiet) reportStaged(findings, blocked);
    return { findings, blocked };
  }

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

/**
 * Gate-2 report: like {@link report}, but each line is FILE-attributed
 * (`<file>:line <n> · <kind> · <preview>`) since a staged scan spans many files.
 * Same secret-vs-PII split and same blocking message. NEVER prints a raw secret —
 * the preview is already masked by scanSecrets(); we add only the file path.
 */
function reportStaged(findings: StagedFinding[], blocked: boolean): void {
  logger.info("mage redact --staged — Gate-2 scan of staged knowledge-base blobs (read-only)");
  logger.blank();
  if (findings.length === 0) {
    logger.success("No secrets or PII in staged changes.");
    return;
  }
  const secrets = findings.filter((f) => f.severity === "secret");
  const pii = findings.filter((f) => f.severity === "pii");
  if (secrets.length > 0) {
    logger.warn(`${secrets.length} likely secret(s) — these BLOCK the commit:`);
    for (const f of secrets) {
      logger.detail(`${f.file}:line ${f.line} · ${f.kind} · ${f.preview}`);
    }
    logger.blank();
  }
  if (pii.length > 0) {
    logger.warn(`${pii.length} PII match(es) — advisory, does not block:`);
    for (const f of pii) {
      logger.detail(`${f.file}:line ${f.line} · ${f.kind} · ${f.preview}`);
    }
    logger.blank();
  }
  if (blocked) {
    logger.error(
      "Live secret(s) staged — remove them, allow a confirmed false positive in mage/.redactignore, or `git commit --no-verify` to override.",
    );
  }
}
