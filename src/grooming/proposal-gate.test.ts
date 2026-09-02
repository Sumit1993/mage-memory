import { describe, expect, it } from "vitest";
import {
  PROPOSAL_BRANCH_PREFIX,
  PROPOSAL_NOTE_CAP,
  type ProposalRequest,
  judgeProposal,
} from "./proposal-gate.js";

const baseRequest: ProposalRequest = {
  repoRoot: "/repos/my-project",
  kbRepo: "/repos/my-project",
  proposalsEnabled: true,
  defaultBranch: "main",
  branchName: `${PROPOSAL_BRANCH_PREFIX}fix-typo`,
  redactionBlocked: false,
  dirtyPathsOutsideKb: [],
  noteCount: 3,
};

describe("judgeProposal — permit case", () => {
  it("returns ok: true when all conditions are satisfied", () => {
    const verdict = judgeProposal(baseRequest);
    expect(verdict).toEqual({ ok: true });
  });
});

describe("judgeProposal — refusal conditions", () => {
  it("1. refuses when proposals are disabled", () => {
    const verdict = judgeProposal({ ...baseRequest, proposalsEnabled: false });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(verdict.message).toContain("proposals are off for this knowledge base");
      expect(verdict.message).toContain("grooming.proposals");
    }
  });

  it("2. refuses when branch is the default branch", () => {
    const verdict = judgeProposal({
      ...baseRequest,
      branchName: "main",
      defaultBranch: "main",
    });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(verdict.message).toContain("cannot propose on default branch 'main'");
      expect(verdict.message).toContain(PROPOSAL_BRANCH_PREFIX);
    }
  });

  it("3. refuses when branch is outside the proposal prefix", () => {
    const verdict = judgeProposal({
      ...baseRequest,
      branchName: "feat/my-feature",
    });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(verdict.message).toContain("outside 'mage/proposal/'");
      expect(verdict.message).toContain("feat/my-feature");
    }
  });

  it("4. refuses when redaction scan blocked on live secrets", () => {
    const verdict = judgeProposal({
      ...baseRequest,
      redactionBlocked: true,
    });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(verdict.message).toContain("Gate-2 redaction scan blocked");
      expect(verdict.message).toContain("metadata.redact");
    }
  });

  it("5. refuses when repoRoot does not match kbRepo", () => {
    const verdict = judgeProposal({
      ...baseRequest,
      repoRoot: "/repos/code-repo",
      kbRepo: "/repos/hub-repo",
    });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(verdict.message).toContain("/repos/code-repo");
      expect(verdict.message).toContain("/repos/hub-repo");
    }
  });

  it("6. refuses when dirtyPathsOutsideKb is non-empty", () => {
    const verdict = judgeProposal({
      ...baseRequest,
      dirtyPathsOutsideKb: ["src/app.ts", "package.json", "docs/readme.md", "extra.txt"],
    });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(verdict.message).toContain("src/app.ts, package.json, docs/readme.md and 1 more");
      expect(verdict.message).toContain("commit, stash, or clean");
    }
  });

  it("7. refuses when noteCount exceeds PROPOSAL_NOTE_CAP", () => {
    const verdict = judgeProposal({
      ...baseRequest,
      noteCount: 6,
    });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(verdict.message).toContain("6");
      expect(verdict.message).toContain(String(PROPOSAL_NOTE_CAP));
    }
  });
});

describe("judgeProposal — ordering / precedence", () => {
  it("prioritizes proposalsEnabled over defaultBranch", () => {
    const verdict = judgeProposal({
      ...baseRequest,
      proposalsEnabled: false,
      branchName: "main",
      defaultBranch: "main",
    });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(verdict.message).toContain("proposals are off");
    }
  });

  it("prioritizes defaultBranch over prefix check", () => {
    const verdict = judgeProposal({
      ...baseRequest,
      branchName: "main",
      defaultBranch: "main",
    });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(verdict.message).toContain("default branch 'main'");
    }
  });

  it("prioritizes prefix check over redaction scan", () => {
    const verdict = judgeProposal({
      ...baseRequest,
      branchName: "feat/foo",
      redactionBlocked: true,
    });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(verdict.message).toContain("outside 'mage/proposal/'");
    }
  });

  it("prioritizes redaction scan over repo mismatch", () => {
    const verdict = judgeProposal({
      ...baseRequest,
      redactionBlocked: true,
      repoRoot: "/repos/a",
      kbRepo: "/repos/b",
    });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(verdict.message).toContain("redaction scan blocked");
    }
  });

  it("prioritizes repo mismatch over dirty paths outside KB", () => {
    const verdict = judgeProposal({
      ...baseRequest,
      repoRoot: "/repos/a",
      kbRepo: "/repos/b",
      dirtyPathsOutsideKb: ["src/index.ts"],
    });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(verdict.message).toContain("does not match");
    }
  });

  it("prioritizes dirty paths over note cap", () => {
    const verdict = judgeProposal({
      ...baseRequest,
      dirtyPathsOutsideKb: ["src/index.ts"],
      noteCount: 10,
    });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(verdict.message).toContain("dirty paths outside knowledge base");
    }
  });
});

describe("judgeProposal — environment and terminal state neutrality (ADR-0046 §6)", () => {
  it("produces byte-identical verdicts across env vars and TTY states", () => {
    const envKeys = ["CI", "GITHUB_ACTIONS", "CLAUDE_CODE_REMOTE", "VITEST"] as const;
    const origEnv: Record<string, string | undefined> = {};
    for (const k of envKeys) origEnv[k] = process.env[k];
    const origIsTTY = process.stdout.isTTY;

    try {
      // Run 1: environment stuffed with markers, isTTY true
      for (const k of envKeys) process.env[k] = "true";
      Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
      const verdictStuffed = judgeProposal(baseRequest);

      // Run 2: environment stripped of markers, isTTY false
      for (const k of envKeys) delete process.env[k];
      Object.defineProperty(process.stdout, "isTTY", { value: false, configurable: true });
      const verdictStripped = judgeProposal(baseRequest);

      expect(JSON.stringify(verdictStuffed)).toBe(JSON.stringify(verdictStripped));

      // Also test a refusal case across env states
      const refusalRequest: ProposalRequest = { ...baseRequest, proposalsEnabled: false };

      for (const k of envKeys) process.env[k] = "1";
      Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
      const refusalStuffed = judgeProposal(refusalRequest);

      for (const k of envKeys) delete process.env[k];
      Object.defineProperty(process.stdout, "isTTY", { value: false, configurable: true });
      const refusalStripped = judgeProposal(refusalRequest);

      expect(JSON.stringify(refusalStuffed)).toBe(JSON.stringify(refusalStripped));
    } finally {
      for (const k of envKeys) {
        if (origEnv[k] !== undefined) process.env[k] = origEnv[k];
        else delete process.env[k];
      }
      Object.defineProperty(process.stdout, "isTTY", { value: origIsTTY, configurable: true });
    }
  });
});
