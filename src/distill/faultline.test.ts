import { describe, expect, it } from "vitest";
import {
  approachKey,
  commandVerbs,
  computeFrictionArcs,
  type FrictionArc,
  type FrictionPattern,
  rankArcs,
  toolExternality,
} from "./faultline.js";
import type { ObserveEvent } from "../observe/types.js";

// ─── builders ────────────────────────────────────────────────────────────────

function bash(detail: string, ok = true, error_summary: string | null = null): ObserveEvent {
  return {
    v: 1, ts: "t", session: "s", type: "tool_use",
    tool: "Bash", paths: [], detail, ok, error_summary: ok ? null : (error_summary ?? "boom"),
  };
}

function pathTool(
  tool: string,
  path: string,
  ok = true,
  error_summary: string | null = null,
): ObserveEvent {
  return {
    v: 1, ts: "t", session: "s", type: "tool_use",
    tool, paths: [path], detail: null, ok, error_summary: ok ? null : error_summary,
  };
}

function webFetch(url: string): ObserveEvent {
  return {
    v: 1, ts: "t", session: "s", type: "tool_use",
    tool: "WebFetch", paths: [], detail: url, ok: true, error_summary: null,
  };
}

function compact(): ObserveEvent {
  return { v: 1, ts: "t", session: "s", type: "compact", trigger: "manual" };
}

function prompt(text: string): ObserveEvent {
  return { v: 1, ts: "t", session: "s", type: "user_prompt", text };
}

function assistantMsg(text: string): ObserveEvent {
  return { v: 1, ts: "t", session: "s", type: "assistant_msg", text };
}

// ─── approach-key ──────────────────────────────────────────────────────────────

describe("approachKey", () => {
  it("keys a path tool on tool:path-stem (basename without extension)", () => {
    expect(approachKey(pathTool("Read", "src/commands/nudge.ts"))).toBe("Read:nudge");
    expect(approachKey(pathTool("Edit", "/abs/path/faultline.ts"))).toBe("Edit:faultline");
  });

  it("keys a simple Bash command on its first verb", () => {
    expect(approachKey(bash("curl -L https://example.com"))).toBe("Bash:curl");
  });

  it("skips navigational wrappers and prefers the external verb in a composite command", () => {
    // The grill's load-bearing case: `cd x && gh …` must key on gh, not cd.
    expect(approachKey(bash("cd repo && gh pr create --fill"))).toBe("Bash:gh");
  });

  it("finds the external verb deep in a pipeline", () => {
    expect(
      approachKey(bash("cat out.json | jq '.x' | curl --data-binary @- https://api.example")),
    ).toBe("Bash:curl");
  });

  it("keys straddler tools (git/npm) on their first verb — they default to local, not external", () => {
    expect(approachKey(bash("npm test"))).toBe("Bash:npm");
    expect(approachKey(bash("git fetch && git rebase origin/main"))).toBe("Bash:git");
  });

  it("skips leading env-assignments and sudo", () => {
    expect(approachKey(bash("FOO=bar node script.js"))).toBe("Bash:node");
    expect(approachKey(bash("sudo systemctl restart svc"))).toBe("Bash:systemctl");
  });

  it("falls through to the tool name for non-path/non-Bash tools, and the type for non-tools", () => {
    expect(approachKey(webFetch("https://example.com"))).toBe("WebFetch");
    expect(approachKey({ v: 1, ts: "t", session: "s", type: "user_prompt", text: "hi" })).toBe(
      "user_prompt",
    );
  });
});

// ─── externality (the cost multiplier) ─────────────────────────────────────────

describe("toolExternality", () => {
  it("treats in-repo file operations as local", () => {
    expect(toolExternality(pathTool("Read", "src/x.ts"))).toBe("local");
    expect(toolExternality(pathTool("Edit", "src/x.ts"))).toBe("local");
  });

  it("treats a Bash command touching an external CLI as external (OR over the whole command)", () => {
    expect(toolExternality(bash("curl https://x"))).toBe("external");
    expect(toolExternality(bash("cat f.json | curl --data @- https://api"))).toBe("external");
    expect(toolExternality(bash("cd repo && gh pr create"))).toBe("external");
  });

  it("treats git/npm/ls as local (straddlers default local so dev-loop noise is not amplified)", () => {
    expect(toolExternality(bash("git status"))).toBe("local");
    expect(toolExternality(bash("npm test"))).toBe("local");
    expect(toolExternality(bash("ls -la"))).toBe("local");
  });

  it("treats inherently-external non-Bash tools as external", () => {
    expect(toolExternality(webFetch("https://x"))).toBe("external");
  });
});

// ─── commandVerbs + portability override ───────────────────────────────────────

describe("commandVerbs", () => {
  it("returns substantive verbs across segments, skipping wrappers and env-assignments", () => {
    expect(commandVerbs("cd repo && gh pr create | jq '.url'")).toEqual(["gh", "jq"]);
    expect(commandVerbs("FOO=1 sudo docker run nginx")).toEqual(["docker"]);
  });
});

describe("portability (ADR-0027 §8 — harness supplies its own sets)", () => {
  it("respects an overridden external-verb set", () => {
    // A harness where `npm` IS the external surface: it now ranks as external.
    const externalVerbs = new Set(["npm"]);
    expect(toolExternality(bash("npm install"), { externalVerbs })).toBe("external");
    expect(approachKey(bash("yarn build && npm publish"), { externalVerbs })).toBe("Bash:npm");
  });

  it("with no external verbs known, still produces a coarse key and a local bucket", () => {
    const externalVerbs = new Set<string>();
    expect(approachKey(bash("kubectl get pods"), { externalVerbs })).toBe("Bash:kubectl");
    expect(toolExternality(bash("kubectl get pods"), { externalVerbs })).toBe("local");
  });
});

// ─── computeFrictionArcs — pattern A (failure→pivot) ───────────────────────────

describe("computeFrictionArcs — failure→pivot", () => {
  it("fires when a DIFFERENT key succeeds and shares a topic with the failure", () => {
    const arcs = computeFrictionArcs([
      bash("gh api repos/acme/widgets/branches/main/protection", false, "403 Forbidden on protection for widgets"),
      bash("curl -H auth https://api.github.com/repos/acme/widgets"),
      compact(),
    ]);
    expect(arcs).toHaveLength(1);
    const arc = arcs[0];
    expect(arc?.pattern).toBe("failure-pivot");
    expect(arc?.tried).toBe("Bash:gh");
    expect(arc?.worked).toBe("Bash:curl");
    expect(arc?.topic).toBeTruthy();
    expect(arc?.externality).toBe("external");
    expect(arc?.onset).toBe(1);
    expect(arc?.resolution).toBe(2);
    // cost = span events (2) × external weight (2)
    expect(arc?.cost).toBe(4);
    // signals are scoped to the arc span (the grab-bag fix)
    expect(arc?.signals.failures.length).toBeGreaterThan(0);
    expect(arc?.signals.tools.length).toBeGreaterThan(0);
  });

  it("does NOT fire when the SAME key succeeds (a retry, not a pivot)", () => {
    const arcs = computeFrictionArcs([
      bash("curl https://api.example/widgets", false, "connection reset for widgets"),
      bash("curl -L https://api.example/widgets"),
      compact(),
    ]);
    expect(arcs).toHaveLength(0);
  });

  it("does NOT fire when the recovering action shares no topic (unlinked)", () => {
    const arcs = computeFrictionArcs([
      bash("gh pr create", false, "merge conflict blocking widgets"),
      pathTool("Edit", "docs/readme.md"),
      compact(),
    ]);
    expect(arcs).toHaveLength(0);
  });

  it("DROPS tool-protocol failures (a harness rule, not a domain lesson)", () => {
    // Edit:nudge fail → Read:nudge ok would otherwise be a textbook pivot (diff key, shared 'nudge').
    const arcs = computeFrictionArcs([
      pathTool("Edit", "src/nudge.ts", false, "File has not been read yet"),
      pathTool("Read", "src/nudge.ts"),
      compact(),
    ]);
    expect(arcs).toHaveLength(0);
  });

  it("collapses consecutive same-key failures into one arc (onset at the first)", () => {
    const arcs = computeFrictionArcs([
      bash("gh api repos/acme/widgets", false, "403 widgets"),
      bash("gh api repos/acme/widgets --paginate", false, "403 widgets again"),
      bash("curl https://api/repos/acme/widgets"),
      compact(),
    ]);
    expect(arcs).toHaveLength(1);
    expect(arcs[0]?.onset).toBe(1);
    expect(arcs[0]?.resolution).toBe(3);
    expect(arcs[0]?.cost).toBe(6); // 3 span events × external weight 2
  });

  it("respects the look-ahead window", () => {
    const events = [
      bash("gh api widgets", false, "403 widgets"),
      bash("git status"), // unlinked noise step
      bash("curl https://api/widgets"), // linked, but 2 steps out
      compact(),
    ];
    expect(computeFrictionArcs(events, { window: 1 })).toHaveLength(0);
    expect(computeFrictionArcs(events)).toHaveLength(1); // default window 8 reaches it
  });

  it("emits nothing for a stream with no terminator (in-flight tail is deferred)", () => {
    const arcs = computeFrictionArcs([
      bash("gh api widgets", false, "403 widgets"),
      bash("curl https://api/widgets"),
    ]);
    expect(arcs).toHaveLength(0);
  });
});

// ─── computeFrictionArcs — pattern B (correction→reset) ────────────────────────

describe("computeFrictionArcs — correction→reset", () => {
  it("fires when a correction is followed by a different-key action", () => {
    const arcs = computeFrictionArcs([
      pathTool("Edit", "src/foo.ts"),
      prompt("no, use the gh CLI instead"),
      bash("gh api repos/acme/foo"),
      compact(),
    ]);
    expect(arcs).toHaveLength(1);
    expect(arcs[0]?.pattern).toBe("correction-reset");
    expect(arcs[0]?.tried).toBe("Edit:foo");
    expect(arcs[0]?.worked).toBe("Bash:gh");
    expect(arcs[0]?.onset).toBe(1);
    expect(arcs[0]?.resolution).toBe(3);
  });

  it("does NOT fire when the agent keeps the same approach after the correction", () => {
    const arcs = computeFrictionArcs([
      pathTool("Edit", "src/foo.ts"),
      prompt("fix the typo on line 9"),
      pathTool("Edit", "src/foo.ts"),
      compact(),
    ]);
    expect(arcs).toHaveLength(0);
  });

  it("survives an assistant_msg between the tool and the correction (adjacency holds)", () => {
    const arcs = computeFrictionArcs([
      pathTool("Edit", "src/foo.ts"),
      assistantMsg("Done — I edited foo.ts."),
      prompt("no, that file is generated; use the gh CLI"),
      bash("gh api repos/acme/foo"),
      compact(),
    ]);
    expect(arcs).toHaveLength(1);
    expect(arcs[0]?.pattern).toBe("correction-reset");
  });

  it("does NOT treat a prompt with no preceding tool as a correction", () => {
    const arcs = computeFrictionArcs([
      prompt("please add a widgets endpoint"),
      bash("gh api widgets"),
      bash("curl https://api/widgets"),
      compact(),
    ]);
    expect(arcs).toHaveLength(0);
  });
});

// ─── computeFrictionArcs — pattern C (grind, sub-switch) ───────────────────────

describe("computeFrictionArcs — grind", () => {
  const grindSession: ObserveEvent[] = [
    pathTool("Read", "src/prometheus-alert.ts"),
    pathTool("Edit", "src/prometheus-alert.ts"),
    bash("node check-prometheus.js"),
    pathTool("Edit", "src/prometheus-alert.ts"),
    pathTool("Read", "src/prometheus-rules.ts"),
    bash("grep prometheus src/"),
    compact(),
  ];

  it("fires on a single dominant topic when the sub-switch is on", () => {
    const arcs = computeFrictionArcs(grindSession, { grind: true });
    const grind = arcs.find((a) => a.pattern === "grind");
    expect(grind).toBeDefined();
    expect(grind?.topic).toBe("prometheus");
    expect(grind?.tried).toBeNull();
    expect(grind?.worked).toBeNull();
  });

  it("does NOT fire when the sub-switch is off (default)", () => {
    expect(computeFrictionArcs(grindSession)).toHaveLength(0);
  });

  it("does NOT grind a grab-bag (many distinct topics, none dominant)", () => {
    const grabBag = computeFrictionArcs(
      [
        pathTool("Read", "src/alpha.ts"),
        pathTool("Edit", "src/bravo.ts"),
        pathTool("Read", "src/charlie.ts"),
        pathTool("Edit", "src/delta.ts"),
        pathTool("Read", "src/echo.ts"),
        pathTool("Edit", "src/foxtrot.ts"),
        compact(),
      ],
      { grind: true },
    );
    expect(grabBag).toHaveLength(0);
  });
});

// ─── rankArcs — hybrid (tiers + cost bonus) ────────────────────────────────────

function arc(
  pattern: FrictionPattern,
  o: { cost?: number; failures?: string[]; onset?: number; resolution?: number } = {},
): FrictionArc {
  const onset = o.onset ?? 1;
  return {
    session: "s",
    span: `L${onset}-L${o.resolution ?? onset + 1}`,
    signals: { prompts: [], corrections: [], failures: o.failures ?? [], tools: [] },
    hint: "",
    pattern,
    onset,
    resolution: o.resolution ?? onset + 1,
    tried: null,
    worked: null,
    topic: null,
    cost: o.cost ?? 2,
    externality: "local",
  };
}

describe("rankArcs", () => {
  it("orders correction > environmental failure > grind > generic failure", () => {
    const correction = arc("correction-reset", { cost: 2, onset: 1, resolution: 2 });
    const envFail = arc("failure-pivot", { cost: 4, failures: ["403 Forbidden"], onset: 10, resolution: 11 });
    const grind = arc("grind", { cost: 30, onset: 20, resolution: 50 });
    const generic = arc("failure-pivot", { cost: 2, failures: ["boom"], onset: 60, resolution: 61 });
    const ranked = rankArcs([generic, grind, correction, envFail]);
    expect(ranked.map((a) => a.pattern)).toEqual([
      "correction-reset",
      "failure-pivot", // env (score 104)
      "grind", // 30
      "failure-pivot", // generic (score 2)
    ]);
  });

  it("lets a hard grind out-rank a generic failure (the cost bonus)", () => {
    const grind = arc("grind", { cost: 30, onset: 1, resolution: 40 });
    const generic = arc("failure-pivot", { cost: 2, failures: ["boom"], onset: 50, resolution: 51 });
    expect(rankArcs([generic, grind])[0]?.pattern).toBe("grind");
  });

  it("keeps an external env-error fight above a long local grind (the grill's example)", () => {
    const envFight = arc("failure-pivot", { cost: 8, failures: ["403 on free plan"], onset: 1, resolution: 5 });
    const localGrind = arc("grind", { cost: 30, onset: 10, resolution: 40 });
    expect(rankArcs([localGrind, envFight])[0]?.pattern).toBe("failure-pivot");
  });

  it("caps the surfaced set", () => {
    const arcs = [
      arc("correction-reset", { onset: 1, resolution: 2 }),
      arc("failure-pivot", { failures: ["403"], onset: 10, resolution: 11 }),
      arc("grind", { cost: 9, onset: 20, resolution: 30 }),
    ];
    expect(rankArcs(arcs, { cap: 2 })).toHaveLength(2);
  });

  it("drops a lower-scored arc that overlaps a kept one (outermost/highest wins)", () => {
    const correction = arc("correction-reset", { onset: 5, resolution: 9 });
    const overlappingFailure = arc("failure-pivot", { failures: ["boom"], onset: 6, resolution: 8 });
    const ranked = rankArcs([overlappingFailure, correction]);
    expect(ranked).toHaveLength(1);
    expect(ranked[0]?.pattern).toBe("correction-reset");
  });
});
