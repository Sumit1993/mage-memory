// The CENTERPIECE renderer (ADR-0020 tier-2) — a self-contained `dashboard.html`.
//
// `renderCockpitHtml(data)` folds a {@link DashboardData} snapshot into ONE complete,
// offline HTML document: inline CSS + inline SVG + inline vanilla JS, ZERO external
// resources, opens from `file://`. It is a SNAPSHOT — the command gitignores it
// (ADR-0020 §6) — and the hero's [Confirm]/[Skip] buttons are deliberately INERT:
// nothing is ever written or committed from this page; they only reveal the CLI
// command to run, or deep-link into Obsidian (`obsidian://open?…`).
//
// INJECTION SAFETY is a hard requirement (recall the 0.0.8 reword YAML-injection
// defect): EVERY untrusted value (note title, keyword, proposal "why", path, wing
// name) is HTML-escaped before interpolation, and the structured data is embedded as
// a JSON island (`<script type="application/json">`) with `<` escaped so a value
// containing `</script>` cannot break out. No data is ever string-concatenated into
// executable JS.

import { basename } from "node:path";
import { join as posixJoin } from "node:path/posix";
import { GRAPH_LIB_JS } from "./graph-lib.generated.js";
import { commandReference, computeNudges } from "./nudges.js";
import type { Nudge, NudgePanel } from "./nudges.js";
import type {
  DashboardData,
  DashboardGraph,
  DashboardGraphNode,
  DashboardNote,
  DashboardProposal,
  DashboardSkill,
  DashboardWing,
  ProposalKind,
} from "./types.js";

// ─── palette (the validated Option-D cockpit) ─────────────────────────────────

const PALETTE = {
  pageBg: "#0c0c12",
  panelBg: "#14141c",
  border: "#2a2a3c",
  text: "#e7e7f0",
  dim: "#9a9ab2",
} as const;

/** Wing-color cycle, assigned deterministically per wing in scan order. */
const WING_COLORS = ["#a78bfa", "#34d3c0", "#fbbf24", "#f472b6", "#60a5fa", "#a3e635"] as const;

/** Per-action badge colors (graduate also carries a star glyph). */
const ACTION_COLORS: Record<ProposalKind, string> = {
  graduate: "#fbbf24",
  note: "#34d3c0",
  merge: "#a78bfa",
  split: "#60a5fa",
  reword: "#f472b6",
  demote: "#9a9ab2",
};

/** Human label per action kind. */
const ACTION_LABELS: Record<ProposalKind, string> = {
  graduate: "graduate",
  note: "note",
  merge: "merge",
  split: "split",
  reword: "reword",
  demote: "demote",
};

// The graph-"m" mark, inlined in the sidebar (resized via CSS). The verbatim mark
// carries `xmlns="http://www.w3.org/2000/svg"`; inline SVG in an HTML5 document does
// NOT need it (the parser is already in the SVG namespace) and keeping it would put a
// literal `http://` in the offline output — so the xmlns is dropped to keep the
// document strictly resource-URL-free.
const MARK_SVG = `<svg viewBox="0 0 100 100" role="img" aria-label="mage"><title>mage</title>
  <g stroke="#54546f" stroke-width="3.4" stroke-linecap="round" fill="none">
    <line x1="28" y1="42" x2="28" y2="74"/><line x1="28" y1="42" x2="39" y2="31"/><line x1="39" y1="31" x2="50" y2="42"/>
    <line x1="50" y1="42" x2="50" y2="74"/><line x1="50" y1="42" x2="61" y2="31"/><line x1="61" y1="31" x2="72" y2="42"/><line x1="72" y1="42" x2="72" y2="74"/></g>
  <g fill="#cfd0e6"><circle cx="28" cy="42" r="4"/><circle cx="50" cy="42" r="4"/><circle cx="72" cy="42" r="4"/><circle cx="39" cy="31" r="3.4"/><circle cx="61" cy="31" r="3.4"/></g>
  <circle cx="28" cy="74" r="6.5" fill="#a78bfa"/><circle cx="50" cy="74" r="6.5" fill="#34d3c0"/><circle cx="72" cy="74" r="6.5" fill="#fbbf24"/></svg>`;

// ─── escaping (the load-bearing safety primitives) ────────────────────────────

/** HTML-escape a value for interpolation into markup (& < > " '). UNTRUSTED in. */
export function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Build a shallow, sanitized copy of the snapshot for the JSON island. The UI
 * never displays absolute filesystem paths, so we strip the ones the island would
 * otherwise leak: `meta.root` (the absolute KB path) and each
 * `registry[].codePath` (absolute member paths → basename only). Everything the
 * UI renders is kept. The input object is NEVER mutated (immutability).
 */
function sanitizeForIsland(data: DashboardData): DashboardData {
  return {
    ...data,
    meta: { ...data.meta, root: "" },
    ...(data.registry
      ? { registry: data.registry.map((r) => ({ ...r, codePath: basename(r.codePath) })) }
      : {}),
  };
}

/**
 * Serialize the snapshot for the `<script type="application/json">` island. The
 * payload is NOT executable, but we still escape `<` (→ `<`) so a value
 * containing the closing-script sequence `</script>` cannot terminate the element
 * and break out into HTML. Also escape U+2028/U+2029 for defense in depth. The
 * snapshot is sanitized first so absolute filesystem paths never leak.
 */
function jsonIsland(data: DashboardData): string {
  return JSON.stringify(sanitizeForIsland(data))
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}


/** URL-encode a value for an `obsidian://` deep-link query parameter. */
function enc(value: unknown): string {
  return encodeURIComponent(String(value ?? ""));
}

/**
 * Neutralise any `</script` sequence inside an inline script BODY so a substring
 * in the (vendored, minified) source cannot terminate the surrounding
 * `<script>…</script>` element and break out into HTML. Case-insensitive; the
 * `<` is split with a backslash (`<\/script`) which the JS tokenizer ignores
 * inside the script while the HTML parser no longer sees a closing tag. Used only
 * for trusted, generated code (the force-graph UMD) — never for untrusted data.
 */
function escapeScript(js: string): string {
  return js.replace(/<\/script/gi, "<\\/script");
}

// ─── wing color assignment (deterministic, scan order) ────────────────────────

/** Map each wing name to its cycle color, assigned in the data's scan order. */
function wingColorMap(wings: DashboardWing[]): Map<string, string> {
  const m = new Map<string, string>();
  wings.forEach((w, i) => {
    m.set(w.name, WING_COLORS[i % WING_COLORS.length] as string);
  });
  return m;
}

/** Color for a wing name (cross-cutting / unknown → the dim color). */
function colorForWing(name: string, colors: Map<string, string>): string {
  return name && colors.has(name) ? (colors.get(name) as string) : PALETTE.dim;
}

/**
 * Graph node color BY NOTE TYPE — so the graph differentiates decisions / gotchas
 * / plans / principles / … even in a single-wing KB (where wing-color is uniform).
 * Open vocabulary: keys are lowercased; an unknown or empty type → the dim color.
 */
const TYPE_COLORS: Record<string, string> = {
  decision: "#fbbf24",
  gotcha: "#f87171",
  plan: "#60a5fa",
  tasks: "#fb923c",
  spec: "#f472b6",
  principle: "#a78bfa",
  reference: "#34d3c0",
  pointer: "#38bdf8",
  trail: "#c084fc",
  playbook: "#a3e635",
  interface: "#22d3ee",
  tooling: "#84cc16",
  topology: "#818cf8",
  relationship: "#fb7185",
  note: "#94a3b8",
};

/** Color for a note type (case-insensitive; unknown/empty → the dim color). */
function colorForType(type: string): string {
  return TYPE_COLORS[type.trim().toLowerCase()] ?? PALETTE.dim;
}

// ─── obsidian deep-link ───────────────────────────────────────────────────────

/** `obsidian://open?vault=<enc>&file=<enc>` — every component URL-encoded. */
function obsidianLink(vault: string, file: string): string {
  return `obsidian://open?vault=${enc(vault)}&file=${enc(file)}`;
}

// ─── note open-target (ADR-0020 — configurable click-to-open) ─────────────────
//
// A static page CANNOT hand a file to the OS default app — that's a hard browser
// boundary. The realistic targets, smallest footprint first:
//   - `file`     a plain RELATIVE link (the note's relPath). Resolves against the
//                dashboard page's OWN url, so it opens the raw file in whatever
//                browser/OS the page is viewed in — including WSL, where an
//                absolute `file://` or `vscode://` path would be mis-translated.
//                No app, no abs path. The default: "just open the file."
//   - `obsidian` an `obsidian://open?vault&file` deep-link. Robust across OSes
//                because Obsidian resolves it INSIDE the configured vault (no
//                filesystem path travels), but needs Obsidian installed.
//   - `vscode`   a `vscode://file/<abs>` deep-link that opens the file in VS Code.
//                Embeds the absolute path (fine — the cockpit is gitignored,
//                local-only); the path can need WSL-remote translation.
// True OS-default-app open (e.g. notepad) is only reachable with the deferred
// `mage dashboard --serve` local opener — out of core for now.

/** Where clicking a note opens it. */
export type OpenWith = "obsidian" | "vscode" | "file";

/** The three valid `--open-with` values, for CLI validation + help. */
export const OPEN_WITH_TARGETS: readonly OpenWith[] = ["file", "obsidian", "vscode"];

/**
 * Build the click target href for a note. `relFile` is the vault/root-relative
 * posix path (== relPath == obsidianFile); `root` is the absolute docs root (only
 * used by `vscode`). Returns a RAW href string — callers HTML-escape it.
 */
function noteLink(openWith: OpenWith, vault: string, root: string, relFile: string): string {
  switch (openWith) {
    case "vscode":
      // `vscode://file/<abs>` — the abs path already begins with `/`, so a single
      // slash after `file` yields the documented form. Encode per-segment (keep `/`).
      return `vscode://file${encodeURI(posixJoin(root, relFile))}`;
    case "obsidian":
      return obsidianLink(vault, relFile);
    case "file":
    default:
      // Relative link, per-segment encoded (slashes preserved). Opens the raw file
      // from the page's own origin — no scheme, no absolute path, works offline.
      return encodeURI(relFile);
  }
}

// ─── small render helpers ─────────────────────────────────────────────────────

/** A wing color swatch + escaped name chip. */
function wingChip(name: string, colors: Map<string, string>): string {
  const label = name ? escapeHtml(name) : "cross-cutting";
  const color = colorForWing(name, colors);
  return `<span class="chip"><span class="dot" style="background:${color}"></span>${label}</span>`;
}

// ─── command nudges (data-driven, contextual; ADR-0020 cockpit) ───────────────
//
// Nudges are derived purely from the snapshot (see ./nudges.ts). Each renders as
// a small, subtle "tip" box: a lightbulb marker, the `why` line, and one
// monospace, click-to-copy pill per command. EVERY value is escapeHtml'd even
// though the command strings are static literals (defense in depth — the same
// discipline the rest of the renderer follows); the one dynamic value (the
// scratch count in the distill nudge's why text) is a number, never raw HTML.

/**
 * One command, rendered as a click-to-copy monospace pill. The client script's
 * delegated `[data-copy]` handler tries `navigator.clipboard.writeText` and
 * shows a transient "copied" state; it gracefully no-ops where the clipboard is
 * unavailable (e.g. file:// may block it) and NEVER throws — the text stays
 * selectable regardless. `title` + cursor:pointer advertise the affordance.
 */
function commandPill(cmd: string): string {
  const safe = escapeHtml(cmd);
  return `<code class="cmd-pill" data-copy="${safe}" tabindex="0" role="button" title="click to copy">${safe}</code>`;
}

/** Render a single nudge as a subtle tip box (lightbulb + why + command pills). */
function renderNudge(nudge: Nudge): string {
  const pills = nudge.commands.map((c) => commandPill(c)).join(" ");
  return `<div class="nudge" data-nudge-panel="${escapeHtml(nudge.panel)}">
  <svg class="nudge-mark" aria-hidden="true" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18h6"/><path d="M10 21.5h4"/><path d="M12 2.5a6.5 6.5 0 0 0-4 11.6c.6.5 1 1.3 1 2.1v.3h6v-.3c0-.8.4-1.6 1-2.1A6.5 6.5 0 0 0 12 2.5Z"/></svg>
  <div class="nudge-body">
    <div class="nudge-why">${escapeHtml(nudge.why)}</div>
    <div class="nudge-cmds">${pills}</div>
  </div>
</div>`;
}

/** The nudge mounted in a given panel (or "" when none applies — suppressed). */
function nudgeHtmlFor(nudges: Nudge[], panel: NudgePanel): string {
  const found = nudges.find((n) => n.panel === panel);
  return found ? renderNudge(found) : "";
}

/**
 * The always-available grouped command reference card. Mostly constant — the Hub
 * group is appended only for a hub KB (see ./nudges.ts). Each row is a
 * click-to-copy command pill plus a one-line description; everything escaped.
 */
function renderCommandReference(data: DashboardData): string {
  const groups = commandReference(data)
    .map((g) => {
      const rows = g.items
        .map(
          (i) =>
            `<div class="cmd-ref-row">${commandPill(i.cmd)}<span class="cmd-ref-desc">${escapeHtml(i.desc)}</span></div>`,
        )
        .join("");
      return `<div class="cmd-ref-group">
  <div class="cmd-ref-heading">${escapeHtml(g.group)}</div>
  ${rows}
</div>`;
    })
    .join("");

  return `<section class="panel">
  <h3>Command reference <span class="caption-inline">(click any command to copy)</span></h3>
  <div class="cmd-ref-grid">${groups}</div>
</section>`;
}

// ─── KPI row ──────────────────────────────────────────────────────────────────

function renderKpis(data: DashboardData): string {
  const k = data.kpis;
  // Each KPI card is a button-like element that navigates to the tab where its
  // number can be acted on (owner complaint #1: cards did nothing when clicked).
  // The `goto` is wired to the SAME delegated [data-goto-tab] handler the Overview
  // graph-teaser uses, so the click switches tabs via show(). Cards are keyboard-
  // accessible (role=button + tabindex; the client handles Enter/Space).
  const cards: Array<[string, number | string, string]> = [
    ["notes", k.notes, "notes"],
    ["skills", k.skills, "skills"],
    ["wings", k.wings, "wings"],
    ["context-match", `${k.contextMatchPct}%`, "skills"],
    ["awaiting you", k.awaitingYou, "overview"],
    ["ready to graduate", k.graduateReady, "overview"],
  ];
  const items = cards
    .map(
      ([label, value, goto]) =>
        `<div class="kpi" role="button" tabindex="0" data-goto-tab="${escapeHtml(goto)}" aria-label="${escapeHtml(label)} — open the ${escapeHtml(goto)} tab"><div class="kpi-value">${escapeHtml(value)}</div><div class="kpi-label">${escapeHtml(label)}</div></div>`,
    )
    .join("");
  return `<div class="kpi-row">${items}</div>`;
}

// ─── HERO: the proposal queue ─────────────────────────────────────────────────

function renderProposalItem(
  p: DashboardProposal,
  vault: string,
  root: string,
  colors: Map<string, string>,
  openWith: OpenWith,
): string {
  const kind: ProposalKind = (p.kind in ACTION_COLORS ? p.kind : "note") as ProposalKind;
  const badgeColor = ACTION_COLORS[kind];
  const star = kind === "graduate" ? "&#9733; " : "";
  const label = ACTION_LABELS[kind];

  // The "why" line: wing | evidence | recurrence-bearing rationale. The wing is
  // shown as a color-coded chip (color assigned deterministically per wing).
  const whyParts: string[] = [];
  if (p.wing) whyParts.push(wingChip(p.wing, colors));
  if (p.why) whyParts.push(escapeHtml(p.why));
  const why = whyParts.join(" &middot; ");

  // The target may be a note relPath (graduate/merge/split/reword) — link it via
  // the same `--open-with` target the graph + Notes table use when it looks like a
  // markdown path; otherwise show it inert (a "note" proposal's target is a
  // signature, not a file).
  const isNotePath = /\.md$/i.test(p.target);
  const targetHtml = isNotePath
    ? `<a class="target" href="${escapeHtml(noteLink(openWith, vault, root, p.target))}">${escapeHtml(p.target)}</a>`
    : `<span class="target">${escapeHtml(p.target)}</span>`;

  // The CLI hint the (inert) Confirm button reveals — never claims it ran.
  const cliHint = `mage dream --apply  # then review the diff &amp; commit yourself`;

  return `<li class="proposal">
  <span class="badge" style="background:${badgeColor}">${star}${escapeHtml(label)}</span>
  <div class="proposal-body">
    <div class="proposal-target">${targetHtml}</div>
    <div class="proposal-why">${why || "<span class='muted'>no rationale recorded</span>"}</div>
    <div class="cli-hint" hidden>to apply, run: <code>${cliHint}</code></div>
  </div>
  <div class="proposal-actions">
    <button type="button" class="btn btn-confirm" data-reveal>Confirm</button>
    <button type="button" class="btn btn-skip" data-skip>Skip</button>
  </div>
</li>`;
}

function renderHero(data: DashboardData, proposalsNudge: string, openWith: OpenWith): string {
  const colors = wingColorMap(data.wings);
  const vault = data.meta.kbName;
  const root = data.meta.root;
  const title =
    "Awaiting your judgment &mdash; mage proposes, you confirm &amp; commit " +
    "(nothing is written until you say so, nothing committed ever)";

  if (data.proposals.length === 0) {
    // The empty state appends the proposals nudge's commands so the owner is told
    // HOW to generate candidates right where they expected to find them.
    return `<section class="panel hero">
  <h2 class="hero-title">${title}</h2>
  <div class="empty">No proposals yet &mdash; mage is still learning.</div>
  ${proposalsNudge}
</section>`;
  }

  const items = data.proposals
    .map((p) => renderProposalItem(p, vault, root, colors, openWith))
    .join("\n");
  return `<section class="panel hero">
  <h2 class="hero-title">${title}</h2>
  <ul class="proposal-queue">
${items}
  </ul>
</section>`;
}

// ─── knowledge graph: force-graph (Canvas + d3-force), Obsidian-bridged ───────
//
// The graph is rendered CLIENT-SIDE by the vendored `force-graph` library (Canvas,
// d3-force) — inlined into the document (see GRAPH_LIB_JS / escapeScript), so the
// page stays self-contained and offline (ADR-0020). The server pre-computes
// everything as PLAIN DATA in a dedicated, sanitised JSON island (`#mage-graph`):
// enriched nodes (title/type/wing/keywords/color/obsidian link + a deterministic
// golden-angle seed position so the layout is stable on first paint) and edges (as
// node-index pairs). force-graph operates on the PARSED data — no `innerHTML` ever
// touches note content.
//
// SAFETY: this island is data, never code. Like `#mage-data` it serializes with
// `<` escaped (see `graphIsland`). Labels are drawn on the canvas via
// `ctx.fillText` (text, not markup) and the info panel is set via `textContent`
// only — never `innerHTML`. The obsidian link is built server-side with the SAME
// vault+file encoding the Notes table uses; clicking a node navigates to it.

/** The graph's seed viewport (golden-angle seed space; force-graph re-fits at runtime). */
const GRAPH_W = 760;
const GRAPH_H = 480;
/** Preview cap — keep the embedded, simulated graph small enough to stay snappy. */
const GRAPH_NODE_CAP = 120;

/** One enriched node the client renders: identity + display fields + seed xy. */
interface GraphClientNode {
  id: string;
  wing: string;
  title: string;
  type: string;
  keywords: string[];
  color: string;
  /** The click-to-open href — relative file link / obsidian:// / vscode:// per
   *  `--open-with`. Built with the SAME `noteLink` the Notes table uses. */
  href: string;
  /** Deterministic golden-angle seed position (relaxed client-side). */
  x: number;
  y: number;
  /** Graph degree (in+out), for radius sizing. */
  degree: number;
}

/** The whole client-graph payload embedded in the `#mage-graph` island. */
interface GraphClientData {
  w: number;
  h: number;
  nodes: GraphClientNode[];
  /** Edges as [sourceIndex, targetIndex] into `nodes` (compact + index-stable). */
  edges: Array<[number, number]>;
  /** note-type → color, for the legend (built client-side via textContent). */
  legend: Array<{ label: string; color: string }>;
}

/**
 * Fold the preview graph + the notes list into the plain-data payload the client
 * force-graph renders. Joins each graph node (id == relPath) to its note for
 * title/type/keywords; degree is counted from kept edges; seed positions are a
 * DETERMINISTIC golden-angle spiral by node index (no Math.random — the output
 * stays test-stable; the client relaxes these with the force sim). Pure: builds a
 * fresh object, never mutates inputs.
 */
function buildGraphClientData(
  graph: DashboardGraph,
  notes: DashboardNote[],
  vault: string,
  openWith: OpenWith,
  root: string,
): GraphClientData {
  const kept: DashboardGraphNode[] = graph.nodes.slice(0, GRAPH_NODE_CAP);
  const indexById = new Map<string, number>();
  kept.forEach((n, i) => indexById.set(n.id, i));

  // Note lookup by relPath, for title/type/keywords/obsidianFile.
  const noteById = new Map<string, DashboardNote>();
  for (const n of notes) noteById.set(n.relPath, n);

  // Edges that connect two kept nodes, as index pairs; dedupe; count degree.
  const edges: Array<[number, number]> = [];
  const seenEdge = new Set<string>();
  const degree = new Array<number>(kept.length).fill(0);
  for (const e of graph.edges) {
    const s = indexById.get(e.source);
    const t = indexById.get(e.target);
    if (s === undefined || t === undefined || s === t) continue;
    const key = s < t ? `${s}|${t}` : `${t}|${s}`;
    if (seenEdge.has(key)) continue;
    seenEdge.add(key);
    edges.push([s, t]);
    degree[s] = (degree[s] ?? 0) + 1;
    degree[t] = (degree[t] ?? 0) + 1;
  }

  // Deterministic golden-angle spiral seed inside the viewBox (relaxed later).
  const GOLDEN = Math.PI * (3 - Math.sqrt(5)); // ≈ 2.39996 rad
  const cx = GRAPH_W / 2;
  const cy = GRAPH_H / 2;
  const maxR = Math.min(GRAPH_W, GRAPH_H) / 2 - 28;

  const nodes: GraphClientNode[] = kept.map((n, i) => {
    const note = noteById.get(n.id);
    const angle = i * GOLDEN;
    const r = kept.length <= 1 ? 0 : maxR * Math.sqrt((i + 0.5) / kept.length);
    return {
      id: n.id,
      wing: n.wing,
      title: note?.title ?? n.id,
      type: note?.type ?? "",
      keywords: note?.keywords ?? [],
      color: colorForType(note?.type ?? ""),
      href: noteLink(openWith, vault, root, note?.obsidianFile ?? n.id),
      x: Number((cx + r * Math.cos(angle)).toFixed(2)),
      y: Number((cy + r * Math.sin(angle)).toFixed(2)),
      degree: degree[i] ?? 0,
    };
  });

  // Legend: only the note TYPES that actually appear among graph nodes, sorted.
  const legend: Array<{ label: string; color: string }> = [];
  const seenType = new Set<string>();
  for (const n of nodes) {
    const label = n.type || "untyped";
    if (seenType.has(label)) continue;
    seenType.add(label);
    legend.push({ label, color: n.color });
  }
  legend.sort((a, b) => a.label.localeCompare(b.label));

  return { w: GRAPH_W, h: GRAPH_H, nodes, edges, legend };
}

/**
 * Serialize the client-graph payload for its `<script type="application/json">`
 * island. Same neutralisation as {@link jsonIsland}: escape `<` so a value
 * containing `</script>` can't break out, plus the U+2028/U+2029 line separators.
 */
function graphIsland(data: GraphClientData): string {
  return JSON.stringify(data)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

/**
 * Render the Graph TAB host: the FIXED-HEIGHT force-graph stage + the data island
 * the client reads. The stage is an empty mount (`#mage-graph-stage`) that the
 * client wires force-graph into; pan/zoom happen INTERNALLY (the stage clips its
 * overflow, so the graph NEVER grows the page — owner complaint #2). Overlaid:
 * three zoom buttons (+ / − / fit, complaint #5), the info panel, and a legend
 * mount. 0–2 nodes are handled by the client (force-graph settles them fine).
 *
 * @param compact when true, render the small Overview teaser (a "see Graph tab"
 *   hint) instead of the full host — the data island is emitted once (by the full
 *   host) so both views share it.
 */
function renderGraph(graph: DashboardGraph, opts: { compact?: boolean } = {}): string {
  if (graph.nodes.length === 0) {
    // Same empty state in both views (compact teaser and full host): nothing to draw.
    return `<section class="panel">
  <h3>Knowledge graph</h3>
  <div class="empty">No notes to graph yet.</div>
  <div class="caption">Preview &mdash; the full, editable graph lives in Obsidian (click a node to open it).</div>
</section>`;
  }

  if (opts.compact) {
    // Overview teaser: a single line nudging to the full Graph tab.
    return `<section class="panel">
  <h3>Knowledge graph <span class="caption-inline">(${escapeHtml(graph.nodes.length)} notes)</span></h3>
  <div class="graph-teaser">An interactive, force-directed preview lives in the <button type="button" class="link-btn" data-goto-tab="graph">Graph</button> tab &mdash; labels are always on; zoom/pan internally, click a node to open it in Obsidian.</div>
  <div class="caption">Preview &mdash; the full, editable graph lives in Obsidian (click a node to open it).</div>
</section>`;
  }

  // The full-size interactive host. `#mage-graph-stage` is the FIXED-HEIGHT,
  // overflow-clipped Canvas mount the client sizes force-graph into; the info
  // panel + legend + zoom controls overlay it. role/aria describe it.
  return `<section class="panel graph-panel">
  <h3>Knowledge graph <span class="caption-inline">(zoom/pan internally &mdash; labels on, click to open)</span></h3>
  <div class="graph-wrap">
    <div id="mage-graph-stage" class="graph-stage" role="img" aria-label="interactive note link graph"></div>
    <div class="graph-zoom" role="group" aria-label="graph zoom controls">
      <button type="button" id="graph-zoom-in" class="zoom-btn" title="zoom in" aria-label="zoom in">+</button>
      <button type="button" id="graph-zoom-out" class="zoom-btn" title="zoom out" aria-label="zoom out">&minus;</button>
      <button type="button" id="graph-zoom-fit" class="zoom-btn" title="fit to view" aria-label="fit graph to view">&#10303;</button>
    </div>
    <div id="graph-info" class="graph-info" hidden aria-live="polite">
      <div class="gi-title"></div>
      <div class="gi-meta"></div>
      <div class="gi-keywords"></div>
      <div class="gi-hint">click to open in Obsidian</div>
    </div>
    <div id="graph-legend" class="graph-legend" aria-label="node type colors"></div>
  </div>
  <div class="caption">Preview &mdash; the full, editable graph lives in Obsidian (click a node to open it).</div>
</section>`;
}

// ─── durability ladder ────────────────────────────────────────────────────────

function renderLadder(data: DashboardData, ladderNudge = ""): string {
  const l = data.ladder;
  const climbing =
    l.climbing.length > 0
      ? l.climbing
          .map(
            (c) =>
              `<li class="climb">climbing: <strong>${escapeHtml(c.count)}</strong> signature${c.count === 1 ? "" : "s"} at <strong>${escapeHtml(c.sessions)}</strong> sessions</li>`,
          )
          .join("")
      : `<li class="climb muted">nothing climbing yet &mdash; signatures appear here as they recur.</li>`;

  const rung = (label: string, value: number, color: string): string =>
    `<div class="rung"><span class="rung-dot" style="background:${color}"></span><span class="rung-label">${escapeHtml(label)}</span><span class="rung-value">${escapeHtml(value)}</span></div>`;

  return `<section class="panel">
  <h3>Durability ladder</h3>
  <div class="ladder">
    ${rung("scratch", l.scratch, PALETTE.dim)}
    <span class="ladder-arrow">&rarr;</span>
    ${rung("notes", l.notes, "#34d3c0")}
    <span class="ladder-arrow">&rarr;</span>
    ${rung("skills", l.skills, "#fbbf24")}
  </div>
  <ul class="climbing">${climbing}</ul>
  ${ladderNudge}
</section>`;
}

// ─── activity strip (week grid) ───────────────────────────────────────────────

function renderActivity(data: DashboardData): string {
  const activity = data.activity;
  if (activity.length === 0) {
    return `<section class="panel">
  <h3>Activity</h3>
  <div class="empty">No dated activity yet.</div>
</section>`;
  }

  // Bucket per ISO week. Degrade gracefully when dates are sparse — render only the
  // weeks we actually have, in ascending order.
  const byWeek = new Map<string, { created: number; reviewed: number }>();
  for (const a of activity) {
    const wk = isoWeekKey(a.date);
    const cur = byWeek.get(wk) ?? { created: 0, reviewed: 0 };
    byWeek.set(wk, { created: cur.created + a.created, reviewed: cur.reviewed + a.reviewed });
  }
  const weeks = [...byWeek.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const max = Math.max(1, ...weeks.map(([, v]) => v.created + v.reviewed));

  const cells = weeks
    .map(([wk, v]) => {
      const total = v.created + v.reviewed;
      const intensity = total / max; // 0..1
      const alpha = (0.15 + 0.85 * intensity).toFixed(2);
      const tip = `${wk}: ${v.created} created, ${v.reviewed} reviewed`;
      return `<div class="week-cell" style="background:rgba(167,139,250,${alpha})" title="${escapeHtml(tip)}"></div>`;
    })
    .join("");

  return `<section class="panel">
  <h3>Activity <span class="caption-inline">(creation &amp; review, by week)</span></h3>
  <div class="week-grid">${cells}</div>
</section>`;
}

/** ISO-week key `YYYY-Www` for a `YYYY-MM-DD` date; falls back to the raw date. */
function isoWeekKey(isoDate: string): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return isoDate;
  // ISO 8601 week number (Thursday-based).
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day + 3);
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const week =
    1 +
    Math.round(
      ((d.getTime() - firstThursday.getTime()) / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) /
        7,
    );
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

// ─── health & provenance ──────────────────────────────────────────────────────

function renderHealth(data: DashboardData, now: Date, healthNudge = ""): string {
  const h = data.health;
  const commit = h.lastCommit
    // `relativeTime` already returns HTML-safe text: its normal returns
    // ("N units ago"/"just now") contain no HTML specials, and its unparseable
    // fallback escapeHtml's the raw value itself. Wrapping it in another
    // escapeHtml would double-encode a malformed `when`, so it is NOT wrapped.
    ? `<code>${escapeHtml(h.lastCommit.hash.slice(0, 8))}</code> &middot; ${relativeTime(h.lastCommit.when, now)}`
    : `<span class="muted">not a git repo</span>`;

  const stat = (label: string, value: number | string): string =>
    `<div class="health-stat"><span class="health-value">${escapeHtml(value)}</span><span class="health-label">${escapeHtml(label)}</span></div>`;

  return `<section class="panel">
  <h3>Health &amp; provenance <span class="caption-inline">(read-only)</span></h3>
  <div class="health-grid">
    ${stat("due for review", h.notesDueForReview)}
    ${stat("dangling links", h.danglingLinks)}
    ${stat("orphan notes", h.orphanNotes)}
  </div>
  <div class="provenance">last commit: ${commit}</div>
  ${healthNudge}
</section>`;
}

/** A coarse "N units ago" string from an ISO instant; "" when unparseable. */
function relativeTime(iso: string, now: Date): string {
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return escapeHtml(iso);
  const secs = Math.max(0, Math.floor((now.getTime() - then.getTime()) / 1000));
  const units: Array<[string, number]> = [
    ["year", 31536000],
    ["month", 2592000],
    ["week", 604800],
    ["day", 86400],
    ["hour", 3600],
    ["minute", 60],
  ];
  for (const [name, size] of units) {
    const n = Math.floor(secs / size);
    if (n >= 1) return `${n} ${name}${n === 1 ? "" : "s"} ago`;
  }
  return "just now";
}

// ─── wings tab ────────────────────────────────────────────────────────────────

function renderWings(data: DashboardData, colors: Map<string, string>): string {
  if (data.wings.length === 0) {
    return `<section class="panel"><h3>Wings</h3><div class="empty">No wings yet.</div></section>`;
  }
  const rows = data.wings
    .map((w) => {
      const color = colorForWing(w.name, colors);
      const rooms = w.rooms && w.rooms.length > 0 ? w.rooms.map((r) => escapeHtml(r)).join(", ") : "&mdash;";
      return `<tr>
  <td><span class="dot" style="background:${color}"></span>${escapeHtml(w.name)}</td>
  <td>${escapeHtml(w.noteCount)}</td>
  <td>${escapeHtml(w.skillCount)}</td>
  <td class="muted">${rooms}</td>
</tr>`;
    })
    .join("");
  return `<section class="panel">
  <h3>Wings</h3>
  <table class="data-table">
    <thead><tr><th>wing</th><th>notes</th><th>skills</th><th>rooms</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
</section>`;
}

// ─── notes tab ────────────────────────────────────────────────────────────────

function renderNotes(
  data: DashboardData,
  colors: Map<string, string>,
  openWith: OpenWith,
): string {
  if (data.notes.length === 0) {
    return `<section class="panel"><h3>Notes</h3><div class="empty">No notes yet.</div></section>`;
  }
  const vault = data.meta.kbName;
  const root = data.meta.root;
  const rows = data.notes.map((n) => renderNoteRow(n, vault, root, colors, openWith)).join("");
  // The search input filters rows CLIENT-SIDE by title/keyword/wing (textContent
  // match — see filterNotes() in script()). id is the stable hook the test asserts.
  return `<section class="panel">
  <h3>Notes <span class="caption-inline">(<span id="notes-count">${escapeHtml(data.notes.length)}</span>)</span></h3>
  <input type="search" id="notes-search" class="search-input" placeholder="Filter notes by title, keyword, or wing…" aria-label="Filter notes" autocomplete="off"/>
  <table class="data-table">
    <thead><tr><th>title</th><th>type</th><th>wing</th><th>keywords</th></tr></thead>
    <tbody id="notes-tbody">${rows}</tbody>
  </table>
  <div id="notes-empty" class="empty" hidden>No notes match your filter.</div>
</section>`;
}

function renderNoteRow(
  n: DashboardNote,
  vault: string,
  root: string,
  colors: Map<string, string>,
  openWith: OpenWith,
): string {
  const link = escapeHtml(noteLink(openWith, vault, root, n.obsidianFile));
  const keywords =
    n.keywords.length > 0
      ? n.keywords.map((k) => `<span class="kw">${escapeHtml(k)}</span>`).join(" ")
      : `<span class="muted">&mdash;</span>`;
  // data-filter carries a lowercased, pre-joined haystack (title + keywords + wing
  // + type) so the client filter is a cheap substring test, never innerHTML. The
  // whole row is clickable (the title <a> drives navigation; clickable-row CSS adds
  // the cursor + hover highlight).
  const haystack = [n.title, ...n.keywords, n.wing, n.type].join(" ").toLowerCase();
  return `<tr class="row-link" data-href="${link}" data-filter="${escapeHtml(haystack)}">
  <td><a href="${link}">${escapeHtml(n.title)}</a></td>
  <td class="muted">${escapeHtml(n.type)}</td>
  <td>${wingChip(n.wing, colors)}</td>
  <td>${keywords}</td>
</tr>`;
}

// ─── skills tab ───────────────────────────────────────────────────────────────

function renderSkills(data: DashboardData): string {
  if (data.skills.length === 0) {
    return `<section class="panel"><h3>Skills</h3><div class="empty">No skills yet &mdash; notes graduate into skills as they prove out.</div></section>`;
  }
  const rows = data.skills.map((s) => renderSkillRow(s)).join("");
  return `<section class="panel">
  <h3>Skills <span class="caption-inline">(${escapeHtml(data.skills.length)})</span></h3>
  <table class="data-table">
    <thead><tr><th>skill</th><th>wing</th><th>context-match</th><th>status</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
</section>`;
}

function renderSkillRow(s: DashboardSkill): string {
  const match = typeof s.contextMatchPct === "number" ? `${escapeHtml(s.contextMatchPct)}%` : `<span class="muted">&mdash;</span>`;
  const status = s.status ? escapeHtml(s.status) : `<span class="muted">&mdash;</span>`;
  const wing = s.wing ? escapeHtml(s.wing) : `<span class="muted">&mdash;</span>`;
  // Skills carry no vault path in the data contract (name/wing/match/status only),
  // so the row is highlight-on-hover but not click-to-open — fabricating an
  // obsidian path would risk a broken deep-link. The hover affordance still lifts
  // the row above "static".
  return `<tr class="row-hover">
  <td>${escapeHtml(s.name)}</td>
  <td>${wing}</td>
  <td>${match}</td>
  <td class="muted">${status}</td>
</tr>`;
}

// ─── soak / registry tab ──────────────────────────────────────────────────────

/**
 * The autonomy keep-rate tile (ADR-0031 P2): the crown signal over `source === "capture"`
 * terminals only. "" (no panel) when there is no keep-rate cohort yet — mirrors the nudge line,
 * which also hides until a capture terminal exists.
 */
function renderKeepRate(data: DashboardData): string {
  const k = data.keepRate;
  if (!k) return "";
  const pct = Math.round(k.rate * 100);
  const threshold = k.threshold !== null ? `${Math.round(k.threshold * 100)}%` : "unset";
  const stat = (label: string, value: number): string =>
    `<div class="rung"><span class="rung-label">${escapeHtml(label)}</span><span class="rung-value">${escapeHtml(value)}</span></div>`;
  return `<section class="panel">
  <h3>Autonomy keep-rate <span class="caption-inline">(capture cohort &mdash; ADR-0031)</span></h3>
  <div class="ladder">
    <span class="rung-value" style="font-size:22px;font-weight:700">${escapeHtml(pct)}%</span>
    <span class="caption-inline">of ${escapeHtml(k.terminals)} autonomous note${k.terminals === 1 ? "" : "s"} kept &middot; threshold ${escapeHtml(threshold)}</span>
  </div>
  <div class="ladder">
    ${stat("keep", k.keep)}
    ${stat("edited", k.edited)}
    ${stat("discard", k.discard)}
    ${stat("reject", k.reject)}
  </div>
</section>`;
}

function renderSoak(data: DashboardData, connectionNudge: string, ladderNudge: string): string {
  const registry = data.registry;
  const ladder = renderLadder(data, ladderNudge); // ladder + climbing is the soak signal too.
  const keepRate = renderKeepRate(data); // the autonomy crown signal sits beside the ladder.
  // The always-available command reference lives in the Soak tab (the cockpit's
  // reference shelf), with the connection nudge near it when capture is quiet.
  const reference = renderCommandReference(data);
  const connection = connectionNudge
    ? `<section class="panel"><h3>Connection</h3>${connectionNudge}</section>`
    : "";

  let registryHtml = "";
  if (registry && registry.length > 0) {
    const rows = registry
      .map((r) => {
        const repo = r.repoUrl ? escapeHtml(r.repoUrl) : `<span class="muted">&mdash;</span>`;
        const cloned = r.cloned ? "cloned" : "not cloned";
        return `<tr>
  <td>${escapeHtml(r.name)}</td>
  <td class="muted">${repo}</td>
  <td>${escapeHtml(cloned)}</td>
</tr>`;
      })
      .join("");
    registryHtml = `<section class="panel">
  <h3>Hub registry <span class="caption-inline">(pointers only &mdash; never remote content)</span></h3>
  <table class="data-table">
    <thead><tr><th>member</th><th>repo</th><th>local</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
</section>`;
  } else if (registry) {
    registryHtml = `<section class="panel"><h3>Hub registry</h3><div class="empty">No registered members.</div></section>`;
  }

  // Tab show/hide is driven entirely by the OUTER `[data-tab-section="soak"]`
  // wrapper in renderCockpitHtml; the inner panels carry no per-tab attribute, so
  // the ladder is reused as-is (no brittle string-replace).
  return `${ladder}\n${keepRate}\n${registryHtml}\n${connection}\n${reference}`;
}

// ─── inline CSS ───────────────────────────────────────────────────────────────

function styles(): string {
  return `
*{box-sizing:border-box}
:root{--spring:linear(0,0.006,0.025,0.101,0.539 26.7%,0.802,0.95,1.001,0.997,1);--ease-out:cubic-bezier(.16,1,.3,1)}
body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;background:${PALETTE.pageBg};color:${PALETTE.text};font-size:14px;line-height:1.5}
.layout{display:grid;grid-template-columns:220px 1fr;min-height:100vh}
.sidebar{background:${PALETTE.panelBg};border-right:1px solid ${PALETTE.border};padding:20px 16px;display:flex;flex-direction:column}
.brand{display:flex;align-items:center;gap:10px;margin-bottom:24px}
.brand svg{width:38px;height:38px}
.brand-name{font-size:20px;font-weight:700;letter-spacing:.5px}
.nav{display:flex;flex-direction:column;gap:4px}
.nav button{background:transparent;border:none;color:${PALETTE.dim};text-align:left;padding:8px 12px;border-radius:6px;cursor:pointer;font-size:14px;transition:background .18s var(--ease-out),color .18s var(--ease-out)}
.nav button:hover{background:rgba(255,255,255,.04);color:${PALETTE.text}}
.nav button.active{background:rgba(167,139,250,.15);color:${PALETTE.text}}
.sidebar-footer{margin-top:auto;padding-top:16px;color:${PALETTE.dim};font-size:11px;border-top:1px solid ${PALETTE.border};word-break:break-word}
.main{padding:24px 28px;overflow-x:hidden}
.panel{background:${PALETTE.panelBg};border:1px solid ${PALETTE.border};border-radius:10px;padding:18px 20px;margin-bottom:18px}
.panel h2,.panel h3{margin:0 0 14px}
.panel h3{font-size:15px}
.caption{color:${PALETTE.dim};font-size:12px;margin-top:10px}
.caption-inline{color:${PALETTE.dim};font-size:12px;font-weight:400}
.muted{color:${PALETTE.dim}}
.empty{color:${PALETTE.dim};padding:14px;text-align:center;font-style:italic}
.kpi-row{display:grid;grid-template-columns:repeat(6,1fr);gap:12px;margin-bottom:18px}
.kpi{background:${PALETTE.panelBg};border:1px solid ${PALETTE.border};border-radius:10px;padding:14px 16px;cursor:pointer;transition:border-color .18s var(--ease-out),transform .25s var(--spring),box-shadow .18s var(--ease-out)}
.kpi:hover{border-color:#54546f;transform:translateY(-2px);box-shadow:0 8px 20px rgba(0,0,0,.35)}
.kpi:focus-visible{outline:none;border-color:#a78bfa;box-shadow:0 0 0 2px rgba(167,139,250,.4)}
.kpi:active{transform:translateY(0) scale(.99)}
.kpi-value{font-size:26px;font-weight:700}
.kpi-label{color:${PALETTE.dim};font-size:12px;margin-top:4px}
.hero{border-color:rgba(251,191,36,.4)}
.hero-title{font-size:16px;font-weight:600}
.proposal-queue{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:10px}
.proposal{display:flex;gap:14px;align-items:flex-start;background:rgba(255,255,255,.02);border:1px solid ${PALETTE.border};border-radius:8px;padding:12px 14px;transition:border-color .18s var(--ease-out),background .18s var(--ease-out),transform .25s var(--spring),box-shadow .18s var(--ease-out)}
.proposal:hover{border-color:#54546f;background:rgba(255,255,255,.04);transform:translateY(-2px);box-shadow:0 6px 16px rgba(0,0,0,.3)}
.badge{display:inline-block;color:#0c0c12;font-weight:700;font-size:12px;padding:3px 10px;border-radius:20px;white-space:nowrap}
.proposal-body{flex:1;min-width:0}
.proposal-target{font-weight:600;word-break:break-word}
.proposal-target a,.data-table a{color:#a78bfa;text-decoration:none}
.proposal-target a:hover,.data-table a:hover{text-decoration:underline}
.proposal-why{color:${PALETTE.dim};font-size:13px;margin-top:4px;word-break:break-word}
.cli-hint{color:${PALETTE.dim};font-size:12px;margin-top:8px}
.cli-hint code{background:rgba(255,255,255,.06);padding:2px 6px;border-radius:4px;color:${PALETTE.text}}
.proposal-actions{display:flex;flex-direction:column;gap:6px}
.btn{border:1px solid ${PALETTE.border};border-radius:6px;padding:6px 14px;cursor:pointer;font-size:13px;transition:border-color .18s var(--ease-out),background .18s var(--ease-out),transform .2s var(--spring)}
.btn-confirm{background:rgba(52,211,192,.15);color:#34d3c0}
.btn-skip{background:transparent;color:${PALETTE.dim}}
.btn:hover{border-color:#54546f}
.btn:active{transform:scale(.96)}
.chip{display:inline-flex;align-items:center;gap:6px}
.dot{width:9px;height:9px;border-radius:50%;display:inline-block}
.graph-panel .graph-wrap{position:relative}
.graph-teaser{color:${PALETTE.text};font-size:13px}
.link-btn{background:rgba(167,139,250,.15);color:#c4b5fd;border:1px solid ${PALETTE.border};border-radius:6px;padding:1px 8px;cursor:pointer;font-size:13px}
.link-btn:hover{border-color:#54546f;color:${PALETTE.text}}
/* FIXED-HEIGHT graph stage: force-graph mounts a Canvas here; pan/zoom happen
   INTERNALLY and overflow is clipped so the graph never grows the page. */
.graph-stage{position:relative;height:min(68vh,620px);overflow:hidden;border-radius:8px;background:rgba(0,0,0,.2);touch-action:none}
.graph-stage canvas{display:block}
.graph-zoom{position:absolute;top:10px;left:10px;display:flex;flex-direction:column;gap:6px;z-index:2}
.zoom-btn{width:30px;height:30px;display:flex;align-items:center;justify-content:center;background:rgba(12,12,18,.9);border:1px solid #54546f;border-radius:6px;color:${PALETTE.text};font-size:16px;line-height:1;cursor:pointer;transition:border-color .18s var(--ease-out),background .18s var(--ease-out)}
.zoom-btn:hover{border-color:#a78bfa;background:rgba(167,139,250,.18)}
.zoom-btn:active{transform:scale(.94)}
.zoom-btn:focus-visible{outline:none;border-color:#a78bfa;box-shadow:0 0 0 2px rgba(167,139,250,.4)}
.graph-info{position:absolute;top:10px;right:10px;max-width:260px;background:rgba(12,12,18,.94);border:1px solid #54546f;border-radius:8px;padding:10px 12px;font-size:12px;pointer-events:none;box-shadow:0 6px 20px rgba(0,0,0,.4);z-index:2}
.graph-info .gi-title{font-weight:700;font-size:13px;word-break:break-word}
.graph-info .gi-meta{color:${PALETTE.dim};margin-top:3px}
.graph-info .gi-keywords{margin-top:6px;display:flex;flex-wrap:wrap;gap:4px}
.graph-info .gi-keywords .kw{font-size:11px}
.graph-info .gi-hint{color:${PALETTE.dim};margin-top:8px;font-style:italic}
.graph-legend{display:flex;flex-wrap:wrap;gap:10px;margin-top:10px;position:relative;z-index:1}
.graph-legend .leg{display:inline-flex;align-items:center;gap:6px;font-size:12px;color:${PALETTE.dim}}
.search-input{width:100%;margin-bottom:12px;background:rgba(0,0,0,.25);border:1px solid ${PALETTE.border};border-radius:6px;padding:8px 10px;color:${PALETTE.text};font-size:13px}
.search-input:focus{outline:none;border-color:#54546f}
.search-input::placeholder{color:${PALETTE.dim}}
tr.row-link{cursor:pointer}
.data-table tr{transition:background .15s var(--ease-out)}
tr.row-link:hover,tr.row-hover:hover{background:rgba(167,139,250,.08)}
.link-btn{transition:border-color .18s var(--ease-out),color .18s var(--ease-out),background .18s var(--ease-out)}
.ladder{display:flex;align-items:center;gap:14px;flex-wrap:wrap}
.rung{display:flex;align-items:center;gap:8px;background:rgba(255,255,255,.03);border:1px solid ${PALETTE.border};border-radius:8px;padding:8px 14px}
.rung-dot{width:10px;height:10px;border-radius:50%}
.rung-value{font-weight:700;font-size:18px}
.rung-label{color:${PALETTE.dim};font-size:12px}
.ladder-arrow{color:${PALETTE.dim};font-size:18px}
.climbing{list-style:none;margin:14px 0 0;padding:0;display:flex;flex-direction:column;gap:4px;font-size:13px;color:${PALETTE.text}}
.week-grid{display:flex;flex-wrap:wrap;gap:4px}
.week-cell{width:16px;height:16px;border-radius:3px;border:1px solid rgba(255,255,255,.05)}
.health-grid{display:flex;gap:24px;flex-wrap:wrap;margin-bottom:12px}
.health-value{font-size:22px;font-weight:700;display:block}
.health-label{color:${PALETTE.dim};font-size:12px}
.provenance{color:${PALETTE.dim};font-size:13px}
.provenance code{background:rgba(255,255,255,.06);padding:2px 6px;border-radius:4px;color:${PALETTE.text}}
.data-table{width:100%;border-collapse:collapse;font-size:13px}
.data-table th{text-align:left;color:${PALETTE.dim};font-weight:500;padding:6px 10px;border-bottom:1px solid ${PALETTE.border}}
.data-table td{padding:7px 10px;border-bottom:1px solid rgba(42,42,60,.5);vertical-align:top}
.kw{background:rgba(255,255,255,.05);border-radius:4px;padding:1px 7px;font-size:12px;color:${PALETTE.dim}}
[data-tab-section]{display:none}
[data-tab-section].active{display:block}

/* ── command nudges + reference (subtle, palette-aligned tip boxes) ── */
.nudge{display:flex;gap:10px;align-items:flex-start;background:rgba(167,139,250,.07);border:1px solid rgba(167,139,250,.3);border-radius:8px;padding:10px 12px;margin-top:12px}
.nudge-mark{flex:none;color:#a78bfa;margin-top:1px}
.nudge-body{flex:1;min-width:0}
.nudge-why{color:${PALETTE.text};font-size:13px}
.nudge-cmds{margin-top:8px;display:flex;flex-wrap:wrap;gap:6px}
.nudge-banner{border-color:rgba(167,139,250,.3)}
.nudge-banner .nudge{margin-top:0;border:none;background:transparent;padding:0}
.cmd-pill{display:inline-block;background:rgba(255,255,255,.06);border:1px solid ${PALETTE.border};border-radius:6px;padding:2px 8px;font-size:12px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:${PALETTE.text};cursor:pointer;transition:border-color .18s var(--ease-out),background .18s var(--ease-out)}
.cmd-pill:hover{border-color:#54546f;background:rgba(255,255,255,.1)}
.cmd-pill:focus{outline:none;border-color:#a78bfa}
.cmd-pill.copied{border-color:#34d3c0;color:#34d3c0}
.cmd-ref-grid{display:flex;flex-wrap:wrap;gap:18px}
.cmd-ref-group{flex:1;min-width:200px}
.cmd-ref-heading{color:${PALETTE.dim};font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px}
.cmd-ref-row{display:flex;align-items:baseline;gap:8px;margin-bottom:6px;flex-wrap:wrap}
.cmd-ref-desc{color:${PALETTE.dim};font-size:12px}

/* ── MOTION (gated: only when the user has NOT requested reduced motion) ──
   The resting state of every animated element is the FULLY VISIBLE one, so a
   browser without @starting-style / scroll-timeline support — or a reduced-motion
   user — simply shows the content statically. Animation only adds, never hides. */
@media (prefers-reduced-motion: no-preference){
  /* (2) entrance: @starting-style + allow-discrete. Resting = visible. */
  .kpi,.panel{transition:opacity .5s var(--ease-out),transform .5s var(--spring);transition-behavior:allow-discrete}
  @starting-style{.kpi,.panel{opacity:0;transform:translateY(8px)}}
  /* stagger the KPI cards by index for a cascade on first paint. */
  .kpi:nth-child(1){transition-delay:.02s}
  .kpi:nth-child(2){transition-delay:.06s}
  .kpi:nth-child(3){transition-delay:.10s}
  .kpi:nth-child(4){transition-delay:.14s}
  .kpi:nth-child(5){transition-delay:.18s}
  .kpi:nth-child(6){transition-delay:.22s}

  /* (3) scroll-driven reveal — ONLY where the timeline is supported. Default
     (the rule above / static) state stays visible; this layers a scroll keyed
     fade-up on supporting engines. Unsupported engines ignore the whole block. */
  @supports (animation-timeline: view()){
    @keyframes mage-reveal{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}
    .main .panel{animation:mage-reveal linear both;animation-timeline:view();animation-range:entry 0% entry 40%}
  }

  /* (1) view transition crossfade for the main tab area. Same-document, no fetch. */
  ::view-transition-old(mage-main),::view-transition-new(mage-main){animation-duration:.28s;animation-timing-function:var(--ease-out)}
  ::view-transition-old(mage-main){animation-name:mage-vt-out}
  ::view-transition-new(mage-main){animation-name:mage-vt-in}
  @keyframes mage-vt-out{to{opacity:0;transform:translateY(-6px)}}
  @keyframes mage-vt-in{from{opacity:0;transform:translateY(6px)}}
}
.main{view-transition-name:mage-main}

/* ── reduced-motion damper: a hard global stop for any motion that slipped the
   gates above (and for the JS-driven paths, which also check reduceMotion). ── */
@media (prefers-reduced-motion: reduce){
  *,*::before,*::after{animation-duration:.001ms!important;animation-iteration-count:1!important;transition-duration:.001ms!important;scroll-behavior:auto!important}
}
`.trim();
}

// ─── inline JS (vanilla, no network) ──────────────────────────────────────────

/**
 * The page's only authored script (the vendored force-graph UMD is inlined
 * separately, before this runs, defining window.ForceGraph). Reads the two JSON
 * islands (`#mage-data` snapshot + `#mage-graph` force-graph payload — parsed,
 * NEVER eval'd), then wires up the fully client-side cockpit:
 *   - tab toggling + the INERT Confirm/Skip hero buttons (Confirm reveals a CLI
 *     hint, never claims it ran; nothing is ever written/committed),
 *   - `buildGraph()` — the force-graph (Canvas + d3-force) knowledge graph:
 *     always-on labels drawn via `nodeCanvasObject` (`ctx.fillText`), hover
 *     highlight + info panel via `onNodeHover`, node click that opens the note in
 *     Obsidian (the href is built server-side, XSS-safe), internal wheel-zoom /
 *     drag-pan, `zoomToFit`, and the +/−/fit zoom buttons,
 *   - `filterNotes()` — the Notes-tab search/filter (substring over a pre-joined,
 *     lowercased haystack; textContent only, never innerHTML).
 *
 * SAFETY: every data-derived string is written via textContent / canvas fillText
 * (never innerHTML). The graph data comes only from the parsed JSON island.
 */
function script(): string {
  return `
(function(){
  // ── accessibility gate ───────────────────────────────────────────────────────
  // One source of truth for the JS-driven animations (view transition, graph
  // bloom, KPI count-up). When true, every motion path below is skipped and the
  // page is rendered statically (the resting DOM already holds the real values).
  var reduceMotion = false;
  try { reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches; }
  catch (e) { reduceMotion = false; }

  // Read the embedded islands (safe: JSON.parse of data islands, never eval).
  try { window.__MAGE_DATA__ = JSON.parse(document.getElementById('mage-data').textContent); }
  catch (e) { window.__MAGE_DATA__ = null; }
  var GRAPH = null;
  try { GRAPH = JSON.parse(document.getElementById('mage-graph').textContent); }
  catch (e) { GRAPH = null; }

  // ── tabs ────────────────────────────────────────────────────────────────────
  var tabs = document.querySelectorAll('.nav button[data-tab]');
  var sections = document.querySelectorAll('[data-tab-section]');
  // The raw DOM mutation (the existing class toggling). When the Graph tab is
  // revealed, the stage finally has a non-zero size, so re-size + re-fit the graph
  // (it was display:none — 0×0 — at init). __mageGraphFit is installed by buildGraph.
  function applyTab(name){
    sections.forEach(function(s){ s.classList.toggle('active', s.getAttribute('data-tab-section') === name); });
    tabs.forEach(function(t){ t.classList.toggle('active', t.getAttribute('data-tab') === name); });
    if (name === 'graph' && typeof window.__mageGraphFit === 'function'){
      // After the section is shown, the stage has layout — fit on the next frame.
      if (window.requestAnimationFrame){ requestAnimationFrame(function(){ window.__mageGraphFit(); }); }
      else { window.__mageGraphFit(); }
    }
  }
  // (1) View Transitions API: wrap the mutation in a crossfade when supported and
  // motion is allowed. Feature-detected — older browsers (or reduced-motion) fall
  // straight through to applyTab with zero behaviour change.
  // Valid tab names (from the rendered nav), for hash validation.
  var tabNames = {};
  tabs.forEach(function(t){ var n = t.getAttribute('data-tab'); if (n) tabNames[n] = true; });
  // Persist the active tab in the URL hash so a reload (or reopen) lands on the
  // same tab. replaceState avoids history spam; on the local file scheme where it
  // can be restricted, fall back to location.hash (reconciled by hashchange).
  function setHash(name){
    try { if (location.hash !== '#' + name) history.replaceState(null, '', '#' + name); }
    catch(e){ try { if (location.hash !== '#' + name) location.hash = name; } catch(e2){} }
  }
  function show(name){
    if (!tabNames[name]) name = 'overview';
    if (!reduceMotion && document.startViewTransition){
      document.startViewTransition(function(){ applyTab(name); });
    } else {
      applyTab(name);
    }
    setHash(name);
  }
  tabs.forEach(function(t){ t.addEventListener('click', function(){ show(t.getAttribute('data-tab')); }); });
  // Anything carrying data-goto-tab jumps to a named tab on click: the Overview
  // graph teaser button AND the clickable KPI cards (owner complaint #1). KPI cards
  // are role=button divs, so Enter/Space activate them too (keyboard-accessible).
  document.querySelectorAll('[data-goto-tab]').forEach(function(b){
    b.addEventListener('click', function(){ show(b.getAttribute('data-goto-tab')); });
    b.addEventListener('keydown', function(ev){
      if (ev.key === 'Enter' || ev.key === ' '){ ev.preventDefault(); show(b.getAttribute('data-goto-tab')); }
    });
  });

  // ── INERT hero buttons ───────────────────────────────────────────────────────
  document.querySelectorAll('[data-reveal]').forEach(function(b){
    b.addEventListener('click', function(){
      var item = b.closest('.proposal');
      if (!item) return;
      var hint = item.querySelector('.cli-hint');
      if (hint) hint.hidden = !hint.hidden;
    });
  });
  document.querySelectorAll('[data-skip]').forEach(function(b){
    b.addEventListener('click', function(){
      var item = b.closest('.proposal');
      if (item) item.style.opacity = item.style.opacity === '0.4' ? '1' : '0.4';
    });
  });

  // ── click-to-copy command pills (nudges + reference card) ─────────────────────
  // Tries navigator.clipboard.writeText(cmd) and flashes a transient "copied"
  // state. GRACEFUL: when the clipboard API is unavailable (the local-file origin
  // often blocks it) it NEVER throws — the pill text stays selectable, and a
  // rejected promise is swallowed. Click and keyboard (Enter/Space) both copy.
  function copyCmd(el){
    var cmd = el.getAttribute('data-copy');
    if (cmd == null) return;
    function flash(){
      el.classList.add('copied');
      setTimeout(function(){ el.classList.remove('copied'); }, 1200);
    }
    try {
      if (navigator.clipboard && navigator.clipboard.writeText){
        navigator.clipboard.writeText(cmd).then(flash, function(){ /* no-op: clipboard blocked */ });
      }
      // No clipboard API: do nothing (the text remains selectable) — never throw.
    } catch (e) { /* no-op: never throw on copy */ }
  }
  document.querySelectorAll('[data-copy]').forEach(function(el){
    el.addEventListener('click', function(){ copyCmd(el); });
    el.addEventListener('keydown', function(ev){
      if (ev.key === 'Enter' || ev.key === ' '){ ev.preventDefault(); copyCmd(el); }
    });
  });

  // ── clickable table rows (note rows open in Obsidian via their data-href) ─────
  document.querySelectorAll('tr.row-link').forEach(function(row){
    row.addEventListener('click', function(ev){
      // Let an explicit <a> click behave normally; otherwise navigate the row.
      if (ev.target && ev.target.closest && ev.target.closest('a')) return;
      var href = row.getAttribute('data-href');
      if (href) window.location.href = href;
    });
  });

  // ── notes search / filter (textContent match, never innerHTML) ───────────────
  function filterNotes(){
    var input = document.getElementById('notes-search');
    var tbody = document.getElementById('notes-tbody');
    if (!input || !tbody) return;
    var q = input.value.trim().toLowerCase();
    var rows = tbody.querySelectorAll('tr');
    var shown = 0;
    rows.forEach(function(r){
      var hay = r.getAttribute('data-filter') || '';
      var match = q === '' || hay.indexOf(q) !== -1;
      r.hidden = !match;
      if (match) shown++;
    });
    var count = document.getElementById('notes-count');
    if (count) count.textContent = String(shown);
    var empty = document.getElementById('notes-empty');
    if (empty) empty.hidden = shown !== 0;
  }
  var notesSearch = document.getElementById('notes-search');
  if (notesSearch) notesSearch.addEventListener('input', filterNotes);

  // ── the knowledge graph: force-graph (Canvas + d3-force) ─────────────────────
  // Mounted in the FIXED-HEIGHT #mage-graph-stage so pan/zoom stay internal and
  // the graph never grows the page. window.ForceGraph is defined by the inlined,
  // vendored UMD that runs BEFORE this script.
  var mageGraph = null; // the live ForceGraph instance (for tab-show re-fit).
  function buildGraph(){
    if (!GRAPH || !GRAPH.nodes || GRAPH.nodes.length === 0) return;
    var ForceGraphLib = window.ForceGraph;
    if (typeof ForceGraphLib !== 'function') return; // lib missing: degrade silently.
    var stage = document.getElementById('mage-graph-stage');
    if (!stage) return;

    // radius by degree, clamped (same scale as the old preview).
    function radiusOf(deg){ return Math.max(3, Math.min(7, 3 + Math.sqrt(deg || 0) * 1.4)); }
    // Truncate long titles so labels stay legible and never sprawl.
    function clampLabel(s){ s = String(s || ''); return s.length > 28 ? s.slice(0, 27) + '\\u2026' : s; }

    // Build the {nodes, links} force-graph operates on. Nodes are cloned from the
    // parsed island (id/title/type/wing/keywords/color/href/degree + seed x/y);
    // links map the [srcIndex, tgtIndex] edge pairs to node ids.
    var idAt = GRAPH.nodes.map(function(n){ return n.id; });
    var nodes = GRAPH.nodes.map(function(n){
      return { id: n.id, title: n.title, type: n.type, wing: n.wing,
               keywords: n.keywords || [], color: n.color, href: n.href,
               degree: n.degree || 0, x: n.x, y: n.y };
    });
    var links = (GRAPH.edges || []).map(function(pair){
      return { source: idAt[pair[0]], target: idAt[pair[1]] };
    }).filter(function(l){ return l.source != null && l.target != null; });

    // Adjacency (by id) for hover-neighbour highlighting.
    var neighbours = {};
    nodes.forEach(function(n){ neighbours[n.id] = {}; });
    links.forEach(function(l){
      if (neighbours[l.source]) neighbours[l.source][l.target] = true;
      if (neighbours[l.target]) neighbours[l.target][l.source] = true;
    });

    // hover state: the focused node id (or null) — read by the color accessors.
    var hoverId = null;
    function isFaded(id){
      if (hoverId == null) return false;
      if (id === hoverId) return false;
      return !(neighbours[hoverId] && neighbours[hoverId][id]);
    }

    // ── info panel (textContent only — never innerHTML) ──
    var info = document.getElementById('graph-info');
    function showInfo(n){
      if (!info) return;
      info.querySelector('.gi-title').textContent = n.title;
      var meta = n.type || '';
      var wing = n.wing || 'cross-cutting';
      info.querySelector('.gi-meta').textContent = (meta ? meta + ' \\u00b7 ' : '') + wing;
      var kw = info.querySelector('.gi-keywords');
      while (kw.firstChild) kw.removeChild(kw.firstChild);
      (n.keywords || []).forEach(function(k){
        var span = document.createElement('span');
        span.className = 'kw';
        span.textContent = k; // never innerHTML.
        kw.appendChild(span);
      });
      info.hidden = false;
    }
    function hideInfo(){ if (info) info.hidden = true; }

    // Label decluttering: with a large graph, only label higher-degree nodes when
    // zoomed far out; <=60 nodes always label (the spec's threshold).
    var bigGraph = nodes.length > 60;

    var Graph = ForceGraphLib()(stage)
      .graphData({ nodes: nodes, links: links })
      .nodeId('id')
      .backgroundColor('rgba(0,0,0,0)')
      .linkColor(function(l){
        var s = l.source && l.source.id ? l.source.id : l.source;
        var t = l.target && l.target.id ? l.target.id : l.target;
        if (hoverId != null && (s === hoverId || t === hoverId)) return 'rgba(231,231,240,0.85)';
        return 'rgba(120,120,150,0.25)';
      })
      .linkWidth(function(l){
        var s = l.source && l.source.id ? l.source.id : l.source;
        var t = l.target && l.target.id ? l.target.id : l.target;
        return (hoverId != null && (s === hoverId || t === hoverId)) ? 1.6 : 1;
      })
      // ALWAYS-ON LABELS: draw the node circle + its title under it, every frame.
      .nodeCanvasObject(function(node, ctx, globalScale){
        var r = radiusOf(node.degree);
        var faded = isFaded(node.id);
        ctx.globalAlpha = faded ? 0.18 : 1;
        // filled circle, colored by wing.
        ctx.beginPath();
        ctx.arc(node.x, node.y, r, 0, 2 * Math.PI, false);
        ctx.fillStyle = node.color || '#9a9ab2';
        ctx.fill();
        if (node.id === hoverId){
          ctx.lineWidth = 2 / globalScale;
          ctx.strokeStyle = '#e7e7f0';
          ctx.stroke();
        }
        // label: declutter only on a BIG graph zoomed far out — else always label.
        var showLabel = !bigGraph || globalScale > 0.55 || node.degree > 2 || node.id === hoverId;
        if (showLabel){
          var fontSize = Math.max(3, Math.min(8, 11 / globalScale));
          ctx.font = fontSize + 'px -apple-system,BlinkMacSystemFont,Segoe UI,system-ui,sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'top';
          ctx.fillStyle = faded ? 'rgba(154,154,178,0.7)' : '#e7e7f0';
          ctx.fillText(clampLabel(node.title), node.x, node.y + r + 1);
        }
        ctx.globalAlpha = 1;
      })
      // Hit area matches the drawn circle so hover/click line up with the dot.
      .nodePointerAreaPaint(function(node, color, ctx){
        var r = radiusOf(node.degree);
        ctx.beginPath();
        ctx.arc(node.x, node.y, r, 0, 2 * Math.PI, false);
        ctx.fillStyle = color;
        ctx.fill();
      })
      .onNodeHover(function(node){
        hoverId = node ? node.id : null;
        if (stage) stage.style.cursor = node ? 'pointer' : 'default';
        if (node) showInfo(node); else hideInfo();
      })
      // CLICK = open the note via its server-built href (the --open-with target:
      // a relative file link by default; XSS-safe). Center on it first, then go.
      .onNodeClick(function(node){
        if (!node || !node.href) return;
        try { Graph.centerAt(node.x, node.y, 500); } catch(e){}
        window.location.href = node.href;
      });

    // Spread the layout so the graph fills space and zoomToFit doesn't over-magnify
    // (small Obsidian-like dots + readable labels, not overlapping blobs).
    try {
      var chg = Graph.d3Force('charge'); if (chg) chg.strength(-120).distanceMax(400);
      var lnk = Graph.d3Force('link'); if (lnk) lnk.distance(40).strength(0.5);
    } catch(e){}

    // Size the canvas to the FIXED-HEIGHT stage (clientWidth/Height). The stage is
    // display:none while its tab is hidden (0 size), so we re-fit on reveal too.
    function sizeToStage(){
      var w = stage.clientWidth, h = stage.clientHeight;
      if (w > 0 && h > 0){ Graph.width(w).height(h); }
    }
    sizeToStage();

    // REDUCED MOTION: settle instantly (no animated jiggle) then fit. Else allow a
    // short animated settle, then fit once the layout cools.
    if (reduceMotion){
      try { Graph.warmupTicks(120).cooldownTicks(0); } catch(e){}
    } else {
      try { Graph.warmupTicks(20); } catch(e){}
    }
    // Fit ONCE the layout settles (positions are final on engine stop), in both
    // modes — fitting before settle frames an empty area. Safety net in case the
    // engine never reports a stop (e.g. headless): re-fit after a short delay.
    Graph.onEngineStop(function(){ sizeToStage(); fit(reduceMotion ? 0 : 400); });
    setTimeout(function(){ sizeToStage(); fit(0); }, reduceMotion ? 80 : 1300);

    function fit(ms){ try { Graph.zoomToFit(ms || 400, 40); } catch(e){} }

    // Re-fit when the stage resizes (window resize / first reveal sizing).
    if (typeof ResizeObserver === 'function'){
      var ro = new ResizeObserver(function(){ sizeToStage(); });
      ro.observe(stage);
    }
    window.addEventListener('resize', function(){ sizeToStage(); fit(0); });

    // ── zoom controls (+ / − / fit) ──
    var zin = document.getElementById('graph-zoom-in');
    var zout = document.getElementById('graph-zoom-out');
    var zfit = document.getElementById('graph-zoom-fit');
    if (zin) zin.addEventListener('click', function(){ Graph.zoom(Graph.zoom() * 1.3, 250); });
    if (zout) zout.addEventListener('click', function(){ Graph.zoom(Graph.zoom() / 1.3, 250); });
    if (zfit) zfit.addEventListener('click', function(){ fit(400); });

    // ── legend (note type → color) ──
    var legend = document.getElementById('graph-legend');
    if (legend && GRAPH.legend){
      GRAPH.legend.forEach(function(entry){
        var span = document.createElement('span');
        span.className = 'leg';
        var dot = document.createElement('span');
        dot.className = 'dot';
        dot.style.background = entry.color;
        var label = document.createTextNode(entry.label || 'untyped');
        span.appendChild(dot); span.appendChild(label);
        legend.appendChild(span);
      });
    }

    mageGraph = Graph;
    // Explicit hook: re-size + re-fit when the Graph tab is revealed (the stage has
    // 0 size while display:none, so the initial fit must run on first show).
    window.__mageGraphFit = function(){ sizeToStage(); fit(0); };
  }
  buildGraph();

  // ── (6) KPI count-up: tween each number 0→value (~700ms, ease-out) ───────────
  // The resting DOM already contains the TRUE value (so non-JS / reduced-motion
  // shows it correctly). We only overwrite textContent during the tween, parsing
  // a numeric prefix and preserving any suffix (e.g. the "%" on context-match).
  function countUpKpis(){
    if (reduceMotion) return; // static: the real numbers are already on screen.
    var els = document.querySelectorAll('.kpi-value');
    els.forEach(function(el){
      var raw = el.textContent || '';
      var m = raw.match(/^(\\d+)(.*)$/); // leading integer + suffix.
      if (!m) return;
      var target = parseInt(m[1], 10);
      var suffix = m[2] || '';
      if (!(target > 0)) return; // 0 (or non-positive): nothing to count up.
      var DUR = 700, start = (window.performance && performance.now) ? performance.now() : Date.now();
      function tick(now){
        var t = Math.min(1, (now - start) / DUR);
        var eased = 1 - Math.pow(1 - t, 3); // ease-out cubic.
        el.textContent = String(Math.round(eased * target)) + suffix;
        if (t < 1){ requestAnimationFrame(tick); }
        else { el.textContent = String(target) + suffix; } // land on the true value.
      }
      el.textContent = '0' + suffix;
      requestAnimationFrame(tick);
    });
  }
  countUpKpis();

  // Land on the tab named in the URL hash (so a reload keeps your place); else Overview.
  var initialTab = (location.hash || '').replace(/^#/, '');
  show(tabNames[initialTab] ? initialTab : 'overview');
  // Back/forward or a manual hash edit switches tab without rewriting the hash.
  window.addEventListener('hashchange', function(){
    var n = (location.hash || '').replace(/^#/, '');
    if (tabNames[n]) applyTab(n);
  });
})();
`.trim();
}

// ─── the document ─────────────────────────────────────────────────────────────

/** The tab definitions: id + visible label, in sidebar order. */
const TABS: Array<{ id: string; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "wings", label: "Wings" },
  { id: "notes", label: "Notes" },
  { id: "skills", label: "Skills" },
  { id: "graph", label: "Graph" },
  { id: "soak", label: "Soak" },
];

function navHtml(): string {
  return TABS.map(
    (t) => `<button type="button" data-tab="${t.id}">${escapeHtml(t.label)}</button>`,
  ).join("");
}

/**
 * Render the complete, self-contained cockpit HTML document for a snapshot. The
 * returned string is ONE document — `<!doctype html>` through `</html>` — with every
 * untrusted value HTML-escaped and the structured data embedded as a safe JSON
 * island. ZERO external resources: it opens from `file://` offline.
 */
export function renderCockpitHtml(
  data: DashboardData,
  opts: { openWith?: OpenWith } = {},
): string {
  const openWith = opts.openWith ?? "file";
  const now = new Date(data.meta.lastRefreshed);
  const refDate = Number.isNaN(now.getTime()) ? new Date() : now;
  const colors = wingColorMap(data.wings);

  const footer = `${escapeHtml(data.meta.kbName)} | ${escapeHtml(data.meta.kind)} | refreshed ${escapeHtml(data.meta.lastRefreshed)}`;
  const vault = data.meta.kbName;

  // Data-driven command nudges — computed once (pure + deterministic) and mounted
  // into the panels they target. Suppressed nudges resolve to "" so a mature KB
  // stays clean. The full set is the same `data` -> same array (byte-stable).
  const nudges = computeNudges(data);
  const gettingStartedNudge = nudgeHtmlFor(nudges, "getting-started");
  const proposalsNudge = nudgeHtmlFor(nudges, "proposals");
  const ladderNudge = nudgeHtmlFor(nudges, "ladder");
  const notesNudge = nudgeHtmlFor(nudges, "notes");
  const skillsNudge = nudgeHtmlFor(nudges, "skills");
  const healthNudge = nudgeHtmlFor(nudges, "health");
  const connectionNudge = nudgeHtmlFor(nudges, "connection");

  // The full force-graph payload — built once, embedded once, read by the client.
  const graphData = buildGraphClientData(data.graph, data.notes, vault, openWith, data.meta.root);

  // The getting-started banner sits at the very top of the Overview tab — only
  // present when the nudge exists (a cold KB); empty string otherwise.
  const gettingStartedBanner = gettingStartedNudge
    ? `<section class="panel nudge-banner">${gettingStartedNudge}</section>`
    : "";

  // Overview tab = the cockpit's first screen: getting-started banner + hero +
  // ladder + activity + health + a compact graph teaser pointing to the Graph tab.
  const overview = `<div data-tab-section="overview" class="active">
${gettingStartedBanner}
${renderHero(data, proposalsNudge, openWith)}
${renderGraph(data.graph, { compact: true })}
${renderLadder(data, ladderNudge)}
${renderActivity(data)}
${renderHealth(data, refDate, healthNudge)}
</div>`;

  const wings = `<div data-tab-section="wings">${renderWings(data, colors)}</div>`;
  const notes = `<div data-tab-section="notes">${notesNudge}${renderNotes(data, colors, openWith)}</div>`;
  const skills = `<div data-tab-section="skills">${skillsNudge}${renderSkills(data)}</div>`;
  const graph = `<div data-tab-section="graph">${renderGraph(data.graph)}</div>`;
  const soak = `<div data-tab-section="soak">${renderSoak(data, connectionNudge, ladderNudge)}</div>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:;"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${escapeHtml(data.meta.kbName)} &middot; mage dashboard</title>
<style>
${styles()}
</style>
</head>
<body>
<div class="layout">
  <aside class="sidebar">
    <div class="brand">${MARK_SVG}<span class="brand-name">mage</span></div>
    <nav class="nav">${navHtml()}</nav>
    <div class="sidebar-footer">${footer}</div>
  </aside>
  <main class="main">
    ${renderKpis(data)}
    ${overview}
    ${wings}
    ${notes}
    ${skills}
    ${graph}
    ${soak}
  </main>
</div>
<script type="application/json" id="mage-data">${jsonIsland(data)}</script>
<script type="application/json" id="mage-graph">${graphIsland(graphData)}</script>
<script>${escapeScript(GRAPH_LIB_JS)}</script>
<script>
${script()}
</script>
</body>
</html>`;
}
