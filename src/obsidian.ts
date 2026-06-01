import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { OBSIDIAN_DIR, exists } from "./paths.js";

export interface ColorGroup {
  query: string;
  color: { a: number; rgb: number };
}

/** A small, visually distinct palette (24-bit RGB ints) for per-wing color groups. */
const WING_PALETTE: number[] = [
  0x4f9dde, // blue
  0xe0566f, // red
  0x6cc070, // green
  0xd9a441, // amber
  0xa97bdb, // purple
  0x46c5b6, // teal
  0xe07b53, // orange
  0xc05d97, // magenta
];

/**
 * Deterministically assign one color group per wing. Wings are sorted so the
 * mapping is stable across runs (golden-file friendly). The `tag:#<wing>`
 * query also matches nested `#<wing>/<room>` tags in Obsidian's search syntax.
 */
export function assignWingColors(wings: string[]): ColorGroup[] {
  const sorted = [...new Set(wings)].sort();
  return sorted.map((wing, i) => ({
    query: `tag:#${wing}`,
    color: { a: 1, rgb: WING_PALETTE[i % WING_PALETTE.length] as number },
  }));
}

function appJson(): string {
  // Author + resolve cross-note links as STANDARD markdown links (portable),
  // never [[wikilinks]]. Relative paths so the vault is repo-portable.
  return `${JSON.stringify(
    {
      useMarkdownLinks: true,
      newLinkFormat: "relative",
      alwaysUpdateLinks: true,
    },
    null,
    2,
  )}\n`;
}

function appearanceJson(): string {
  return `${JSON.stringify({ accentColor: "" }, null, 2)}\n`;
}

function graphJson(colorGroups: ColorGroup[]): string {
  return `${JSON.stringify(
    {
      "collapse-filter": true,
      search: "",
      showTags: false,
      showAttachments: false,
      hideUnresolved: false,
      showOrphans: true,
      "collapse-color-groups": false,
      colorGroups,
      "collapse-display": true,
      showArrow: false,
      textFadeMultiplier: 0,
      nodeSizeMultiplier: 1,
      lineSizeMultiplier: 1,
      "collapse-forces": true,
      centerStrength: 0.518,
      repelStrength: 10,
      linkStrength: 1,
      linkDistance: 250,
      scale: 1,
      close: true,
    },
    null,
    2,
  )}\n`;
}

/**
 * Scaffold a minimal `.obsidian/` so the knowledge base opens cleanly as an
 * Obsidian vault, with the graph colored by wing. Never clobbers files that
 * already exist (preserves a user's vault settings). Hand-written JSON; no
 * Obsidian dependency.
 */
export async function writeObsidianScaffold(vaultRoot: string, wings: string[] = []): Promise<void> {
  const dir = join(vaultRoot, OBSIDIAN_DIR);
  await mkdir(dir, { recursive: true });
  const files: Array<[string, string]> = [
    ["app.json", appJson()],
    ["appearance.json", appearanceJson()],
    ["graph.json", graphJson(assignWingColors(wings))],
  ];
  for (const [name, content] of files) {
    const p = join(dir, name);
    if (!(await exists(p))) await writeFile(p, content);
  }
}

/**
 * Refresh `graph.json`'s colorGroups to match the current set of wings,
 * preserving every other graph setting. Safe to call repeatedly (e.g. from
 * `mage index`). No-op when there is no `.obsidian/graph.json` yet, or when the
 * existing file isn't valid JSON (leave a user-managed file alone).
 */
export async function updateGraphColorGroups(vaultRoot: string, wings: string[]): Promise<void> {
  const p = join(vaultRoot, OBSIDIAN_DIR, "graph.json");
  if (!(await exists(p))) return;
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(await readFile(p, "utf8")) as Record<string, unknown>;
  } catch {
    return;
  }
  parsed.colorGroups = assignWingColors(wings);
  await writeFile(p, `${JSON.stringify(parsed, null, 2)}\n`);
}
