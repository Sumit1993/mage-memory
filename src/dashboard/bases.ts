// TIER 1 — the `Knowledge.base` renderer (ADR-0020 §1).
//
// `renderKnowledgeBase(data)` emits an Obsidian **Bases** file (a `.base`, core
// plugin — NO community plugin required). Bases gives a live, in-vault,
// database-like view of the KB, but it can read only note FRONTMATTER, never the
// gitignored `.metrics/*.json` (ADR-0020 §6). So this renderer is the
// *frontmatter half* of the dashboard: every view filters/sorts/groups on real
// frontmatter fields the scanner already reads — `type`, `status`,
// `last_reviewed`, and the `wing/room` tags.
//
// The file is a small but VALID Bases document conforming to the documented
// schema (https://help.obsidian.md/bases/syntax):
//
//   properties:            # column display-name overrides (note.* / file.*)
//   views:                 # one or more table views
//     - type: table
//       name: ...
//       filters: { and/or/not: [ "<expr>" ] }
//       groupBy: { property, direction }
//       order: [ <column>, ... ]
//
// Property references follow the Bases vocabulary:
//   - `note.<field>`  → a frontmatter property (e.g. note.type, note.status).
//   - `file.<field>`  → a file property / function (e.g. file.name,
//     file.hasTag("wing")).
//   - bare `<field>`  → assumed a note property.
//
// ASSUMPTIONS (documented because the Bases schema is young / app-edited):
//   - Wing membership lives in tags shaped `wing/room`, so the per-wing views
//     filter with `file.hasTag("<wing>")` (Bases' tag predicate).
//   - "Due for review" = notes whose `last_reviewed` is empty OR older than the
//     180-day staleness window — expressed as `!note.last_reviewed` OR
//     `note.last_reviewed < (now() - "180d")`, matching `mage dream`'s default.
//   - Views are derived from `data.wings` so the base reflects THIS KB, but it is
//     still pure frontmatter — no `.metrics` value ever appears.
//
// Determinism: same `data` → identical bytes (wings/types sorted; the YAML
// emitter is order-stable). This file is committable, so a re-run must produce no
// diff. We hand-emit minimal YAML (no YAML dependency in the package); the test
// parses it back to prove validity.

import type { DashboardData, DashboardWing } from "./types.js";

/** Staleness window (days) for the "due for review" view — matches `mage dream`. */
const STALE_DAYS = 180;

/**
 * Render a valid Obsidian `Knowledge.base` (ADR-0020 tier 1) from the snapshot's
 * frontmatter-derived fields. Deterministic and committable. Views:
 *   1. "All notes" — table grouped by note.type, columns type/status/last_reviewed.
 *   2. "Due for review" — notes missing or stale `last_reviewed`.
 *   3. one "Wing · <name>" table per wing, filtered by `file.hasTag("<wing>")`.
 */
export function renderKnowledgeBase(data: DashboardData): string {
  const doc: YamlNode = {
    // Column display-name overrides. Keys are Bases property references.
    properties: {
      "note.type": { displayName: "Type" },
      "note.status": { displayName: "Status" },
      "note.last_reviewed": { displayName: "Last reviewed" },
    },
    views: [allNotesView(), dueForReviewView(), ...wingViews(data.wings)],
  };
  return emitYaml(doc);
}

// ─── views ───────────────────────────────────────────────────────────────────

/** The "everything" table — grouped by type, sorted columns on real fields. */
function allNotesView(): YamlNode {
  return {
    type: "table",
    name: "All notes",
    groupBy: { property: "note.type", direction: "ASC" },
    order: ["file.name", "note.type", "note.status", "note.last_reviewed"],
  };
}

/**
 * "Due for review" — notes with no `last_reviewed`, or one older than the
 * 180-day staleness window. Expressed as a Bases `or` filter over frontmatter +
 * a date predicate (`now() - "180d"`), so it stays live without `.metrics`.
 */
function dueForReviewView(): YamlNode {
  return {
    type: "table",
    name: "Due for review",
    filters: {
      or: [
        "!note.last_reviewed",
        `note.last_reviewed < (now() - "${STALE_DAYS}d")`,
      ],
    },
    order: ["file.name", "note.type", "note.last_reviewed"],
  };
}

/**
 * One table per wing, filtered to that wing's tag. Wings are sorted by name so
 * the emitted views are deterministic. A wing whose name needs escaping is still
 * safe because `hasTag` takes a quoted string literal.
 */
function wingViews(wings: DashboardWing[]): YamlNode[] {
  return [...wings]
    .map((w) => w.name)
    .filter((name) => name !== "")
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    .map((name) => ({
      type: "table",
      name: `Wing · ${name}`,
      filters: { and: [`file.hasTag("${escapeExpr(name)}")`] },
      groupBy: { property: "note.type", direction: "ASC" },
      order: ["file.name", "note.type", "note.status", "note.last_reviewed"],
    }));
}

/** Escape a value embedded inside a double-quoted Bases expression string. */
function escapeExpr(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

// ─── minimal YAML emitter (no external dependency) ───────────────────────────
//
// A tiny, deterministic block-YAML serializer covering exactly the node shapes
// this file produces: nested maps, lists of maps, and lists of scalar strings.
// Scalars are always emitted double-quoted so values containing YAML-significant
// characters (`:`, `!`, `(`, `"`, `#`, leading symbols) round-trip safely.

/** The shapes our emitter handles — maps, arrays, and string scalars. */
type YamlNode = string | YamlNode[] | { [key: string]: YamlNode };

/** Serialize a YAML document, ending with a single trailing newline. */
function emitYaml(node: YamlNode): string {
  const lines = emitNode(node, 0);
  return `${lines.join("\n")}\n`;
}

/** Emit a node at a given indent depth, returning its lines (no trailing NL). */
function emitNode(node: YamlNode, depth: number): string[] {
  if (typeof node === "string") return [quote(node)];
  if (Array.isArray(node)) return emitArray(node, depth);
  return emitMap(node, depth);
}

function emitMap(map: { [key: string]: YamlNode }, depth: number): string[] {
  const pad = "  ".repeat(depth);
  const out: string[] = [];
  for (const key of Object.keys(map)) {
    const value = map[key] as YamlNode;
    const k = `${pad}${quoteKey(key)}:`;
    if (typeof value === "string") {
      out.push(`${k} ${quote(value)}`);
    } else if (Array.isArray(value)) {
      if (value.length === 0) {
        out.push(`${k} []`);
      } else {
        out.push(k);
        out.push(...emitArray(value, depth));
      }
    } else {
      out.push(k);
      out.push(...emitNode(value, depth + 1));
    }
  }
  return out;
}

function emitArray(arr: YamlNode[], depth: number): string[] {
  const pad = "  ".repeat(depth);
  const out: string[] = [];
  for (const item of arr) {
    if (typeof item === "string") {
      out.push(`${pad}- ${quote(item)}`);
    } else {
      // A list item that is a map: the first key sits on the `- ` line, the rest
      // are indented one level deeper.
      const inner = emitNode(item, depth + 1);
      const [first, ...rest] = inner;
      out.push(`${pad}- ${(first ?? "").trimStart()}`);
      out.push(...rest);
    }
  }
  return out;
}

/** Double-quote a scalar, escaping backslashes and quotes (always quoted). */
function quote(s: string): string {
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/**
 * Map keys are emitted quoted only when they contain a character that would
 * confuse the YAML key parser (a `.` is fine bare, but we quote dotted refs for
 * clarity and to be safe across YAML 1.1/1.2 parsers).
 */
function quoteKey(key: string): string {
  return /^[A-Za-z0-9_]+$/.test(key) ? key : `"${key.replace(/"/g, '\\"')}"`;
}
