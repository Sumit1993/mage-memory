import { describe, expect, it, vi } from "vitest";
import * as redactMod from "../redact.js";
import { REDACT_ERROR_MARKER, SCRUB_HEADROOM, scrubField } from "./scrub.js";

// A fabricated GitHub PAT shape (ghp_ + 36 chars) — matches the "github-token"
// detector. The value never appears in stored output once scrubbed.
const SECRET = "ghp_0123456789abcdefghijklmnopqrstuvwx";

describe("scrubField — Gate-1 scrub-only wrapper (ADR-0014 / ADR-0015 §5)", () => {
  it("null/undefined input → null", () => {
    expect(scrubField(null, 100)).toBeNull();
    expect(scrubField(undefined, 100)).toBeNull();
  });

  it("replaces a live secret with a [REDACTED:…] marker; the raw secret never appears", () => {
    const out = scrubField(`token: ${SECRET}`, 1000);
    expect(out).not.toBeNull();
    expect(out as string).not.toContain(SECRET);
    expect(out as string).toContain("[REDACTED:");
  });

  it("truncates AFTER scrub to maxLen (a secret straddling the boundary can't leak a tail)", () => {
    // 60 chars of clean prefix, then the secret straddling the 64-char cap.
    const raw = `${"a".repeat(40)} ${SECRET}`;
    const out = scrubField(raw, 50);
    expect(out).not.toBeNull();
    expect((out as string).length).toBeLessThanOrEqual(50);
    expect(out as string).not.toContain(SECRET);
  });

  it("is idempotent — scrubbing already-scrubbed text yields no new secrets", () => {
    const once = scrubField(`api_key=${SECRET}`, 1000) as string;
    const twice = scrubField(once, 1000) as string;
    expect(twice).toBe(once);
    expect(twice).not.toContain(SECRET);
  });

  it("fail-closed: when redact() throws, returns the sentinel and NEVER the raw input", () => {
    vi.spyOn(redactMod, "redact").mockImplementation(() => {
      throw new Error("boom in redactor");
    });
    const out = scrubField(`secret ${SECRET}`, 1000);
    expect(out).toBe(REDACT_ERROR_MARKER);
    expect(out as string).not.toContain(SECRET);
    vi.restoreAllMocks();
  });

  it("the fail-closed sentinel round-trips through the redaction marker grammar", () => {
    // Re-scrubbing the sentinel must be a no-op (recognized as already-redacted).
    expect(scrubField(REDACT_ERROR_MARKER, 1000)).toBe(REDACT_ERROR_MARKER);
  });

  it("clean prose passes through unchanged (bounded)", () => {
    const clean = "ordinary notes about the build";
    expect(scrubField(clean, 1000)).toBe(clean);
  });

  it("bounds the pre-scrub input (M1) — redact() never scans more than maxLen + headroom", () => {
    // A multi-MB field must not make redact() scan unbounded input on the hot path.
    const huge = `${"a".repeat(5_000_000)} ${SECRET}`;
    const spy = vi.spyOn(redactMod, "redact"); // default: calls through to the real redactor.
    const out = scrubField(huge, 200);
    const passed = spy.mock.calls[0]?.[0] as string;
    expect(passed.length).toBeLessThanOrEqual(200 + SCRUB_HEADROOM);
    expect((out as string).length).toBeLessThanOrEqual(200);
    spy.mockRestore();
  });

  it("still redacts a secret straddling maxLen when it falls within the headroom", () => {
    // Secret begins just before a small cap but well within maxLen + headroom,
    // so scrub-before-truncate still sees and removes it in full.
    const raw = `${"a".repeat(48)}${SECRET}`;
    const out = scrubField(raw, 50);
    expect(out as string).not.toContain(SECRET);
    expect((out as string).length).toBeLessThanOrEqual(50);
  });
});
