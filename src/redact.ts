// Deterministic secret/PII scanner — no model, no network (ADR-0014 Gate 2's
// reusable scan half). Every regex is ReDoS-safe: bounded quantifiers, no nested
// quantifiers over overlapping classes, no catastrophic backtracking. Previews are
// always MASKED — a raw secret never leaves this module.

/** Where a secret/PII match was found, and a SAFE (masked) preview of it. */
export interface SecretFinding {
  /** Detector id, e.g. "aws-access-key", "generic-key-value", "email". */
  kind: string;
  /** 1-based line number of the match. */
  line: number;
  /** "secret" => credential/key (blocks); "pii" => identifier (warns). */
  severity: "secret" | "pii";
  /** A masked snippet for human triage — NEVER the raw secret value. */
  preview: string;
}

/** Minimum length for a standalone hex/base64 blob to be entropy-tested. */
const MIN_ENTROPY_LEN = 32;
/** Shannon-entropy floor (bits/char). Conservative — limits false positives. */
const MIN_ENTROPY_BITS = 3.5;
/** Common cryptographic digest lengths (md5 / sha1 / sha256) — hashes, not secrets. */
const HEX_DIGEST_LENS = new Set([32, 40, 64]);
/** A value that is already a redaction marker — skip it so redact() is idempotent. */
const REDACTION_MARKER = /^\[REDACTED:[A-Za-z0-9-]+\]$/;

/**
 * An `${ENV}` interpolation placeholder — `${VAR}`, `${env:VAR}`, `${varlock:VAR}`.
 * The VALUE is an environment reference resolved at runtime, never a literal
 * secret, so a `key: ${VAR}` assignment must not be flagged (0.0.12 FP fix).
 */
const ENV_PLACEHOLDER = /^\$\{[A-Za-z0-9_:.-]{1,200}\}$/;

/**
 * An angle-bracket documentation placeholder — `<token>`, `<your-token>`, `<PAT>`.
 * The VALUE is a `<...>`-wrapped stand-in a human is meant to replace, never a
 * literal secret, so `http://user:<token>@host` in a doc URL must not be flagged.
 * The inner class is deliberately CONSERVATIVE (letters, digits, `_ - : . space`)
 * and the whole value is anchored `^<...>$`; a real base64/hex token — never
 * `<...>`-wrapped — therefore can never be suppressed by this rule.
 */
const ANGLE_PLACEHOLDER = /^<[A-Za-z0-9_:.\- ]{1,200}>$/;

/**
 * A `<…>` value is only a safe documentation placeholder when its INNER content
 * is NOT secret-shaped. Real placeholders are short/word-like or carry a separator
 * (`<token>`, `<your-token>`, `<api_key>`, `<user:pass>`); a secret angle-wrapped by
 * an attacker (`<random-base64>`, `<0123…hex>`) must still be redacted — `suppressed()`
 * is shared by every detector, so dropping such a value in the url-credentials group
 * would leave a real secret in the clear. Gate on entropy + a long unbroken-alnum run
 * (the latter catches 32-hex, which `isHighEntropy` treats as a digest and passes).
 */
function isAnglePlaceholder(raw: string): boolean {
  if (!ANGLE_PLACEHOLDER.test(raw)) return false;
  const inner = raw.slice(1, -1); // drop the < >
  if (isHighEntropy(inner)) return false; // base64/random blob
  if (/^[A-Za-z0-9]{24,}$/.test(inner)) return false; // long separator-less alnum run
  return true;
}

/**
 * A matched value that must NOT be treated as a secret, regardless of which
 * detector fired: an already-redacted marker (keeps redact() idempotent), an
 * `${ENV}` placeholder, a `<…>` documentation placeholder (only when not
 * secret-shaped), or a caller-supplied allowlist literal (a confirmed false
 * positive from `metadata.redact.allow`). Applied uniformly across both scan passes.
 */
function suppressed(raw: string, allow?: ReadonlySet<string>): boolean {
  return (
    REDACTION_MARKER.test(raw) ||
    ENV_PLACEHOLDER.test(raw) ||
    isAnglePlaceholder(raw) ||
    (allow?.has(raw) ?? false)
  );
}

/**
 * A single deterministic detector. When `group` is set, that capture group holds
 * the secret VALUE (masked + redacted, and used for the offset); otherwise the
 * whole match is the value. Grouped detectors carry the `d` flag so the value's
 * offset comes from `match.indices` (robust — never `indexOf`).
 */
interface Detector {
  kind: string;
  severity: "secret" | "pii";
  /** Global regex. MUST be ReDoS-safe (bounded). `d` flag required when `group` is set. */
  re: RegExp;
  /** Capture group holding the VALUE; default = whole match. */
  group?: number;
  /** Optional extra gate (e.g. entropy) — return false to reject a candidate. */
  accept?: (raw: string) => boolean;
}

// ─── detector table (order = scan priority; specific before general) ──────────

const DETECTORS: readonly Detector[] = [
  {
    kind: "private-key",
    severity: "secret",
    re: /-----BEGIN [A-Z ]{0,40}PRIVATE KEY-----/g,
  },
  {
    // scheme://user:PASSWORD@host (DB/service connection strings). Claim the
    // password span before the email detector can mis-claim it as PII. The
    // password is greedy up to the LAST `@` before a host, so passwords that
    // themselves contain `@`, `/` or `:` (common in generated creds) are caught.
    kind: "url-credentials",
    severity: "secret",
    group: 1,
    re: /\b[a-z][a-z0-9+.-]{0,30}:\/\/[^/:@\s]{1,256}:([^\s]{6,400})@[^\s/@:]{1,256}/gid,
  },
  {
    kind: "aws-access-key",
    severity: "secret",
    re: /\bAKIA[0-9A-Z]{16}\b/g,
  },
  {
    kind: "aws-secret-key",
    severity: "secret",
    group: 1,
    re: /aws_secret(?:_access)?_key\s*[:=]\s*['"]?([A-Za-z0-9/+]{40})/gid,
  },
  {
    // Classic ghp_/gho_/gha_/ghs_/ghr_ tokens AND fine-grained github_pat_ tokens.
    kind: "github-token",
    severity: "secret",
    re: /\b(?:gh[poasr]_[A-Za-z0-9]{30,251}|github_pat_[A-Za-z0-9_]{20,251})\b/g,
  },
  {
    kind: "gitlab-token",
    severity: "secret",
    re: /\bglpat-[A-Za-z0-9_-]{20,255}\b/g,
  },
  {
    // Anthropic API keys: `sk-ant-<kind>-<base64url body>` (the kind is e.g.
    // `api03`/`admin01`). The body contains `-` and `_`, which the generic
    // high-entropy detector splits on — leaving the `sk-ant-…` prefix and the
    // first chunk un-redacted (a partial leak). A dedicated detector claims the
    // WHOLE key first (specific before the generic `sk-` + high-entropy ones), so
    // nothing leaks — the most relevant key type for a Claude-facing tool.
    kind: "anthropic-key",
    severity: "secret",
    re: /\bsk-ant-[a-z0-9]{2,20}-[A-Za-z0-9_-]{20,250}/g,
  },
  {
    // OpenAI keys: classic `sk-…` and scoped `sk-proj-…`/`sk-svcacct-…`/`sk-admin-…`.
    // Min 32-char body matches real key lengths and skips short fabricated examples
    // (e.g. `sk-xxxxxxxxxxxxxxxxxxxx`) that would otherwise false-block doc commits.
    kind: "openai-key",
    severity: "secret",
    re: /\bsk-(?:proj|svcacct|admin)?-?[A-Za-z0-9]{32,120}\b/g,
  },
  {
    kind: "slack-token",
    severity: "secret",
    re: /\bxox[baprs]-[A-Za-z0-9-]{10,250}\b/g,
  },
  {
    // Stripe secret + restricted keys (sk_live_/sk_test_/rk_live_/rk_test_).
    kind: "stripe-key",
    severity: "secret",
    re: /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{10,99}\b/g,
  },
  {
    kind: "google-api-key",
    severity: "secret",
    re: /\bAIza[0-9A-Za-z_-]{35}\b/g,
  },
  {
    kind: "npm-token",
    severity: "secret",
    re: /\bnpm_[A-Za-z0-9]{36}\b/g,
  },
  {
    kind: "jwt",
    severity: "secret",
    re: /\beyJ[A-Za-z0-9_-]{6,2000}\.eyJ[A-Za-z0-9_-]{6,2000}\.[A-Za-z0-9_-]{6,2000}\b/g,
  },
  {
    kind: "bearer",
    severity: "secret",
    group: 1,
    re: /Authorization:\s*Bearer\s+([A-Za-z0-9._~+/-]{8,500}=*)/gd,
  },
  {
    // KEY=VALUE / "key": "value" / key: value forms. Case-insensitive, and the
    // compound `*[_-]key`/`*[_-]secret`/`*[_-]token` alternatives catch camelCase
    // (AccountKey, apiKey) and vendor names (account-key, shared-access-key). An
    // optional closing quote before the separator handles JSON (`"password":`).
    kind: "generic-key-value",
    severity: "secret",
    group: 1,
    re: /(?:access[_-]?key|secret[_-]?key|private[_-]?key|account[_-]?key|shared[_-]?access[_-]?key|client[_-]?secret|api[_-]?key|auth[_-]?token|access[_-]?token|refresh[_-]?token|api[_-]?token|apikey|apisecret|passphrase|password|passwd|credentials?|secret|token)\s*["']?\s*[:=]\s*['"]?([^\s'";]{8,500})/gid,
  },
  {
    // SCREAMING_SNAKE env names ending in a sensitive suffix: OPENAI_KEY=,
    // STRIPE_SECRET_KEY=, DATABASE_PASSWORD=. The leading `_` before the suffix
    // excludes innocent words (e.g. MONKEY=).
    kind: "env-secret",
    severity: "secret",
    group: 2,
    re: /(?:^|[^A-Za-z0-9_])([A-Z][A-Z0-9_]{0,60}_(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIALS?))\s*[:=]\s*['"]?([^\s'";]{8,500})/gd,
  },
  {
    // Standalone high-entropy hex/base64 blob. Lookarounds (not `\b`) so a value
    // adjacent to base64 chars (`/`, `+`, `=`) is captured maximally.
    kind: "high-entropy",
    severity: "secret",
    re: /(?<![A-Za-z0-9/+=])[A-Za-z0-9/+]{32,512}={0,2}(?![A-Za-z0-9/+=])/g,
    accept: (raw) => isHighEntropy(raw),
  },
  {
    kind: "email",
    severity: "pii",
    re: /\b[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,255}\.[A-Za-z]{2,24}\b/g,
  },
];

// ─── public API ──────────────────────────────────────────────────────────────

/**
 * Scan `text` for secrets and PII deterministically. Returns one finding per
 * match (earlier-listed detectors win an overlapping span, so a tokenized JWT or
 * AWS key is not double-reported as high-entropy). Already-redacted markers are
 * skipped, so re-scanning redacted output yields no secrets. Findings sort by line.
 */
export function scanSecrets(text: string, allow?: ReadonlySet<string>): SecretFinding[] {
  const lineStarts = computeLineStarts(text);
  const claimed: Array<[number, number]> = [];
  const findings: SecretFinding[] = [];

  for (const d of DETECTORS) {
    d.re.lastIndex = 0;
    let m: RegExpExecArray | null = d.re.exec(text);
    while (m !== null) {
      const matchStart = m.index;
      const matchEnd = matchStart + m[0].length;
      const { raw } = valueSpan(d, m);
      if ((!d.accept || d.accept(raw)) && !overlaps(claimed, matchStart, matchEnd)) {
        // Claim the span even when the value is suppressed, so a more-general
        // detector can't re-match a sub-run of an allowlisted/placeholder value
        // (e.g. the high-entropy tail of an allowlisted `sk-ant-…` token).
        claimed.push([matchStart, matchEnd]);
        if (!suppressed(raw, allow)) {
          findings.push({
            kind: d.kind,
            line: lineOf(lineStarts, matchStart),
            severity: d.severity,
            preview: mask(raw),
          });
        }
      }
      // Guard against a zero-width match looping forever.
      if (m.index === d.re.lastIndex) d.re.lastIndex += 1;
      m = d.re.exec(text);
    }
  }

  return findings.sort((a, b) => a.line - b.line || a.kind.localeCompare(b.kind));
}

/**
 * Redact every secret VALUE in `text` with `[REDACTED:<kind>]`, preserving any
 * surrounding key name (e.g. `api_key=[REDACTED:generic-key-value]`). Emails
 * become `[REDACTED:email]`. Replacement is right-to-left so earlier offsets stay
 * valid. Idempotent — redacting already-redacted text is a no-op (the marker is
 * skipped). Returns the redacted text plus the findings that drove it.
 */
export function redact(
  text: string,
  allow?: ReadonlySet<string>,
): {
  text: string;
  findings: SecretFinding[];
} {
  const findings = scanSecrets(text, allow);
  const spans = collectSpans(text, allow);
  let out = text;
  for (const s of spans) {
    out = `${out.slice(0, s.start)}[REDACTED:${s.kind}]${out.slice(s.end)}`;
  }
  return { text: out, findings };
}

/** True if any finding is a credential/key (severity "secret") — Gate 2 blocks. */
export function hasLiveSecret(findings: SecretFinding[]): boolean {
  return findings.some((f) => f.severity === "secret");
}

// ─── span collection for redact() ────────────────────────────────────────────

interface Span {
  start: number;
  end: number;
  kind: string;
}

/** Spans of just the VALUE to replace, deduped by priority, sorted right-to-left. */
function collectSpans(text: string, allow?: ReadonlySet<string>): Span[] {
  const claimed: Array<[number, number]> = [];
  const spans: Span[] = [];
  for (const d of DETECTORS) {
    d.re.lastIndex = 0;
    let m: RegExpExecArray | null = d.re.exec(text);
    while (m !== null) {
      const matchStart = m.index;
      const matchEnd = matchStart + m[0].length;
      const v = valueSpan(d, m);
      if ((!d.accept || d.accept(v.raw)) && !overlaps(claimed, matchStart, matchEnd)) {
        // Claim the span even when suppressed (see scanSecrets) so nothing downstream
        // re-matches a sub-run of an allowlisted/placeholder value.
        claimed.push([matchStart, matchEnd]);
        if (!suppressed(v.raw, allow)) {
          spans.push({ start: v.start, end: v.end, kind: d.kind });
        }
      }
      if (m.index === d.re.lastIndex) d.re.lastIndex += 1;
      m = d.re.exec(text);
    }
  }
  return spans.sort((a, b) => b.start - a.start);
}

// ─── helpers ─────────────────────────────────────────────────────────────────

/**
 * Locate the VALUE to mask/redact within a match. For a grouped detector the
 * offset comes from `match.indices` (the `d` flag); a missing-group match falls
 * back to the whole match so detectors never crash on optional groups.
 */
function valueSpan(
  d: Detector,
  m: RegExpExecArray,
): { start: number; end: number; raw: string } {
  if (d.group !== undefined && m[d.group] !== undefined) {
    const raw = m[d.group] as string;
    const idx = m.indices?.[d.group];
    if (idx) return { start: idx[0], end: idx[1], raw };
    const rel = m[0].indexOf(raw);
    const start = m.index + (rel >= 0 ? rel : 0);
    return { start, end: start + raw.length, raw };
  }
  return { start: m.index, end: m.index + m[0].length, raw: m[0] };
}

/** Mask a raw value: keep at most the first/last 2 chars, star the middle. */
function mask(raw: string): string {
  if (raw.length <= 4) return "*".repeat(raw.length);
  const head = raw.slice(0, 2);
  const tail = raw.slice(-2);
  return `${head}${"*".repeat(Math.min(raw.length - 4, 8))}${tail}`;
}

/** Shannon entropy in bits/char, with length, digest, distinctness and class guards. */
function isHighEntropy(raw: string): boolean {
  if (raw.length < MIN_ENTROPY_LEN) return false;
  // Pure hex digests of common lengths (md5/sha1/sha256) are hashes, not secrets.
  if (HEX_DIGEST_LENS.has(raw.length) && /^[0-9a-f]+$/.test(raw)) return false;
  // UUIDs and dashed ids are structured, not secret — reject anything with a dash.
  if (raw.includes("-")) return false;
  // Path-like runs (slash-joined segments) are file paths, not credentials: mage's
  // own generated index/skill paths and paths cited in prose trip the entropy bar
  // (the high-entropy class includes '/'). A genuine base64 blob that uses '/' also
  // carries '+'/'=' (alphabet + padding) — reject only padding-free, path-shaped runs.
  if (raw.includes("/") && !/[+=]/.test(raw)) return false;
  // Require a mix: a pure run of one class (e.g. all 'a') is low information.
  if (new Set(raw).size < 12) return false;
  // A long all-lowercase-letter run is far more likely a word than a credential.
  // Real keys/tokens mix character classes — demand digits, or upper+lower mixed.
  if (!hasClassDiversity(raw)) return false;
  return shannonEntropy(raw) >= MIN_ENTROPY_BITS;
}

/** A credential-shaped blob mixes classes: has a digit, or both upper and lower. */
function hasClassDiversity(raw: string): boolean {
  const hasDigit = /[0-9]/.test(raw);
  const hasUpper = /[A-Z]/.test(raw);
  const hasLower = /[a-z]/.test(raw);
  return hasDigit || (hasUpper && hasLower);
}

/** Shannon entropy (bits per char) of a string. */
function shannonEntropy(s: string): number {
  const freq = new Map<string, number>();
  for (const ch of s) freq.set(ch, (freq.get(ch) ?? 0) + 1);
  let bits = 0;
  for (const count of freq.values()) {
    const p = count / s.length;
    bits -= p * Math.log2(p);
  }
  return bits;
}

/** Whether [start,end) overlaps any already-claimed span. */
function overlaps(
  claimed: ReadonlyArray<[number, number]>,
  start: number,
  end: number,
): boolean {
  return claimed.some(([s, e]) => start < e && end > s);
}

/** Byte/char offsets at which each line begins (index 0 => line 1). */
function computeLineStarts(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\n") starts.push(i + 1);
  }
  return starts;
}

/** 1-based line number for a char offset via binary search over line starts. */
function lineOf(lineStarts: ReadonlyArray<number>, offset: number): number {
  let lo = 0;
  let hi = lineStarts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    const start = lineStarts[mid];
    if (start !== undefined && start <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
}
