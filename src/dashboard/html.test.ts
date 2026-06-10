import { describe, expect, it } from "vitest";
import { renderCockpitHtml } from "./html.js";
import type { DashboardData } from "./types.js";

// ─── fixtures ─────────────────────────────────────────────────────────────────

/** A fully-populated snapshot exercising every panel, wing color, and proposal kind. */
function populated(): DashboardData {
  return {
    meta: {
      kbName: "my-kb",
      kind: "in-repo",
      root: "/abs/repo/mage",
      mageVersion: "9.9.9",
      lastRefreshed: "2026-06-09T12:00:00.000Z",
    },
    kpis: {
      notes: 4,
      skills: 2,
      wings: 3,
      contextMatchPct: 75,
      awaitingYou: 5,
      graduateReady: 1,
    },
    proposals: [
      {
        kind: "graduate",
        target: "notes/a1.md",
        why: "note recurred in 5 session(s) — a proven playbook",
        wing: "alpha",
        evidence: "note recurred in 5 session(s) — a proven playbook",
      },
      {
        kind: "note",
        target: "alpha::deploy,rollback",
        why: "recurred in 3 session(s): rollback on failed deploy",
        wing: "alpha",
      },
      { kind: "merge", target: "notes/b1.md", why: "near-duplicate of notes/b2.md", wing: "beta" },
      { kind: "split", target: "notes/c1.md", why: "covers two distinct topics", wing: "gamma" },
      { kind: "reword", target: "notes/c2.md", why: "title does not match body", wing: "gamma" },
    ],
    wings: [
      { name: "alpha", noteCount: 2, skillCount: 1, rooms: ["core"] },
      { name: "beta", noteCount: 1, skillCount: 0, rooms: ["edge"] },
      { name: "gamma", noteCount: 1, skillCount: 1 },
    ],
    notes: [
      {
        title: "Alpha One",
        type: "playbook",
        wing: "alpha",
        room: "core",
        wings: [{ wing: "alpha", room: "core" }],
        keywords: ["deploy", "rollback"],
        status: "active",
        lastReviewed: "2026-06-05",
        relPath: "notes/a1.md",
        obsidianFile: "notes/a1.md",
      },
      {
        title: "Beta One",
        type: "note",
        wing: "beta",
        room: "edge",
        wings: [{ wing: "beta", room: "edge" }],
        keywords: [],
        relPath: "notes/b1.md",
        obsidianFile: "notes/b1.md",
      },
    ],
    skills: [
      { name: "alpha:deploy", wing: "alpha", contextMatchPct: 80, status: "ok" },
      { name: "gamma:build", wing: "gamma", status: "reword-suggested" },
    ],
    graph: {
      nodes: [
        { id: "notes/a1.md", wing: "alpha" },
        { id: "notes/b1.md", wing: "beta" },
        { id: "notes/c1.md", wing: "gamma" },
      ],
      edges: [{ source: "notes/a1.md", target: "notes/b1.md" }],
    },
    activity: [
      { date: "2026-06-01", created: 1, reviewed: 0 },
      { date: "2026-06-05", created: 0, reviewed: 2 },
      { date: "2026-06-08", created: 2, reviewed: 1 },
    ],
    ladder: {
      scratch: 12,
      notes: 4,
      skills: 2,
      climbing: [
        { sessions: 5, count: 1 },
        { sessions: 3, count: 2 },
      ],
    },
    health: {
      notesDueForReview: 1,
      danglingLinks: 0,
      orphanNotes: 1,
      lastCommit: { hash: "abcdef1234567890", when: "2026-06-08T00:00:00.000Z" },
    },
  };
}

/** A cold, brand-new KB: empty proposals, zeroed metrics, no commit. */
function cold(): DashboardData {
  return {
    meta: {
      kbName: "fresh",
      kind: "in-repo",
      root: "/abs/fresh/mage",
      mageVersion: "9.9.9",
      lastRefreshed: "2026-06-09T12:00:00.000Z",
    },
    kpis: { notes: 0, skills: 0, wings: 0, contextMatchPct: 0, awaitingYou: 0, graduateReady: 0 },
    proposals: [],
    wings: [],
    notes: [],
    skills: [],
    graph: { nodes: [], edges: [] },
    activity: [],
    ladder: { scratch: 0, notes: 0, skills: 0, climbing: [] },
    health: { notesDueForReview: 0, danglingLinks: 0, orphanNotes: 0, lastCommit: null },
  };
}

/**
 * A MATURE KB: many notes, a graduated skill, NO proposals, scratch waiting,
 * a healthy graph. Mirrors this repo's real shape (notes=31, skills=1,
 * proposals=0, scratch≈2335, health all 0) so the suppression behaviour the
 * cockpit owner asked for is locked in: capture/getting-started/notes/graduate
 * nudges are ABSENT; only the proposals/distill prods remain (proposals empty).
 */
function mature(): DashboardData {
  const d = cold();
  d.meta = { ...d.meta, kbName: "mature-kb" };
  d.kpis = { ...d.kpis, notes: 31, skills: 1, wings: 2, contextMatchPct: 88 };
  d.ladder = { scratch: 2335, notes: 31, skills: 1, climbing: [] };
  d.skills = [{ name: "alpha:deploy", wing: "alpha", contextMatchPct: 88, status: "ok" }];
  d.wings = [{ name: "alpha", noteCount: 20, skillCount: 1 }];
  // health stays all-zero (cold() default) — no health nudge.
  return d;
}

// ─── (1) one complete HTML document ───────────────────────────────────────────

describe("renderCockpitHtml — document shape", () => {
  it("returns a single string that is one complete HTML document", () => {
    const html = renderCockpitHtml(populated());
    expect(typeof html).toBe("string");
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html.trimEnd().endsWith("</html>")).toBe(true);
    // exactly one document.
    expect(html.match(/<!doctype html>/gi)?.length).toBe(1);
    expect(html.match(/<\/html>/gi)?.length).toBe(1);
  });

  it("renders the KB identity, KPI numbers, and footer from REAL data", () => {
    const html = renderCockpitHtml(populated());
    expect(html).toContain("my-kb");
    expect(html).toContain("refreshed 2026-06-09T12:00:00.000Z");
    expect(html).toContain("75%"); // context-match KPI
    expect(html).toContain("mage"); // brand
  });

  it("makes the KPI cards clickable — each navigates to the relevant tab", () => {
    const html = renderCockpitHtml(populated());
    // owner complaint #1: KPI cards did nothing. Each card now carries the same
    // [data-goto-tab] hook the teaser uses, so the delegated handler switches tabs.
    // notes→notes, skills→skills, wings→wings (context-match→skills; the
    // overview-bound cards reuse goto=overview).
    expect(html).toMatch(/class="kpi"[^>]*data-goto-tab="notes"/);
    expect(html).toMatch(/class="kpi"[^>]*data-goto-tab="skills"/);
    expect(html).toMatch(/class="kpi"[^>]*data-goto-tab="wings"/);
    // keyboard-accessible: role=button + tabindex so Enter/Space activate them.
    expect(html).toMatch(/class="kpi"[^>]*role="button"/);
    expect(html).toMatch(/class="kpi"[^>]*tabindex="0"/);
    // the client wires Enter/Space on every [data-goto-tab] element.
    expect(html).toContain("ev.key === 'Enter' || ev.key === ' '");
    // the card has a visible pointer affordance.
    expect(html).toMatch(/\.kpi\{[^}]*cursor:pointer/);
  });
});

// ─── (2) zero external resources ──────────────────────────────────────────────

describe("renderCockpitHtml — offline, zero external resources", () => {
  it("contains no network resource URLs (only offline/app deep-link schemes)", () => {
    const html = renderCockpitHtml(populated());
    // Any `://` scheme in the output must be an OFFLINE app deep-link (a note
    // open-target), never a network fetch. The default `file` open-target uses
    // relative links (no scheme at all); obsidian/vscode are app schemes.
    const protocols = [...html.matchAll(/([a-zA-Z][a-zA-Z0-9+.-]*):\/\//g)].map((m) => m[1]);
    for (const proto of protocols) {
      expect(["obsidian", "vscode"]).toContain(proto);
    }
    // No http(s), no CDN/font/script src, no stylesheet link to a URL.
    expect(html).not.toContain("http://");
    expect(html).not.toContain("https://");
    expect(html).not.toMatch(/<link[^>]+href=["']?[a-z]+:\/\//i);
    expect(html).not.toMatch(/<script[^>]+src=/i);
  });

  it("carries a restrictive Content-Security-Policy meta tag (defense in depth)", () => {
    const html = renderCockpitHtml(populated());
    // Blocks any network load while permitting the fully-inline offline design
    // (inline script/style, data: images). obsidian:// hrefs are unaffected.
    expect(html).toContain(
      `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:;"/>`,
    );
  });
});

// ─── open-with target (configurable click-to-open) ────────────────────────────

describe("renderCockpitHtml — open-with target", () => {
  it("defaults to a relative file link on BOTH surfaces (graph + Notes table)", () => {
    const html = renderCockpitHtml(populated());
    expect(html).toContain('href="notes/a1.md"'); // Notes-table row.
    expect(html).toContain('"href":"notes/a1.md"'); // graph island node.
    expect(html).not.toContain("obsidian://");
    expect(html).not.toContain("vscode://");
  });

  it("--open-with obsidian emits obsidian:// deep-links", () => {
    const html = renderCockpitHtml(populated(), { openWith: "obsidian" });
    expect(html).toContain("obsidian://open?vault=my-kb&file=notes%2Fa1.md"); // Notes table.
    expect(html).toContain('"href":"obsidian://open?vault=my-kb&file=notes%2Fa1.md"'); // graph.
  });

  it("--open-with vscode emits vscode://file/<abs> deep-links (abs from meta.root)", () => {
    const html = renderCockpitHtml(populated(), { openWith: "vscode" });
    // meta.root is /abs/repo/mage; relFile notes/a1.md → /abs/repo/mage/notes/a1.md.
    // NOTE: vscode mode embeds the absolute path — acceptable, the cockpit is
    // gitignored + local-only (file/obsidian modes leak no path).
    expect(html).toContain("vscode://file/abs/repo/mage/notes/a1.md");
  });
});

// ─── (3) injection safety ─────────────────────────────────────────────────────

describe("renderCockpitHtml — injection safety", () => {
  function malicious(): DashboardData {
    const d = cold();
    d.notes = [
      {
        // a title that tries to break out of the script island AND inject an <img>.
        title: "</script><img src=x onerror=alert(1)>",
        type: "note",
        wing: "alpha",
        room: "",
        wings: [{ wing: "alpha", room: "" }],
        keywords: ["<script>alert(2)</script>"],
        relPath: "notes/evil.md",
        obsidianFile: "notes/evil.md",
      },
    ];
    d.wings = [{ name: "alpha", noteCount: 1, skillCount: 0 }];
    d.proposals = [
      {
        kind: "reword",
        target: "notes/evil.md",
        why: "</script><img src=x onerror=alert(1)>",
        wing: "alpha",
      },
    ];
    d.kpis = { ...d.kpis, notes: 1, wings: 1, awaitingYou: 1 };
    return d;
  }

  it("never emits a live <img onerror handler or a live closing-script breakout", () => {
    const html = renderCockpitHtml(malicious());
    // The spec: the raw `onerror=alert(1)` and `<script>alert(2)` sequences must
    // NOT appear UNESCAPED — i.e. never as part of a LIVE tag. Entity-escaped text
    // (`&lt;img … onerror=…&gt;`) and the `<`-escaped JSON island are both safe; a
    // live `<img …>` / `<script>` element is what would execute, and must be absent.
    expect(html).not.toContain("<img src=x onerror"); // no live <img element.
    expect(html).not.toContain("</script><img"); // no closing-script breakout.
    expect(html).not.toContain("<script>alert(2)"); // no live injected <script>.

    // Wherever the defanged `onerror=alert(1)` substring survives, it is ONLY ever
    // entity-escaped (`&lt;img`) or inside the `<`-escaped JSON island (`\\u003cimg`)
    // — never adjacent to a raw `<img`.
    for (const m of html.matchAll(/onerror=alert\(1\)/g)) {
      const before = html.slice(Math.max(0, (m.index ?? 0) - 24), m.index);
      const safe = before.includes("&lt;img") || before.includes("\\u003cimg");
      expect(safe).toBe(true);
    }
  });

  it("does not let an untrusted value terminate the JSON island", () => {
    const html = renderCockpitHtml(malicious());
    // The only literal </script> closers are the page's own (the data island has
    // its `<` escaped). The data island uses type="application/json"; the closing
    // </script> of the page's real <script> blocks is fine. Assert the injected
    // closer was neutralised: the raw `</script><img` adjacency must not survive.
    expect(html).not.toContain("</script><img");
    // The JSON island escapes `<` to < so the payload cannot break out.
    const islandStart = html.indexOf('id="mage-data">') + 'id="mage-data">'.length;
    const islandEnd = html.indexOf("</script>", islandStart);
    const island = html.slice(islandStart, islandEnd);
    expect(island).not.toContain("<"); // no raw `<` survives inside the island.
    expect(island).toContain("\\u003c"); // it was escaped.
  });
});

// ─── (3b) JSON-island minimisation — no absolute paths leak ───────────────────

describe("renderCockpitHtml — JSON island minimisation", () => {
  it("does NOT embed the absolute meta.root KB path", () => {
    const html = renderCockpitHtml(populated());
    // The UI never displays meta.root; the island sanitises it away so the
    // committed/shared file leaks no absolute filesystem path.
    expect(html).not.toContain("/abs/repo/mage");
  });

  it("reduces hub registry codePath to a basename (no absolute member paths)", () => {
    const d = cold();
    d.meta = { ...d.meta, kind: "hub", kbName: "the-hub" };
    d.registry = [
      { name: "member-a", repoUrl: "git@example:member-a.git", codePath: "/abs/code/member-a", cloned: true },
    ];
    const html = renderCockpitHtml(d);
    expect(html).not.toContain("/abs/code/member-a"); // absolute path stripped.
    expect(html).toContain("member-a"); // basename / name still present.
  });

  it("does not mutate the input snapshot when sanitising the island", () => {
    const d = populated();
    const before = d.meta.root;
    renderCockpitHtml(d);
    expect(d.meta.root).toBe(before); // input untouched (immutability).
  });
});

// ─── (4) proposal queue renders each kind with its badge ──────────────────────

describe("renderCockpitHtml — proposal queue", () => {
  it("renders each proposal kind with its action badge", () => {
    const html = renderCockpitHtml(populated());
    for (const kind of ["graduate", "note", "merge", "split", "reword"]) {
      // each badge carries its kind label immediately before its closing tag
      // (graduate is prefixed by a star glyph, so assert label-adjacent-to-closer).
      expect(html).toContain(`${kind}</span>`);
    }
    // graduate carries a star glyph.
    expect(html).toContain("&#9733;");
    // the inert action buttons are present.
    expect(html).toContain(">Confirm</button>");
    expect(html).toContain(">Skip</button>");
    // and the hero title states nothing is committed.
    expect(html).toContain("nothing committed ever");
  });

  it("shows the empty state when there are no proposals", () => {
    const html = renderCockpitHtml(cold());
    expect(html).toContain("No proposals yet");
    expect(html).not.toContain(">Confirm</button>");
  });
});

// ─── (5) cold state renders without throwing ──────────────────────────────────

describe("renderCockpitHtml — cold state", () => {
  it("renders a brand-new empty KB without throwing", () => {
    expect(() => renderCockpitHtml(cold())).not.toThrow();
    const html = renderCockpitHtml(cold());
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain("No proposals yet");
    // zeroed KPIs are still rendered.
    expect(html).toContain("0%");
    // not-a-git-repo provenance degrades gracefully.
    expect(html).toContain("not a git repo");
  });

  it("renders a hub KB with a registry without throwing", () => {
    const d = cold();
    d.meta = { ...d.meta, kind: "hub", kbName: "the-hub" };
    d.registry = [
      { name: "member-a", repoUrl: "git@example:member-a.git", codePath: "/code/a", cloned: true },
      { name: "member-b", repoUrl: "", codePath: "/code/b", cloned: false },
    ];
    expect(() => renderCockpitHtml(d)).not.toThrow();
    const html = renderCockpitHtml(d);
    expect(html).toContain("member-a");
    expect(html).toContain("the-hub");
  });
});

// ─── (6) interactive force-graph — client wiring ──────────────────────────────

describe("renderCockpitHtml — interactive knowledge graph", () => {
  it("embeds a dedicated, sanitised graph data island with enriched nodes", () => {
    const html = renderCockpitHtml(populated());
    // The graph payload is its own application/json island.
    expect(html).toContain('id="mage-graph"');
    // It carries the enriched node fields the client needs (title/type/keywords/
    // color/href/degree + seeded x/y), joined from the notes list.
    const start = html.indexOf('id="mage-graph">') + 'id="mage-graph">'.length;
    const end = html.indexOf("</script>", start);
    const island = html.slice(start, end);
    const parsed = JSON.parse(island.replace(/\\u003c/g, "<")) as {
      nodes: Array<{
        id: string;
        title: string;
        type: string;
        keywords: string[];
        color: string;
        href: string;
        x: number;
        y: number;
        degree: number;
      }>;
      edges: Array<[number, number]>;
      legend: Array<{ label: string; color: string }>;
    };
    expect(parsed.nodes.length).toBeGreaterThan(0);
    const a1 = parsed.nodes.find((n) => n.id === "notes/a1.md");
    expect(a1).toBeDefined();
    expect(a1?.title).toBe("Alpha One"); // joined from the note.
    expect(a1?.keywords).toEqual(["deploy", "rollback"]);
    // node click-to-open: the DEFAULT href is a relative file link (opens the raw
    // file from the page's own origin — works in any browser/OS, no app needed).
    expect(a1?.href).toBe("notes/a1.md");
    // degree from the single a1→b1 edge.
    expect(a1?.degree).toBe(1);
    // seeded positions are inside the viewBox (deterministic golden-angle spiral).
    expect(a1?.x).toBeGreaterThanOrEqual(0);
    expect(a1?.y).toBeGreaterThanOrEqual(0);
    // nodes are colored BY NOTE TYPE: a1 is type "playbook" → the playbook color
    // (not the wing color), proving the type-based coloring.
    expect(a1?.color).toBe("#a3e635");
    // a legend maps note TYPES to colors, with a `label` (type) per entry.
    expect(parsed.legend.length).toBeGreaterThan(0);
    expect(typeof parsed.legend[0]?.label).toBe("string");
    // edges are index pairs into nodes.
    expect(Array.isArray(parsed.edges[0])).toBe(true);
  });

  it("is deterministic — same input renders byte-identical output (no Math.random)", () => {
    const a = renderCockpitHtml(populated());
    const b = renderCockpitHtml(populated());
    expect(a).toBe(b);
  });

  it("inlines the force-graph library and wires Canvas labels + click-to-open + zoom", () => {
    const html = renderCockpitHtml(populated());
    // (1) the vendored force-graph UMD is INLINED (defines ForceGraph) and the
    // client init references it — no external <script src>.
    expect(html).toContain("window.ForceGraph"); // the inlined global is consumed.
    expect(html).toMatch(/ForceGraph\b/); // the lib symbol is present in the doc.
    // Identifiable client entry points / markers (so a headless test can assert).
    expect(html).toContain("function buildGraph()"); // graph bootstrap.
    expect(html).toContain("function filterNotes()"); // notes search/filter.
    // (3) ALWAYS-ON LABELS: drawn on the canvas via nodeCanvasObject + fillText.
    expect(html).toContain(".nodeCanvasObject(");
    expect(html).toContain("ctx.fillText(");
    expect(html).toContain(".nodePointerAreaPaint("); // hit-area matches the dot.
    // (2) node click opens the note in Obsidian, and zoomToFit + zoom buttons exist.
    expect(html).toContain(".onNodeClick(");
    expect(html).toContain("window.location.href = node.href"); // click-to-open.
    expect(html).toContain("zoomToFit("); // whole-graph fit (fixes overflow).
    expect(html).toContain("Graph.zoom(Graph.zoom() * 1.3"); // + button.
    expect(html).toContain("Graph.zoom(Graph.zoom() / 1.3"); // − button.
    // The FIXED-HEIGHT stage + zoom-button + info + legend mounts.
    expect(html).toContain('id="mage-graph-stage"');
    expect(html).toContain('id="graph-zoom-in"');
    expect(html).toContain('id="graph-zoom-out"');
    expect(html).toContain('id="graph-zoom-fit"');
    expect(html).toContain('id="graph-info"'); // info panel element.
    expect(html).toContain('id="graph-legend"'); // legend mount.
    // the spec's exact caption framing is preserved.
    expect(html).toContain(
      "Preview &mdash; the full, editable graph lives in Obsidian (click a node to open it).",
    );
  });

  it("mounts the graph in a FIXED-HEIGHT, overflow-clipped stage (never grows the page)", () => {
    const html = renderCockpitHtml(populated());
    // the .graph-stage rule pins a bounded height and clips overflow so pan/zoom
    // stay internal — the owner's overflow/page-scroll complaint.
    expect(html).toMatch(/\.graph-stage\{[^}]*height:min\(68vh,620px\)/);
    expect(html).toMatch(/\.graph-stage\{[^}]*overflow:hidden/);
  });

  it("node hrefs use the SAME link as the Notes table (one noteLink, both surfaces)", () => {
    const html = renderCockpitHtml(populated());
    // The Notes table links notes/a1.md; the graph island must use the identical
    // target for the same note. In the default `file` mode that's a relative link.
    expect(html).toContain('href="notes/a1.md"'); // Notes-table row.
    expect(html).toContain('"href":"notes/a1.md"'); // graph island node.
  });

  it("renders a 0-node graph without throwing and shows the empty state", () => {
    expect(() => renderCockpitHtml(cold())).not.toThrow();
    const html = renderCockpitHtml(cold());
    expect(html).toContain("No notes to graph yet.");
    // an empty graph island is still embedded (nodes: []), so the client no-ops.
    expect(html).toContain('id="mage-graph"');
  });

  it("renders a tiny (1-node) graph without throwing", () => {
    const d = cold();
    d.notes = [
      {
        title: "Solo",
        type: "note",
        wing: "alpha",
        room: "",
        wings: [{ wing: "alpha", room: "" }],
        keywords: ["x"],
        relPath: "notes/solo.md",
        obsidianFile: "notes/solo.md",
      },
    ];
    d.wings = [{ name: "alpha", noteCount: 1, skillCount: 0 }];
    d.graph = { nodes: [{ id: "notes/solo.md", wing: "alpha" }], edges: [] };
    d.kpis = { ...d.kpis, notes: 1, wings: 1 };
    expect(() => renderCockpitHtml(d)).not.toThrow();
    const html = renderCockpitHtml(d);
    expect(html).toContain('id="mage-graph-stage"'); // full host present.
    expect(html).toContain("Solo");
  });

  it("does not let a malicious note title break out of the graph island", () => {
    const d = cold();
    d.notes = [
      {
        title: "</script><img src=x onerror=alert(1)>",
        type: "note",
        wing: "alpha",
        room: "",
        wings: [{ wing: "alpha", room: "" }],
        keywords: ["<script>alert(2)</script>"],
        relPath: "notes/evil.md",
        obsidianFile: "notes/evil.md",
      },
    ];
    d.wings = [{ name: "alpha", noteCount: 1, skillCount: 0 }];
    d.graph = { nodes: [{ id: "notes/evil.md", wing: "alpha" }], edges: [] };
    d.kpis = { ...d.kpis, notes: 1, wings: 1 };
    const html = renderCockpitHtml(d);
    // the graph island escapes `<`, so the breakout/img/script can't go live.
    expect(html).not.toContain("</script><img");
    expect(html).not.toContain("<img src=x onerror");
    expect(html).not.toContain("<script>alert(2)");
    const start = html.indexOf('id="mage-graph">') + 'id="mage-graph">'.length;
    const end = html.indexOf("</script>", start);
    const island = html.slice(start, end);
    expect(island).not.toContain("<"); // no raw `<` survives in the graph island.
    expect(island).toContain("\\u003c"); // it was escaped.
  });
});

// ─── (7) notes search / filter + clickable rows ───────────────────────────────

describe("renderCockpitHtml — notes search & clickable rows", () => {
  it("renders a client-side search/filter input on the notes view", () => {
    const html = renderCockpitHtml(populated());
    expect(html).toContain('id="notes-search"'); // the filter input.
    expect(html).toContain('type="search"');
    expect(html).toContain('id="notes-tbody"'); // the filtered body.
    // rows carry a pre-joined, lowercased haystack for the substring filter.
    expect(html).toMatch(/data-filter="[^"]*alpha one[^"]*"/);
  });

  it("makes note rows clickable via the open-with target (data-href)", () => {
    // Default mode: a relative file link the client navigates to.
    const html = renderCockpitHtml(populated());
    expect(html).toMatch(/<tr class="row-link" data-href="notes\/a1\.md"/);
    // Obsidian mode: the same row carries the obsidian:// deep-link instead.
    const obs = renderCockpitHtml(populated(), { openWith: "obsidian" });
    expect(obs).toMatch(
      /<tr class="row-link" data-href="obsidian:\/\/open\?vault=my-kb&amp;file=notes%2Fa1\.md"/,
    );
  });
});

// ─── (8) animations — modern, offline, accessibility-gated ────────────────────
//
// The cockpit layers tasteful motion ON TOP of the existing interactivity using
// native, library-free, fully-inline features. These assertions lock in BOTH the
// presence of each animation AND its accessibility gate so a reduced-motion user
// always gets a static, fully-functional dashboard.

describe("renderCockpitHtml — animations", () => {
  it("gates motion on prefers-reduced-motion (CSS damper + JS reduceMotion var)", () => {
    const html = renderCockpitHtml(populated());
    // CSS: motion is wrapped in a no-preference media query AND a reduce damper
    // exists that flattens any animation/transition durations to ~0.
    expect(html).toContain("@media (prefers-reduced-motion: no-preference)");
    expect(html).toContain("@media (prefers-reduced-motion: reduce)");
    expect(html).toMatch(/prefers-reduced-motion: reduce\)\s*\{[^}]*animation-duration:\s*\.001ms/);
    // JS: the client computes a single reduceMotion flag from matchMedia and uses
    // it to skip the JS-driven paths (view transition / bloom / count-up).
    expect(html).toContain("var reduceMotion");
    expect(html).toContain("(prefers-reduced-motion: reduce)");
    expect(html).toContain("matchMedia");
  });

  it("uses the View Transitions API for tab switches, feature-detected", () => {
    const html = renderCockpitHtml(populated());
    // The DOM mutation is factored into applyTab; show() wraps it in a view
    // transition ONLY when supported and motion is allowed — never called blind.
    expect(html).toContain("function applyTab(");
    expect(html).toContain("document.startViewTransition");
    // feature-detected: the guard references startViewTransition before calling it,
    // and reduced-motion short-circuits to the plain applyTab path.
    expect(html).toMatch(/if\s*\(\s*!reduceMotion\s*&&\s*document\.startViewTransition\s*\)/);
    expect(html).toContain("startViewTransition(function(){ applyTab");
    // the main panel area carries a view-transition-name + a crossfade in CSS.
    expect(html).toContain("view-transition-name:mage-main");
    expect(html).toContain("::view-transition-old(mage-main)");
  });

  it("persists the active tab in the URL hash so a reload lands on the same tab", () => {
    const html = renderCockpitHtml(populated());
    // reads the hash on load to pick the initial tab, writes it on switch,
    // and reconciles back/forward via hashchange.
    expect(html).toContain("location.hash");
    expect(html).toContain("history.replaceState");
    expect(html).toContain("hashchange");
    // the initial tab comes from the hash (validated against the real nav), else overview.
    expect(html).toMatch(/show\(\s*tabNames\[initialTab\]\s*\?\s*initialTab\s*:\s*['"]overview['"]\s*\)/);
  });

  it("uses @starting-style entrance animations with linear() spring easing", () => {
    const html = renderCockpitHtml(populated());
    // entrance via @starting-style + transition-behavior: allow-discrete.
    expect(html).toContain("@starting-style");
    expect(html).toContain("transition-behavior:allow-discrete");
    // a linear() easing curve (the spring) is defined and used.
    expect(html).toContain("--spring:linear(");
    expect(html).toMatch(/linear\(0,/);
    // CRITICAL: the resting (non-@starting-style) state is the VISIBLE one — the
    // hidden state lives ONLY inside @starting-style, so unsupported browsers show
    // content. Assert opacity:0 appears only within a @starting-style block.
    expect(html).toMatch(/@starting-style\s*\{[^@]*opacity:0/);
  });

  it("scroll-driven panel reveals are guarded by @supports (animation-timeline)", () => {
    const html = renderCockpitHtml(populated());
    // scroll-driven reveal is feature-detected; unsupported engines ignore it and
    // show static, fully-visible panels.
    expect(html).toContain("@supports (animation-timeline");
    expect(html).toContain("animation-timeline:view()");
    // it lives inside the no-preference gate (reduced-motion never sees it).
    const noPref = html.indexOf("@media (prefers-reduced-motion: no-preference)");
    const supports = html.indexOf("@supports (animation-timeline");
    expect(noPref).toBeGreaterThanOrEqual(0);
    expect(supports).toBeGreaterThan(noPref);
  });

  it("settles the graph (reduced-motion-aware) and counts up the KPIs on first paint", () => {
    const html = renderCockpitHtml(populated());
    // REDUCED MOTION: the graph settles instantly (no animated jiggle) when the
    // user asked for reduced motion — warmupTicks + cooldownTicks(0); otherwise it
    // allows the animated settle then fits on engine stop.
    expect(html).toContain("if (reduceMotion)"); // the graph branches on the flag.
    expect(html).toContain(".cooldownTicks(0)"); // instant settle under reduce.
    expect(html).toContain(".onEngineStop("); // animated path fits after settle.
    expect(html).toContain("zoomToFit("); // whole-graph fit either way.
    // KPI count-up tween, skipped under reduced-motion.
    expect(html).toContain("function countUpKpis(");
    expect(html).toMatch(/function countUpKpis\(\)\s*\{\s*if\s*\(reduceMotion\)\s*return/);
  });

  it("does not regress determinism — animated markup is still byte-stable", () => {
    const a = renderCockpitHtml(populated());
    const b = renderCockpitHtml(populated());
    // Byte-identical output is the determinism guarantee. (The inlined force-graph
    // lib uses Math.random AT RUNTIME for its layout jitter — that is fine and
    // expected; dashboard.html is gitignored — so we assert byte-stability of the
    // generated document rather than the absence of the lib's own randomness.)
    expect(a).toBe(b);
    // html.ts itself must introduce no nondeterminism OUTSIDE the vendored lib: the
    // authored client script (after the inlined lib's own closing </script>) has no
    // Math.random call.
    const authored = a.slice(a.lastIndexOf("<script>"));
    expect(authored).not.toContain("Math.random(");
  });

  it("keeps the cold/empty KB animation-safe (still no external resources)", () => {
    const html = renderCockpitHtml(cold());
    // animations add NO external resources, even on the empty page.
    const protocols = [...html.matchAll(/([a-zA-Z][a-zA-Z0-9+.-]*):\/\//g)].map((m) => m[1]);
    for (const proto of protocols) expect(proto).toBe("obsidian");
    expect(html).not.toContain("http://");
    expect(html).not.toContain("https://");
    // and the gates are still present on the cold page.
    expect(html).toContain("@media (prefers-reduced-motion: reduce)");
    expect(html).toContain("var reduceMotion");
  });
});

// ─── (9) command nudges + reference card ──────────────────────────────────────
//
// The cockpit surfaces small, contextual command nudges (shown when artifacts
// are sparse, hidden when the KB is mature) plus an always-available grouped
// command reference. These assertions lock in: a no-proposals KB gets the
// distill prod in the proposal area; the reference card is always present and
// grouped; a mature KB hides the capture/onboarding nudges; the copy markers
// and nudge selectors exist; and nudges add no external resources.

describe("renderCockpitHtml — command nudges", () => {
  it("appends the proposals nudge commands to the no-proposals empty state", () => {
    const html = renderCockpitHtml(mature());
    // the empty-state hero still reads as before…
    expect(html).toContain("No proposals yet");
    // …and now carries the distill/promote/dream prod as click-to-copy pills.
    expect(html).toContain('data-copy="mage distill"');
    expect(html).toContain('data-copy="mage promote"');
    expect(html).toContain('data-copy="mage dream"');
    // the nudge element/selector the renderer emits.
    expect(html).toContain('data-nudge-panel="proposals"');
  });

  it("does NOT show capture/getting-started/notes/graduate nudges for a mature KB", () => {
    const html = renderCockpitHtml(mature());
    // capture/onboarding nudges vanish past their thresholds (notes>15, skill exists).
    expect(html).not.toContain('data-nudge-panel="getting-started"');
    expect(html).not.toContain('data-nudge-panel="notes"');
    expect(html).not.toContain('data-nudge-panel="skills"'); // graduate + optimize both absent.
    expect(html).not.toContain('data-nudge-panel="connection"'); // scratch>0.
    expect(html).not.toContain('data-nudge-panel="health"'); // graph is clean.
    // NOTE: mage:learn / mage:graduate still appear in the always-present command
    // REFERENCE card — only the contextual NUDGE panels are suppressed, asserted
    // above. The getting-started/notes/skills nudges carry their commands, so
    // their absence (no data-nudge-panel) is the real suppression signal.
  });

  it("shows the getting-started + connection nudges for a cold KB", () => {
    const html = renderCockpitHtml(cold());
    // cold: 0 notes (<=COLD_NOTES) and scratch=0 (capture quiet).
    expect(html).toContain('data-nudge-panel="getting-started"');
    expect(html).toContain('data-nudge-panel="notes"');
    expect(html).toContain('data-nudge-panel="connection"');
    expect(html).toContain('data-copy="mage connect"');
    // and the onboarding command is offered.
    expect(html).toContain('data-copy="mage:learn"');
  });

  it("renders the health nudge in the Health panel when the graph has issues", () => {
    const d = mature();
    d.health = { notesDueForReview: 2, danglingLinks: 1, orphanNotes: 0, lastCommit: null };
    const html = renderCockpitHtml(d);
    expect(html).toContain('data-nudge-panel="health"');
    expect(html).toContain('data-copy="mage dream"');
    expect(html).toContain('data-copy="mage index"');
  });
});

describe("renderCockpitHtml — command reference card", () => {
  it("renders an always-available grouped command reference", () => {
    const html = renderCockpitHtml(mature());
    expect(html).toContain("Command reference");
    // the section group headings.
    for (const g of ["Capture", "Curate", "Maintain", "Setup &amp; health"]) {
      expect(html).toContain(g);
    }
    // a representative command from each group, as a copy pill.
    expect(html).toContain('data-copy="mage dashboard --html"');
    expect(html).toContain('data-copy="mage doctor --fix"');
    // hook-fired observe is never offered.
    expect(html).not.toContain('data-copy="mage observe"');
  });

  it("shows the Hub group only for a hub KB", () => {
    const inRepo = renderCockpitHtml(mature());
    expect(inRepo).not.toContain('data-copy="mage link &lt;hub&gt;"');

    const d = cold();
    d.meta = { ...d.meta, kind: "hub", kbName: "the-hub" };
    const html = renderCockpitHtml(d);
    // <hub> / <repo> placeholders are escaped (&lt;…&gt;) — injection-safe pills.
    expect(html).toContain('data-copy="mage link &lt;hub&gt;"');
    expect(html).toContain('data-copy="mage status &lt;repo&gt;"');
  });

  it("wires the click-to-copy behavior with a graceful clipboard fallback", () => {
    const html = renderCockpitHtml(mature());
    // client copy handler + the marker the headless test can assert.
    expect(html).toContain("function copyCmd(");
    expect(html).toContain("navigator.clipboard");
    expect(html).toContain("writeText");
    // graceful: guarded + never throws (file:// may block the clipboard).
    expect(html).toContain("[data-copy]");
    // the pill advertises the affordance.
    expect(html).toContain('title="click to copy"');
    expect(html).toContain('class="cmd-pill"');
  });

  it("keeps nudges + reference offline and deterministic (no external resources)", () => {
    const a = renderCockpitHtml(mature());
    const b = renderCockpitHtml(mature());
    expect(a).toBe(b); // determinism preserved.
    const protocols = [...a.matchAll(/([a-zA-Z][a-zA-Z0-9+.-]*):\/\//g)].map((m) => m[1]);
    for (const proto of protocols) expect(proto).toBe("obsidian");
    expect(a).not.toContain("http://");
    expect(a).not.toContain("https://");
  });
});
