import { confirm } from "@inquirer/prompts";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { isCaptureInboxNote } from "../adapters/claude-code/inbox.js";
import { discoverMemoryDirs } from "../adapters/claude-code/projects.js";
import { resolveDecision } from "../interactive.js";
import { logger } from "../logger.js";
import { type NoteFrontmatter, parseNote } from "../note.js";
import {
  type ResolvedDocsRoot,
  ownedDocsRoots,
  requireDocsRoot,
  resolveDocsRoot,
  stagingPath,
} from "../paths.js";
import { redact } from "../redact.js";
import { isGeneratedArtifact, scanNotes } from "../scan.js";
import { slugify, uniqueSlug } from "../grooming/staging.js";

/**
 * `mage adopt` — onboard pre-existing Claude Code memories into the git-durable
 * pipeline (ADR-0034). A DISPATCHER, not a new pipeline: it discovers CC's
 * cwd-keyed memory dirs, routes each by its TRUE origin cwd to the KB that owns
 * it, then **places** in-shape captures into that KB's capture inbox (where
 * `mage groom` already ingests them) and **reports** out-of-shape material to
 * distill via `mage:learn --from`. Plan-first, scrub-at-adopt, copy-never-move,
 * idempotent. Never commits.
 */

export interface AdoptOptions {
  /** Resolve "this KB" from here (default cwd); walks up. */
  dir?: string;
  /** Whole-machine sweep: adopt every discoverable KB's memories, not just this one. */
  all?: boolean;
  /** Stop at the plan; write nothing. */
  dryRun?: boolean;
  /** Non-interactive: skip the confirmation prompt. */
  yes?: boolean;
  /** Claude Code config home (tests inject a fake `~/.claude`). */
  home?: string;
}

/** An in-shape capture that will be (or was) copied — scrubbed — into a KB's inbox. */
export interface PlaceItem {
  /** Absolute source memory file. */
  file: string;
  /** Filename stem → the inbox draft slug + de-collision base. */
  slug: string;
  /** The KB docs root the inbox file lands at. */
  targetRoot: string;
  /** Inbox destination path (`<targetRoot>/<slug>.md`). */
  dest: string;
  /** Secret values masked by the scrub. */
  masked: number;
  /** PII values flagged-but-kept (Gate-0 policy, not Gate-2's block). */
  pii: number;
  /** The scrubbed bytes (held from plan → execute so the redactor runs once). */
  scrubbed: string;
}

/** An out-of-shape memory — reported for `mage:learn --from`, never copied verbatim (ADR-0005). */
export interface DistillItem {
  file: string;
  slug: string;
  cwd: string;
}

/** Memories whose origin resolves to a DIFFERENT KB (per-KB default; run adopt there). */
export interface ElsewhereItem {
  cwd: string;
  kbRoot: string;
  count: number;
}

/** Memories with no aimable home — surfaced, never dropped or guessed. */
export interface UnclaimedItem {
  cwd: string | null;
  count: number;
  reason: "unknown-cwd" | "origin-has-no-kb";
}

export interface AdoptResult {
  kb: ResolvedDocsRoot;
  /** Did we actually write (false for a plan-only / dry-run / declined run)? */
  applied: boolean;
  placed: PlaceItem[];
  distill: DistillItem[];
  elsewhere: ElsewhereItem[];
  unclaimed: UnclaimedItem[];
  /** Already-present captures the idempotency guard skipped. */
  skipped: Array<{ slug: string; reason: string }>;
  /** Total memory files inspected. */
  scanned: number;
}

/** in-shape = already authored as a note (CC marker OR mage note-frontmatter); else distill. */
function inShape(fm: NoteFrontmatter): boolean {
  return isCaptureInboxNote(fm) || (typeof fm.type === "string" && fm.type.trim().length > 0);
}

/** The CC session id a native memory was written under (drives idempotency identity). */
function sessionOf(fm: NoteFrontmatter): string | undefined {
  const meta = fm.metadata as { originSessionId?: unknown } | undefined;
  return typeof meta?.originSessionId === "string" ? meta.originSessionId : undefined;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Build the `cc-session → {note stems}` index already present under a KB (committed
 * notes + staged drafts), so re-running adopt skips what's in (ADR-0034 §5). Keyed
 * on session AND stem — a single CC session writes many distinct memories, so a
 * session-only key would false-drop siblings (the inbox sibling-drop bug, applied
 * here as a guard).
 */
async function existingIdentities(root: string): Promise<Map<string, Set<string>>> {
  const map = new Map<string, Set<string>>();
  const addId = (uuid: string, slug: string): void => {
    const set = map.get(uuid) ?? new Set<string>();
    set.add(slug);
    map.set(uuid, set);
  };
  const add = (fm: NoteFrontmatter, stem: string): void => {
    const slug = slugify(stem);
    // Committed notes + staged drafts carry the session in `sources: [cc-session:<id>]`
    // (mapInboxNote stamps it at ingest)…
    for (const s of fm.sources ?? []) {
      if (typeof s === "string" && s.startsWith("cc-session:")) addId(s.slice("cc-session:".length), slug);
    }
    // …while a placed-but-ungroomed inbox capture still carries it RAW in
    // metadata.originSessionId — without this, re-running adopt before groom would
    // re-place (a duplicate) what is already sitting in the inbox.
    const sess = sessionOf(fm);
    if (sess) addId(sess, slug);
  };
  // scanNotes walks the whole root, so it already includes root-level inbox captures.
  for (const sn of await scanNotes(root).catch(() => [])) {
    try {
      add(parseNote(await readFile(join(root, sn.relPath), "utf8")).frontmatter, basename(sn.relPath, ".md"));
    } catch {
      /* unreadable note — skip */
    }
  }
  try {
    for (const e of await readdir(stagingPath(root), { withFileTypes: true })) {
      if (!e.isFile() || !e.name.endsWith(".md")) continue;
      add(parseNote(await readFile(join(stagingPath(root), e.name), "utf8")).frontmatter, basename(e.name, ".md"));
    }
  } catch {
    /* no staging dir yet */
  }
  return map;
}

/** True iff this (session, slug) — or a de-collided `slug-<n>` of it — is already adopted. */
function alreadyAdopted(session: string | undefined, slug: string, index: Map<string, Set<string>>): boolean {
  if (!session) return false;
  const stems = index.get(session);
  if (!stems) return false;
  if (stems.has(slug)) return true;
  const decollided = new RegExp(`^${escapeRe(slug)}-\\d+$`);
  for (const stem of stems) if (decollided.test(stem)) return true;
  return false;
}

/**
 * Compute the adoption plan (no writes): discover CC memory dirs, route each by its
 * recovered origin cwd, classify shape, and pre-scrub the in-shape ones.
 */
async function planAdopt(kb: ResolvedDocsRoot, opts: AdoptOptions): Promise<AdoptResult> {
  const owned = new Set(await ownedDocsRoots(kb));
  const dirs = await discoverMemoryDirs({ home: opts.home });

  const result: AdoptResult = {
    kb,
    applied: false,
    placed: [],
    distill: [],
    elsewhere: [],
    unclaimed: [],
    skipped: [],
    scanned: 0,
  };
  // One idempotency index per target root, built lazily.
  const indexCache = new Map<string, Map<string, Set<string>>>();
  const indexFor = async (root: string): Promise<Map<string, Set<string>>> => {
    let idx = indexCache.get(root);
    if (!idx) {
      idx = await existingIdentities(root);
      indexCache.set(root, idx);
    }
    return idx;
  };
  // The inbox slugs already occupying `<root>/<slug>.md` (existing root-level files),
  // per target root. Shared across every dir routing to the same KB and grown as we
  // queue placements, so two DISTINCT memories sharing a basename de-collide instead
  // of overwriting each other at execute time.
  const takenCache = new Map<string, Set<string>>();
  const takenFor = async (root: string): Promise<Set<string>> => {
    let taken = takenCache.get(root);
    if (!taken) {
      taken = new Set<string>();
      try {
        for (const e of await readdir(root, { withFileTypes: true })) {
          if (e.isFile() && e.name.endsWith(".md") && !isGeneratedArtifact(e.name)) {
            taken.add(slugify(basename(e.name, ".md")));
          }
        }
      } catch {
        /* root not readable yet — nothing taken */
      }
      takenCache.set(root, taken);
    }
    return taken;
  };

  for (const dir of dirs) {
    result.scanned += dir.files.length;

    if (!dir.cwd) {
      result.unclaimed.push({ cwd: null, count: dir.files.length, reason: "unknown-cwd" });
      continue;
    }
    const originKb = await resolveDocsRoot(dir.cwd);
    if (!originKb) {
      result.unclaimed.push({ cwd: dir.cwd, count: dir.files.length, reason: "origin-has-no-kb" });
      continue;
    }
    const claimedHere = owned.has(originKb.root);
    if (!opts.all && !claimedHere) {
      result.elsewhere.push({ cwd: dir.cwd, kbRoot: originKb.root, count: dir.files.length });
      continue;
    }

    const targetRoot = originKb.root;
    const idx = await indexFor(targetRoot);
    const taken = await takenFor(targetRoot);
    for (const file of dir.files) {
      const baseSlug = slugify(basename(file, ".md"));
      let raw: string;
      try {
        raw = await readFile(file, "utf8");
      } catch {
        result.skipped.push({ slug: baseSlug, reason: "unreadable" });
        continue;
      }
      const { frontmatter } = parseNote(raw);

      if (!inShape(frontmatter)) {
        result.distill.push({ file, slug: baseSlug, cwd: dir.cwd });
        continue;
      }
      // Idempotency (ADR-0034 §5): this exact capture (cc-session + slug) is already
      // in — committed, staged, or sitting ungroomed in the inbox — so skip it.
      if (alreadyAdopted(sessionOf(frontmatter), baseSlug, idx)) {
        result.skipped.push({ slug: baseSlug, reason: "already adopted (cc-session)" });
        continue;
      }
      // De-collide the inbox destination: two DISTINCT memories that share a basename
      // (different cwds → same KB) must never overwrite each other at execute time
      // (uniqueSlug, mirroring the inbox ingest). Reserve immediately so the next file
      // in this run — including from another dir routing here — sees it taken.
      const slug = uniqueSlug(baseSlug, taken);
      taken.add(slug);
      // Scrub at adopt: these predate Gate-0 and were never scrubbed. Secrets are
      // masked before they touch disk; PII is kept-but-flagged (the capture-time
      // policy, ADR-0034 §5), so it surfaces at groom rather than blocking here.
      const { text, findings } = redact(raw);
      result.placed.push({
        file,
        slug,
        targetRoot,
        dest: join(targetRoot, `${slug}.md`),
        masked: findings.filter((f) => f.severity === "secret").length,
        pii: findings.filter((f) => f.severity === "pii").length,
        scrubbed: text,
      });
    }
  }
  return result;
}

/** Render the plan/outcome. Pure of side effects beyond logging. */
function reportAdopt(r: AdoptResult): void {
  const verb = r.applied ? "Adopted" : "Plan";
  logger.info(
    `${verb}: ${r.placed.length} to place · ${r.distill.length} to distill · ` +
      `${r.elsewhere.length} elsewhere · ${r.unclaimed.length} unclaimed (of ${r.scanned} memories).`,
  );
  for (const p of r.placed) {
    const masked = p.masked > 0 ? ` (${p.masked} secret${p.masked === 1 ? "" : "s"} masked)` : "";
    const pii = p.pii > 0 ? ` (${p.pii} PII flagged)` : "";
    logger.detail(`  place  ${p.slug} → ${p.dest}${masked}${pii}`);
  }
  for (const d of r.distill) {
    logger.detail(`  distill ${d.slug} — out of shape; run \`mage:learn --from ${d.file}\``);
  }
  for (const e of r.elsewhere) {
    logger.detail(`  elsewhere ${e.count} from ${e.cwd} → belongs to ${e.kbRoot} (run \`mage adopt\` there, or --all)`);
  }
  for (const u of r.unclaimed) {
    const where = u.cwd ?? "(cwd unrecoverable)";
    logger.detail(`  unclaimed ${u.count} from ${where} — ${u.reason}; aim it with \`mage init\`/\`mage link\``);
  }
  for (const s of r.skipped) {
    logger.detail(`  skip   ${s.slug} — ${s.reason}`);
  }
}

/**
 * Adopt pre-existing CC memories into the resolved KB's inbox. Plan-first: builds
 * the full plan, reports it, then (unless `--dry-run`) confirms and writes. Copy,
 * never move — CC's originals stay intact but dormant. Never commits.
 */
export async function adopt(opts: AdoptOptions = {}): Promise<AdoptResult> {
  const kb = await requireDocsRoot(opts.dir);
  const result = await planAdopt(kb, opts);
  reportAdopt(result);

  if (result.placed.length === 0) {
    if (result.distill.length + result.elsewhere.length + result.unclaimed.length === 0) {
      logger.success("Nothing to adopt — every discoverable memory is already in or belongs elsewhere.");
    }
    return result;
  }
  if (opts.dryRun) {
    logger.detail("Dry run — nothing written. Re-run without --dry-run to place.");
    return result;
  }

  const proceed = await resolveDecision<boolean>({
    flagValue: opts.yes ? true : undefined,
    yes: opts.yes,
    interactive: () =>
      confirm({ message: `Place ${result.placed.length} capture(s) into the inbox?`, default: true }),
    fallback: { value: true },
    flagName: "yes",
  });
  if (!proceed) {
    logger.info("Aborted — nothing written.");
    return result;
  }

  for (const p of result.placed) {
    await writeFile(p.dest, p.scrubbed);
  }
  result.applied = true;
  logger.success(
    `Placed ${result.placed.length} capture(s) into the inbox. Run \`mage:groom\` to surface, accept/reject, and commit.`,
  );
  return result;
}
