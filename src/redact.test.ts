import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { redactCmd } from "./commands/redact.js";
import {
  hasLiveSecret,
  redact,
  type SecretFinding,
  scanSecrets,
} from "./redact.js";
import { tmpDir } from "../test/fixtures/kb.js";

/**
 * Assemble a provider-token fixture from parts so the committed source contains no
 * contiguous provider pattern (Slack/Stripe). This keeps GitHub push-protection from
 * blocking the detector's OWN test data; the runtime value is identical — the
 * scanner still sees the full `xoxb-…` / `sk_live_…` token.
 */
const tok = (...parts: string[]): string => parts.join("");

// ─── synthetic, NON-LIVE fixtures ────────────────────────────────────────────
// Every value below is a pattern-SHAPED fake (right prefix/charset/length) built
// to exercise the deterministic, hardened detector — none is a live credential.
// The scanner masks previews, so a raw value never round-trips out of the module.

/** Standalone fixtures: one per detector kind, plus the expected detector id. */
const POSITIVES: ReadonlyArray<{ kind: string; text: string }> = [
  {
    kind: "private-key",
    text:
      "-----BEGIN RSA PRIVATE KEY-----\nMIIabc...\n-----END RSA PRIVATE KEY-----",
  },
  {
    // scheme://user:PASSWORD@host — the password span is claimed as a secret.
    kind: "url-credentials",
    text: "DB: postgres://appuser:s3cretPass99@db.example.com:5432/app",
  },
  { kind: "aws-access-key", text: "AKIAIOSFODNN7EXAMPLE" },
  {
    kind: "aws-secret-key",
    text:
      "aws_secret_access_key=abcdefghijklmnopqrstuvwxyz0123456789ABCD",
  },
  {
    // Classic ghp_ token (36 body chars after the prefix).
    kind: "github-token",
    text: "ghp_0123456789abcdefghijklmnopqrstuvwxyzABCD",
  },
  {
    // Fine-grained github_pat_ token.
    kind: "github-token",
    text: "github_pat_11ABCDE0000aaaaBBBBcc_0123456789abcdefghijABCDEFGH",
  },
  {
    // Anthropic key: sk-ant-<kind>-<body with - and _>. Whole key must redact,
    // not just the high-entropy tail (regression guard for the prefix leak).
    kind: "anthropic-key",
    text: "sk-ant-api03-a8Kd2Bf9xQ7zR1mN4pL6vW3cY5tH0jG-_uE8sA2dF1bC9nM7kP3qX6wZ4yT5rV0oI2eU4hB1lJ_QQAA",
  },
  {
    kind: "slack-token",
    text: tok("xox", "b-0000000000-0000000000-abcdefghijklmnopqrstuvwx"),
  },
  { kind: "stripe-key", text: tok("sk_", "live_0123456789abcdefABCDEFGH") },
  { kind: "stripe-key", text: tok("rk_", "test_0123456789abcdefABCDEFGH") },
  { kind: "google-api-key", text: "AIzaSyA0123456789abcdefghijklmnopqrstuv" },
  { kind: "npm-token", text: "npm_0123456789abcdefghijklmnopqrstuvwxyz" },
  {
    kind: "jwt",
    text:
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N",
  },
  {
    kind: "bearer",
    text: "Authorization: Bearer abc123def456ghi789jkl012mno345",
  },
  { kind: "generic-key-value", text: "api_key='s3cr3tValue123'" },
  {
    // SCREAMING_SNAKE env name with a sensitive suffix (single-token name).
    kind: "env-secret",
    text: "OPENAI_KEY=sk012345abcdefXYZ9876",
  },
  {
    // A MIXED-CASE + digit, base64-ish blob of length 44 that is NOT pure hex.
    kind: "high-entropy",
    text: "Zm9vYmFyQmF6MTIzNDU2Nzg5MEFiQ2RFZkdoSWpLbE1u",
  },
  { kind: "email", text: "alice.dev@example.com" },
];

/** Raw secret substrings that must never appear in any preview or redacted output. */
const RAW_SECRETS: ReadonlyArray<string> = [
  "s3cretPass99",
  "AKIAIOSFODNN7EXAMPLE",
  "abcdefghijklmnopqrstuvwxyz0123456789ABCD",
  "ghp_0123456789abcdefghijklmnopqrstuvwxyzABCD",
  "github_pat_11ABCDE0000aaaaBBBBcc_0123456789abcdefghijABCDEFGH",
  "sk-ant-api03-a8Kd2Bf9xQ7zR1mN4pL6vW3cY5tH0jG-_uE8sA2dF1bC9nM7kP3qX6wZ4yT5rV0oI2eU4hB1lJ_QQAA",
  tok("xox", "b-0000000000-0000000000-abcdefghijklmnopqrstuvwx"),
  tok("sk_", "live_0123456789abcdefABCDEFGH"),
  "AIzaSyA0123456789abcdefghijklmnopqrstuv",
  "npm_0123456789abcdefghijklmnopqrstuvwxyz",
  "abc123def456ghi789jkl012mno345",
  "s3cr3tValue123",
  "sk012345abcdefXYZ9876",
  "Zm9vYmFyQmF6MTIzNDU2Nzg5MEFiQ2RFZkdoSWpLbE1u",
];

function kindsOf(findings: ReadonlyArray<SecretFinding>): string[] {
  return findings.map((f) => f.kind);
}

// ─── positive detection, one it() per detector kind ──────────────────────────

describe("scanSecrets — one positive per detector kind (real-shaped fakes)", () => {
  for (const { kind, text } of POSITIVES) {
    it(`detects ${kind}: ${text.slice(0, 24).replace(/\n/g, " ")}…`, () => {
      const findings = scanSecrets(text);
      expect(kindsOf(findings)).toContain(kind);
    });
  }

  it("classifies every secret detector as severity 'secret'", () => {
    for (const { kind, text } of POSITIVES) {
      if (kind === "email") continue;
      const f = scanSecrets(text).find((x) => x.kind === kind);
      expect(f?.severity).toBe("secret");
    }
  });

  it("classifies email as severity 'pii'", () => {
    const f = scanSecrets("alice.dev@example.com").find((x) => x.kind === "email");
    expect(f?.severity).toBe("pii");
  });
});

// ─── env-secret family + a documented detector gap ───────────────────────────

describe("redact — Anthropic keys (regression: no prefix leak)", () => {
  it("redacts the WHOLE sk-ant- key including the sk-ant-api03- prefix", () => {
    const key =
      "sk-ant-api03-a8Kd2Bf9xQ7zR1mN4pL6vW3cY5tH0jG-_uE8sA2dF1bC9nM7kP3qX6wZ4yT5rV0oI2eU4hB1lJ_QQAA";
    const { text } = redact(`my token is ${key} ok`);
    expect(text).toContain("[REDACTED:anthropic-key]");
    expect(text).not.toContain("sk-ant-api03-");
    expect(text).not.toContain(key.slice(0, 40));
  });
});

describe("scanSecrets — env-style assignments", () => {
  it("flags OPENAI_KEY= as env-secret", () => {
    expect(kindsOf(scanSecrets("OPENAI_KEY=sk012345abcdefXYZ9876"))).toContain(
      "env-secret",
    );
  });

  it("flags DATABASE_PASSWORD= as a live secret (via the generic keyword)", () => {
    // The generic 'password' keyword runs before env-secret and claims the span,
    // so the kind is generic-key-value — but it is still severity 'secret'.
    const findings = scanSecrets("DATABASE_PASSWORD=hunter2hunter2hunter2");
    expect(hasLiveSecret(findings)).toBe(true);
    expect(kindsOf(findings)).toContain("generic-key-value");
  });

  it("flags multi-underscore *_SECRET_KEY= env assignments as a live secret", () => {
    // Regression: the security re-review found STRIPE_SECRET_KEY=/PAYMENT_GATEWAY_KEY=
    // (a SCREAMING name with extra underscore-separated words before the suffix)
    // slipping through. The broadened generic-key-value/env-secret detectors now catch it.
    for (const input of [
      "STRIPE_SECRET_KEY=abc123def456ghi789",
      "PAYMENT_GATEWAY_KEY=zzz999yyy888www777",
    ]) {
      expect(hasLiveSecret(scanSecrets(input))).toBe(true);
    }
  });

  it("flags compound-name secrets: Azure AccountKey, URL pw with @, gitlab, openai, json", () => {
    const inputs = [
      "AccountKey=dGVzdEtleVRlc3RLZXlUZXN0S2V5VGVzdEtleVRlc3RLZXk=",
      "mysql://root:MyP@ssw0rd99@db.internal:3306/prod",
      "glpat-xxxxxxxxxxxxxxxxxxxx",
      "sk-proj-abcdef0123456789abcdef0123456789ABCDEF",
      '"password": "hunter2AbCdEfGh1234"',
    ];
    for (const input of inputs) {
      expect(hasLiveSecret(scanSecrets(input))).toBe(true);
    }
  });
});

// ─── hasLiveSecret ────────────────────────────────────────────────────────────

describe("hasLiveSecret — true iff a secret is present", () => {
  it("is true when a secret finding exists", () => {
    expect(hasLiveSecret(scanSecrets("AKIAIOSFODNN7EXAMPLE"))).toBe(true);
  });

  it("is false for pii-only (email) findings", () => {
    const findings = scanSecrets("alice.dev@example.com");
    expect(findings.length).toBeGreaterThan(0);
    expect(hasLiveSecret(findings)).toBe(false);
  });

  it("is false for no findings", () => {
    expect(hasLiveSecret([])).toBe(false);
  });
});

// ─── previews never leak the raw secret ──────────────────────────────────────

describe("scanSecrets — previews are always masked", () => {
  for (const { kind, text } of POSITIVES) {
    it(`masks the raw value in the ${kind} preview`, () => {
      const findings = scanSecrets(text);
      for (const f of findings) {
        for (const raw of RAW_SECRETS) {
          expect(f.preview).not.toContain(raw);
        }
      }
    });
  }
});

// ─── false-positive guards: these must NOT be flagged as secrets ──────────────

describe("scanSecrets — false-positive guards", () => {
  it("ignores plain English prose", () => {
    const text =
      "The quick brown fox jumps over the lazy dog near the river bank.";
    expect(scanSecrets(text)).toEqual([]);
  });

  it("does not flag a UUID as high-entropy (it is dashed/structured)", () => {
    const findings = scanSecrets("id: 550e8400-e29b-41d4-a716-446655440000");
    expect(kindsOf(findings)).not.toContain("high-entropy");
    expect(hasLiveSecret(findings)).toBe(false);
  });

  it("does not flag a non-sensitive SCREAMING var (MONKEY_HOUSE=banana)", () => {
    const findings = scanSecrets("MONKEY_HOUSE=banana");
    expect(kindsOf(findings)).not.toContain("env-secret");
    expect(findings).toEqual([]);
  });

  it("does not flag a 32-char md5 hex digest as high-entropy", () => {
    const findings = scanSecrets("d41d8cd98f00b204e9800998ecf8427e");
    expect(kindsOf(findings)).not.toContain("high-entropy");
    expect(findings).toEqual([]);
  });

  it("does not flag a 40-char sha1 hex digest as high-entropy", () => {
    const findings = scanSecrets("da39a3ee5e6b4b0d3255bfef95601890afd80709");
    expect(kindsOf(findings)).not.toContain("high-entropy");
    expect(findings).toEqual([]);
  });

  it("does not flag a 64-char sha256 hex digest as high-entropy", () => {
    const text =
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
    const findings = scanSecrets(text);
    expect(kindsOf(findings)).not.toContain("high-entropy");
    expect(findings).toEqual([]);
  });
});

// ─── 0.0.12 false-positive fixes: env placeholders, paths, allowlist ──────────

describe("scanSecrets — env placeholders are references, not secrets (0.0.12)", () => {
  for (const input of [
    "github_token: ${GITHUB_TOKEN}",
    "api_key=${env:OPENAI_API_KEY}",
    'password: "${varlock:DB_PASSWORD}"',
    "access_token = ${TOKEN}",
  ]) {
    it(`does not flag a placeholder value: ${input}`, () => {
      expect(hasLiveSecret(scanSecrets(input))).toBe(false);
    });
  }

  it("still flags a real LITERAL value in the same key=value shape", () => {
    // Guard against over-suppression: only the env reference is whitelisted.
    expect(hasLiveSecret(scanSecrets("api_key='s3cr3tValue123'"))).toBe(true);
  });

  it("does NOT suppress a PARTIAL placeholder (anchoring guards against bypass)", () => {
    // A value that merely starts with a placeholder is not a pure env reference — a
    // real secret appended to one must still be flagged (the ^...$ anchor matters).
    expect(hasLiveSecret(scanSecrets("api_key=${VAR}realSecretAppended99"))).toBe(true);
  });

  it("redact() leaves a placeholder assignment byte-for-byte untouched", () => {
    const clean = "github_token: ${GITHUB_TOKEN}";
    expect(redact(clean).text).toBe(clean);
  });
});

describe("scanSecrets — path-like runs are not high-entropy secrets (0.0.12)", () => {
  // The exact false positives from the 2026-06-14 hub commit (issue doc): the
  // high-entropy class includes '/', so slash-joined file paths trip the bar.
  for (const input of [
    "see projects/prismalens-platform/notes/integrations/README for the layout",
    "stack: GitHub/Vercel/Render/Prometheus/Slack and a few others",
  ]) {
    it(`does not flag a slash-joined path: ${input.slice(0, 32)}…`, () => {
      const findings = scanSecrets(input);
      expect(kindsOf(findings)).not.toContain("high-entropy");
      expect(hasLiveSecret(findings)).toBe(false);
    });
  }

  it("STILL flags a genuine base64 blob carrying +/= padding (no over-suppression)", () => {
    // A real-shaped base64 secret that happens to contain '/' must remain detected —
    // padding ('=') / the '+' alphabet distinguishes it from a path.
    const blob = "ab/cdEFghIJklMNopQRstUVwxYZ0123456789ab/cd==";
    expect(kindsOf(scanSecrets(blob))).toContain("high-entropy");
  });
});

describe("scanSecrets / redact — literal allowlist suppresses a confirmed FP (0.0.12)", () => {
  const fp = "Zm9vYmFyQmF6MTIzNDU2Nzg5MEFiQ2RFZkdoSWpLbE1u"; // a high-entropy blob

  it("flags the value without an allowlist", () => {
    expect(hasLiveSecret(scanSecrets(`blob ${fp} end`))).toBe(true);
  });

  it("suppresses the finding when the value is allowlisted (exact match)", () => {
    const allow = new Set([fp]);
    expect(scanSecrets(`blob ${fp} end`, allow)).toEqual([]);
  });

  it("redact() does not rewrite an allowlisted value", () => {
    const text = `blob ${fp} end`;
    expect(redact(text, new Set([fp])).text).toBe(text);
  });

  it("redacts two real secrets while leaving an allowlisted value BETWEEN them untouched", () => {
    // Regression for the claim-before-suppress span logic + right-to-left replace: a
    // suppressed span sandwiched between two real secrets must neither shift offsets
    // nor shield the second secret.
    const allow = new Set([fp]);
    const text = `api_key='realSecretOne99' ${fp} secret_key='realSecretTwo88'`;
    const { text: out } = redact(text, allow);
    expect(out).toContain(fp); // the allowlisted blob is untouched
    expect(out).not.toContain("realSecretOne99");
    expect(out).not.toContain("realSecretTwo88");
    expect((out.match(/\[REDACTED:/g) ?? []).length).toBe(2);
  });
});

// ─── redact: value replacement, severity, line numbers ───────────────────────

describe("redact — value replacement keeps the surrounding context", () => {
  it("replaces a generic key value, preserving the key name", () => {
    const { text, findings } = redact("api_key='s3cr3tValue123'");
    expect(text).toBe("api_key='[REDACTED:generic-key-value]'");
    expect(text).not.toContain("s3cr3tValue123");
    expect(findings.length).toBeGreaterThan(0);
  });

  it("replaces an email with [REDACTED:email]", () => {
    const { text } = redact("contact alice.dev@example.com please");
    expect(text).toBe("contact [REDACTED:email] please");
  });

  it("leaves clean text byte-for-byte untouched", () => {
    const clean = "just some ordinary prose with no secrets at all";
    const { text, findings } = redact(clean);
    expect(text).toBe(clean);
    expect(findings).toEqual([]);
  });

  it("redacts multiple findings in a single pass", () => {
    const { text } = redact(
      "api_key='longsecretvalue99' and email bob@example.com",
    );
    expect(text).toContain("[REDACTED:generic-key-value]");
    expect(text).toContain("[REDACTED:email]");
    expect(text).not.toContain("longsecretvalue99");
    expect(text).not.toContain("bob@example.com");
  });

  it("reports a 1-based line number for a finding", () => {
    const findings = scanSecrets("line one\nline two\napi_key='supersecret99'\n");
    const f = findings.find((x) => x.kind === "generic-key-value");
    expect(f?.line).toBe(3);
  });
});

// ─── idempotency: redaction is stable and self-cleaning ──────────────────────

describe("redact — idempotency on secret-bearing input", () => {
  const SECRET_INPUTS: ReadonlyArray<string> = [
    "api_key='s3cr3tValue123'",
    "key AKIAIOSFODNN7EXAMPLE here",
    "token=ghp_0123456789abcdefghijklmnopqrstuvwxyzABCD",
    "DB: postgres://appuser:s3cretPass99@db.example.com/app",
    "blob Zm9vYmFyQmF6MTIzNDU2Nzg5MEFiQ2RFZkdoSWpLbE1u end",
    "Authorization: Bearer abc123def456ghi789jkl012mno345",
    "reach me at carol@example.com and OPENAI_KEY=sk012345abcdefXYZ9876",
  ];

  for (const input of SECRET_INPUTS) {
    it(`re-scanning redacted output finds no live secret: ${input.slice(0, 28)}…`, () => {
      const once = redact(input);
      expect(hasLiveSecret(scanSecrets(once.text))).toBe(false);
    });

    it(`double-redaction is a fixed point: ${input.slice(0, 28)}…`, () => {
      const once = redact(input).text;
      expect(redact(once).text).toBe(once);
    });

    it(`redacted output never contains a raw secret substring: ${input.slice(0, 28)}…`, () => {
      const { text } = redact(input);
      for (const raw of RAW_SECRETS) {
        expect(text).not.toContain(raw);
      }
    });
  }
});

// ─── robustness regressions ──────────────────────────────────────────────────

describe("scanSecrets / redact — robustness regressions", () => {
  it("redacts a secret on an emoji-prefixed line without leaking the raw value", () => {
    const input = "🔑 api_key='emojivalue1234'";
    const { text } = redact(input);
    expect(text).toContain("[REDACTED:generic-key-value]");
    expect(text).not.toContain("emojivalue1234");
    expect(text.startsWith("🔑 ")).toBe(true);
  });

  it("reports the correct 1-based line for a CRLF-delimited input", () => {
    const crlf = "line1\r\nline2\r\napi_key='crlfsecret123'\r\n";
    const f = scanSecrets(crlf).find((x) => x.kind === "generic-key-value");
    expect(f?.line).toBe(3);
  });

  it("returns [] for scanSecrets('')", () => {
    expect(scanSecrets("")).toEqual([]);
  });

  it("returns {text:'',findings:[]} for redact('')", () => {
    expect(redact("")).toEqual({ text: "", findings: [] });
  });
});

// ─── ReDoS: adversarial input must scan well under a second ───────────────────

describe("scanSecrets — ReDoS resistance", () => {
  it("scans a 20KB pathological input in well under 1s", () => {
    // Mixed adversarial payloads aimed at the longest/greediest detectors:
    // a base64-ish run with no terminator, a never-closed bearer header, and a
    // long single-class run that flirts with the entropy/blob detector.
    const payloads = [
      "A1/+".repeat(5000), // 20000 base64 chars, no boundary
      `Authorization: Bearer ${"x".repeat(20000)}`,
      "a".repeat(20000),
      `aws_secret_access_key=${"Z".repeat(20000)}`,
    ];
    for (const payload of payloads) {
      const start = performance.now();
      scanSecrets(payload);
      const elapsedMs = performance.now() - start;
      expect(elapsedMs).toBeLessThan(1000);
    }
  });
});

// ─── redactCmd integration (temp dirs, mirrors scan.test.ts) ──────────────────

describe("redactCmd — temp-file integration", () => {
  async function tmpFile(content: string): Promise<string> {
    const dir = await tmpDir("mage-redact-");
    const p = join(dir, "input.txt");
    await writeFile(p, content);
    return p;
  }

  it("blocks on a live secret in a file", async () => {
    const p = await tmpFile(
      "token='ghp_0123456789abcdefghijklmnopqrstuvwxyzABCD'\n",
    );
    const res = await redactCmd(p, { quiet: true });
    expect(res.blocked).toBe(true);
    expect(res.findings.length).toBeGreaterThan(0);
  });

  it("does not block on pii alone", async () => {
    const p = await tmpFile("reach me at carol@example.com\n");
    const res = await redactCmd(p, { quiet: true });
    expect(res.blocked).toBe(false);
    expect(res.findings.some((f) => f.kind === "email")).toBe(true);
  });

  it("does not block a clean file", async () => {
    const p = await tmpFile("nothing sensitive here\n");
    const res = await redactCmd(p, { quiet: true });
    expect(res.blocked).toBe(false);
    expect(res.findings).toEqual([]);
  });

  it("--strip writes redacted text to stdout, never the raw secret", async () => {
    const p = await tmpFile("api_key='longsecretvalue99'\n");
    const out: string[] = [];
    const spy = vi.spyOn(process.stdout, "write").mockImplementation((c) => {
      out.push(String(c));
      return true;
    });
    const res = await redactCmd(p, { strip: true });
    spy.mockRestore();
    const written = out.join("");
    expect(written).toContain("[REDACTED:generic-key-value]");
    expect(written).not.toContain("longsecretvalue99");
    expect(res.blocked).toBe(true);
  });
});

describe("redactCmd — report mode (non-quiet)", () => {
  const logs: string[] = [];
  const errs: string[] = [];
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;

  async function tmpFile(content: string): Promise<string> {
    const dir = await tmpDir("mage-redact-rep-");
    const p = join(dir, "in.txt");
    await writeFile(p, content);
    return p;
  }

  afterEach(() => {
    logs.length = 0;
    errs.length = 0;
    logSpy?.mockRestore();
    errSpy?.mockRestore();
  });

  function captureConsole(): void {
    logSpy = vi.spyOn(console, "log").mockImplementation((m?: unknown) => {
      logs.push(String(m));
    });
    errSpy = vi.spyOn(console, "error").mockImplementation((m?: unknown) => {
      errs.push(String(m));
    });
  }

  it("reports secrets + pii without printing the raw secret, and flags blocking", async () => {
    const p = await tmpFile(
      "api_key='longsecretvalue99'\ncontact me at dev@example.com\n",
    );
    captureConsole();
    const res = await redactCmd(p, {});
    const all = [...logs, ...errs].join("\n");
    expect(res.blocked).toBe(true);
    expect(all).not.toContain("longsecretvalue99");
    expect(all).toContain("generic-key-value");
    expect(all).toContain("email");
  });

  it("reports a clean file as no findings", async () => {
    const p = await tmpFile("nothing to see here\n");
    captureConsole();
    await redactCmd(p, {});
    expect(logs.join("\n")).toContain("No secrets or PII detected.");
  });
});
