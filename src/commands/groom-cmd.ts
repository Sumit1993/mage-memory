// `mage groom` walks memory notes up the ladder and only reads; a climb edits code-repo files
// that --propose refuses, so the diff lands as one ordinary pull request (ADR-0060, #282).
// --accept/--reject act only on 0.0.17 drafts already in .mage/staging/ until #223.

import { readFile, realpath } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { logger } from "../logger.js";
import {
  type ResolvedDocsRoot,
  readGenreOverrides,
  requireDocsRoot,
  stagingPath,
} from "../paths.js";
import { resolveCreationStamp, stampProvenance } from "../provenance.js";
import { listHeld } from "../held.js";
import { scanNotes, toPosix } from "../scan.js";
import { hasLiveSecret, scanSecrets } from "../redact.js";
import { readRedactConfig, scanStaged } from "../staged-scan.js";
import { redactIgnoreFromMetadata } from "../redactignore.js";
import { readGrooming } from "../grooming/config.js";
import {
  PROPOSAL_BRANCH_PREFIX,
  judgeProposal,
} from "../grooming/proposal-gate.js";
import {
  createPullRequest,
  filterDirtyPathsOutsideKb,
  getDefaultBranch,
  getDirtyPaths,
  getRepoRoot,
  gitAdd,
  gitTrackedPaths,
  branchHasUniqueCommits,
  resolveBranchRef,
  getCurrentBranch,
  gitCheckoutBranch,
  gitCheckoutNewBranch,
  gitDeleteBranch,
  gitCommit,
  gitUnstage,
  gitPush,
  hasGh,
  hasGit,
} from "../git.js";
import {
  type StagedDraft,
  addStagedRejects,
  discardDraft,
  promoteBatch,
  readStagedDrafts,
} from "../grooming/staging.js";
import { recoverCcFrontmatter } from "../adapters/claude-code/cc-note.js";
import { GROOM_LADDER_TEXT } from "../adapters/claude-code/memory-hook.js";
import { noteTitle, parseNote, writeNote } from "../note.js";
import { type Rung, RUNGS, checkAdmission } from "../scanner/admission.js";
import { genreOf } from "../scanner/genre-map.js";
import { parseTrigger } from "../scanner/trigger.js";
import { index } from "./index-cmd.js";

const DEFAULT_LIMIT = 10;

/** Options for {@link groomCmd}. */
export interface GroomOptions {
  /** Working directory for resolving the docs root (default: cwd). */
  dir?: string;
  /** Emit the result as a single JSON line. */
  json?: boolean;
  /** Notes shown by the walk (default 10). Must be a positive integer. */
  limit?: number;
  /** Show every note; wins over `limit`. */
  all?: boolean;
  /** Promote these staged drafts to notes/ ("all" or a comma-separated slug list). */
  accept?: string;
  /** Discard these staged drafts ("all" or a comma-separated slug list). */
  reject?: string;
  /** Open a pull request with the promoted notes instead of leaving them uncommitted. */
  propose?: boolean;
}

/** One note in the walk. `problems` are the admission messages for it. */
export interface GroomNoteView {
  relPath: string;
  title: string;
  rung: Rung | null;
  trigger: string | null;
  pointer: string | null;
  problems: string[];
  /** A write the ladder denied, kept under notes/.held/ (#282): climb it, file it as a note, or delete it. */
  held?: true;
}

/** Result of {@link groomCmd}: a walk view XOR an accept/reject disposition. */
export interface GroomResult {
  /** Notes shown by the walk (default mode). */
  notes?: GroomNoteView[];
  /** How many notes the walk shows. */
  shown?: number;
  /** Memory-genre notes in the knowledge base. */
  total?: number;
  /** 0.0.17 drafts waiting in `.mage/staging/`. */
  staged?: number;
  /** notes-relative paths of promoted drafts (--accept). */
  accepted?: string[];
  /** slugs of discarded drafts (--reject). */
  rejected?: string[];
  /** Branch name created for the proposal (--propose). */
  proposalBranch?: string;
  /** URL of the pull request opened (--propose). */
  proposalPr?: string;
}

/**
 * Run `mage groom`. Resolves the docs root, then either disposes a batch of 0.0.17 drafts
 * (`--accept` / `--reject`, mutually exclusive) or walks the memory notes (the default).
 */
export async function groomCmd(opts: GroomOptions): Promise<GroomResult> {
  const resolved = await requireDocsRoot(opts.dir);
  const { root } = resolved;

  if (opts.accept !== undefined && opts.reject !== undefined) {
    throw new Error("mage groom: choose one of --accept / --reject, not both.");
  }
  if (opts.propose && opts.reject !== undefined) {
    throw new Error("mage groom: --propose cannot be used with --reject.");
  }
  if (opts.propose && opts.accept === undefined) {
    throw new Error("mage groom: --propose requires --accept.");
  }
  if (
    opts.limit !== undefined &&
    !opts.all &&
    !(Number.isInteger(opts.limit) && opts.limit > 0)
  ) {
    throw new Error("mage groom: --limit takes a positive integer");
  }

  let result: GroomResult;
  if (opts.accept === undefined && opts.reject === undefined) {
    result = await walk(resolved, opts);
  } else {
    const staged = await readStagedDrafts(stagingPath(root));
    result =
      opts.accept !== undefined
        ? opts.propose
          ? await proposeBatch(resolved, staged, opts.accept, opts)
          : await acceptBatch(resolved, staged, opts.accept, opts)
        : await rejectBatch(root, staged, opts.reject ?? "", opts);
  }
  // Emit JSON once, at the top level; the sub-functions only do human logging.
  if (opts.json) process.stdout.write(`${JSON.stringify(result)}\n`);
  return result;
}

// ─── the walk (read-only) ────────────────────────────────────────────────────

async function viewNote(root: string, entry: { relPath: string; title?: string }): Promise<GroomNoteView> {
  const raw = await readFile(join(root, entry.relPath), "utf8").catch(() => "");
  const { frontmatter } = parseNote(raw);
  const recovered = recoverCcFrontmatter(frontmatter).frontmatter;
  const rung = (RUNGS as readonly unknown[]).includes(recovered.rung) ? (recovered.rung as Rung) : null;
  const pointer = typeof recovered.pointer === "string" && recovered.pointer.trim() ? recovered.pointer : null;
  return {
    relPath: entry.relPath,
    title: entry.title ?? noteTitle(parseNote(raw).body, entry.relPath),
    rung,
    trigger: parseTrigger(recovered.trigger)?.when ?? null,
    pointer,
    problems: checkAdmission(frontmatter, raw).map((p) => p.message),
  };
}

/** Notes without a rung first; each group by `created` ascending, missing last, then path. */
function walkOrder(a: WalkItem, b: WalkItem): number {
  if ((a.view.rung === null) !== (b.view.rung === null)) return a.view.rung === null ? -1 : 1;
  if (a.created !== b.created) {
    if (a.created === undefined) return 1;
    if (b.created === undefined) return -1;
    return a.created < b.created ? -1 : 1;
  }
  return a.view.relPath < b.view.relPath ? -1 : a.view.relPath > b.view.relPath ? 1 : 0;
}

interface WalkItem {
  created: string | undefined;
  view: GroomNoteView;
}

async function walk(resolved: ResolvedDocsRoot, opts: GroomOptions): Promise<GroomResult> {
  const { root } = resolved;
  const [scanned, overrides, drafts] = await Promise.all([
    scanNotes(root),
    readGenreOverrides(resolved, false),
    readStagedDrafts(stagingPath(root)),
  ]);
  const memory = scanned.filter((e) => genreOf(e.type, overrides) === "memory");
  const views = await Promise.all(memory.map((e) => viewNote(root, e)));
  const ordered = memory
    .map((e, i): WalkItem => ({ created: e.created, view: views[i] as GroomNoteView }))
    .sort(walkOrder)
    .map((item) => item.view);
  const heldViews = await Promise.all(
    (await listHeld(root)).map(async (abs) => ({
      ...(await viewNote(root, { relPath: toPosix(relative(root, abs)) })),
      held: true as const,
    })),
  );
  ordered.unshift(...heldViews);

  const limit = opts.all ? ordered.length : (opts.limit ?? DEFAULT_LIMIT);
  const notes = ordered.slice(0, limit);
  const result: GroomResult = {
    notes,
    shown: notes.length,
    total: ordered.length,
    staged: drafts.length,
  };
  if (opts.json) return result;

  logger.info(`mage groom: ${notes.length} of ${ordered.length} notes to judge (notes without a rung come first).`);
  notes.forEach((n, i) => {
    logger.info(
      `  ${i + 1}. ${n.held ? "[held] " : ""}${n.relPath}  "${n.title}"  rung: ${n.rung ?? "-"}  trigger: ${n.trigger ?? "-"}  pointer: ${n.pointer ?? "-"}`,
    );
  });
  if (ordered.length > notes.length) {
    logger.info(`  ${ordered.length - notes.length} more: mage groom --all`);
  }
  logger.info(
    "For each note: climb (build the rung below, then delete the note), delete (stale, or a copy of a source),\n" +
      "or keep (add rung, trigger and pointer). mage never commits: land the whole diff as one pull request.",
  );
  if (heldViews.length > 0) {
    logger.info(
      "[held] notes are writes the ladder denied once: climb them, move them to notes/<slug>.md with rung, trigger and pointer, or delete them.",
    );
  }
  if (drafts.length > 0) {
    logger.info(
      `${drafts.length} staged draft(s) from 0.0.17 wait in .mage/staging/: mage groom --accept|--reject <slugs|all>`,
    );
  }
  logger.blank();
  logger.info(GROOM_LADDER_TEXT);
  return result;
}

// ─── accept: promote to notes/ + re-index ────────────────────────────────────

async function acceptBatch(
  resolved: ResolvedDocsRoot,
  staged: StagedDraft[],
  spec: string,
  opts: GroomOptions,
): Promise<GroomResult> {
  const root = resolved.root;
  const selected = select(spec, staged);
  // Stamp provenance at the creation chokepoint (ADR-0031): repo + commit on every
  // accepted note, and `autonomy` when this groom runs under approver/overseer (the
  // reject-ledger's authorship mark — ADR-0030). Resolved once for the batch.
  const stamp = await resolveCreationStamp(resolved);
  const accepted = await promoteBatch(root, selected, stamp);
  // Regenerate INDEX over the now-larger notes/ set. In --json mode, keep index()'s
  // human logging off stdout so the single JSON line groomCmd emits stays clean.
  await index({ dir: opts.dir, quiet: opts.json });

  const result: GroomResult = { accepted };
  if (opts.json) return result;
  logger.success(`Promoted ${accepted.length} draft(s) to notes/ and re-indexed.`);
  for (const rel of accepted) logger.detail(rel);
  logger.step("Review the diff and commit when ready (the human commits — ADR-0013).");
  return result;
}

// ─── reject: discard + record the key ────────────────────────────────────────

async function rejectBatch(
  root: string,
  staged: StagedDraft[],
  spec: string,
  opts: GroomOptions,
): Promise<GroomResult> {
  const selected = select(spec, staged);
  await addStagedRejects(root, selected.map((d) => d.key));
  for (const draft of selected) await discardDraft(draft);

  const result: GroomResult = { rejected: selected.map((d) => d.slug) };
  if (opts.json) return result;
  logger.success(`Rejected ${selected.length} draft(s) — they won't be re-drafted.`);
  return result;
}

// ─── propose: branch + commit + push + pr + review stamp (ADR-0057) ────────

/**
 * Best-effort return to where the user was before a failed proposal run. The branch is
 * deleted ONLY when it holds no commit of its own: once `gitCommit` has run, the promoted
 * note exists nowhere else (the draft is already consumed), so deleting would destroy it.
 * Returns the branch name when it was kept, so the caller can say so. Never throws.
 */
async function restoreBranch(
  repo: string,
  originBranch: string | null,
  proposalBranch: string,
  defaultBranch: string,
  startPoint: string,
): Promise<string | null> {
  // A detached HEAD (what a CI checkout gives you by default) has no branch to return
  // to, so fall back to the default branch rather than reporting a phantom commit.
  const target = originBranch ?? defaultBranch;
  if (target === proposalBranch) return proposalBranch;
  if (!(await gitCheckoutBranch(repo, target))) return proposalBranch;
  // Compare against the START POINT, not wherever the user stood: cut from defaultBranch,
  // so anything unique to the proposal branch is mage's own commit and nothing else.
  if (await branchHasUniqueCommits(repo, startPoint, proposalBranch)) return proposalBranch;
  await gitDeleteBranch(repo, proposalBranch);
  return null;
}

async function proposeBatch(
  resolved: ResolvedDocsRoot,
  staged: StagedDraft[],
  spec: string,
  opts: GroomOptions,
): Promise<GroomResult> {
  // Normalise both sides through realpath and resolve so paths differing only in form
  // (e.g. symlinks or trailing slashes) compare equal.
  const kbRepo = await realpath(resolve(resolved.repo)).catch(() => resolve(resolved.repo));
  const root = await realpath(resolve(resolved.root)).catch(() => resolve(resolved.root));
  const selected = select(spec, staged);

  const first = selected[0];
  if (!first) {
    throw new Error("mage groom: no drafts selected to propose.");
  }

  // Step 3: Build ProposalRequest and call judgeProposal
  const proposalsEnabled = (await readGrooming(resolved)).proposals;
  // Fail closed: falling back to kbRepo here would make judgeProposal's `repoRoot !==
  // kbRepo` check compare kbRepo to itself and never fire, vacuously passing condition 5.
  const rawRepoRoot = await getRepoRoot(kbRepo);
  if (!rawRepoRoot) {
    throw new Error(
      `mage groom --propose: could not determine the git repository root for \`${kbRepo}\`; is it a git repository?`,
    );
  }
  const repoRoot = await realpath(resolve(rawRepoRoot)).catch(() => resolve(rawRepoRoot));
  const defaultBranch = await getDefaultBranch(kbRepo);
  const branchSuffix =
    selected.length === 1
      ? first.slug
      : `${first.slug}-and-${selected.length - 1}-more`;
  const branchName = `${PROPOSAL_BRANCH_PREFIX}${branchSuffix}`;

  // Gate-2 redaction check: scan candidate drafts + staged files
  const stagedScan = await scanStaged(kbRepo);
  let redactionBlocked = stagedScan.blocked;
  if (!redactionBlocked) {
    // The same `metadata.redact` allowlist Gate-2 applies at commit time, so a literal the
    // KB has allowed does not block here and then pass there.
    const allow = redactIgnoreFromMetadata(await readRedactConfig(resolved.repo, resolved.kind)).literals;
    for (const draft of selected) {
      const findings = scanSecrets(`${JSON.stringify(draft.frontmatter)}\n${draft.body}`, allow);
      if (hasLiveSecret(findings)) {
        redactionBlocked = true;
        break;
      }
    }
  }

  const dirtyPaths = await getDirtyPaths(kbRepo);
  // A hub repo IS the knowledge base in its entirety (ADR-0012), so for a hub-owned KB
  // the boundary is the repo, not `<hub>/projects/<name>/`. Measured in CI: the hub's own
  // metadata.json — the file that carries `grooming.proposals` — read as outside the KB
  // and refused every run, and `mage index` rewrites hub-root INDEX.md on every run too.
  const kbBoundary = resolved.kind === "hub" ? kbRepo : root;
  const dirtyPathsOutsideKb = filterDirtyPathsOutsideKb(kbRepo, kbBoundary, dirtyPaths);

  const verdict = judgeProposal({
    repoRoot,
    kbRepo,
    proposalsEnabled,
    defaultBranch,
    branchName,
    redactionBlocked,
    dirtyPathsOutsideKb,
    noteCount: selected.length,
  });

  if (!verdict.ok) {
    throw new Error(verdict.message);
  }

  // Step 4: Create branch, promote, commit, push, open PR
  if (!(await hasGit())) {
    throw new Error("git is required to propose notes.");
  }
  if (!(await hasGh())) {
    throw new Error("gh (GitHub CLI) is required to open pull requests.");
  }

  const originBranch = await getCurrentBranch(kbRepo);
  // Cut from the default branch, never from HEAD: on a feature branch the proposal PR
  // would otherwise carry that branch's unrelated commits (ADR-0057).
  const startPoint = await resolveBranchRef(kbRepo, defaultBranch);
  if (!startPoint) {
    throw new Error(
      `mage groom --propose: cannot resolve the default branch \`${defaultBranch}\` locally or as \`origin/${defaultBranch}\`, so there is nothing safe to cut the proposal branch from. Fetch it first (in CI, actions/checkout leaves no local branch: \`git fetch origin ${defaultBranch}\`).`,
    );
  }
  await gitCheckoutNewBranch(kbRepo, branchName, startPoint);

  let accepted: string[];
  let prUrl: string;
  // Tracked outside the try: promoteBatch consumes the staged drafts, so if a later step
  // throws the error must be able to say where the notes ended up.
  let promoted: string[] = [];
  let committed = false;
  let pushed = false;
  try {
    // Stamp channel at creation (ADR-0057). No autonomy mark.
    const stamp = await resolveCreationStamp(resolved, { channel: "pipeline" });
    accepted = await promoteBatch(root, selected, stamp);
    promoted = accepted;
    const indexed = await index({ dir: opts.dir, quiet: opts.json });

    // Stage what this run wrote: the promoted notes, index outputs, and any cleaned index files.
    // Scoped strictly to concrete paths so unrelated dirty or pre-staged files in the repo
    // (inside or outside the KB) are not swept into the proposal commit (ADR-0057).
    const commitPaths = [
      ...[...accepted, ...indexed.written].map((rel) => join(root, rel)),
      ...(await gitTrackedPaths(kbRepo, indexed.deleted.map((rel) => join(root, rel)))),
    ];
    await gitAdd(kbRepo, commitPaths);

    // Gate-2 over what is ACTUALLY staged. The earlier scan ran before anything was
    // added, so it saw an empty index; `gitAdd` sweeps in every dirty file under the
    // KB root, which the dirty-path check deliberately permits (ADR-0014, ADR-0057).
    const indexScan = await scanStaged(kbRepo);
    if (indexScan.blocked) {
      // Unstage before throwing: `git checkout` carries staged changes back to the
      // user's branch, where their next commit would sweep the secret in.
      await gitUnstage(kbRepo, commitPaths).catch(() => {});
      throw new Error(
        "mage groom --propose: the redaction scan blocked the staged content, so nothing was committed or pushed. The content was unstaged and is still in your working tree.",
      );
    }

    const commitMsg1 =
      selected.length === 1
        ? `feat(memory): propose note ${first.slug}`
        : `feat(memory): propose ${selected.length} notes`;
    // Scope to root: for a hub-owned KB gitAdd only staged the project subtree, and an
    // unscoped commit would sweep in whatever else was already staged in the hub repo.
    await gitCommit(kbRepo, commitMsg1, commitPaths);
    committed = true;
    await gitPush(kbRepo, branchName);
    pushed = true;

    // Open PR
    const prTitle =
      selected.length === 1
        ? `feat(memory): propose note ${first.slug}`
        : `feat(memory): propose ${selected.length} notes`;
    const prBody = formatProposalPrBody(selected);
    prUrl = await createPullRequest(kbRepo, {
      branch: branchName,
      base: defaultBranch,
      title: prTitle,
      body: prBody,
    });
  } catch (err) {
    // Leaving the user on a half-built proposal branch with their drafts already
    // consumed is unrecoverable without hand-run git. Put them back where they were.
    const kept = await restoreBranch(kbRepo, originBranch, branchName, defaultBranch, startPoint);
    const why = err instanceof Error ? err.message : String(err);
    if (kept && committed) {
      // The right advice depends entirely on whether the push landed, and only a live run
      // shows the difference: every test mocks gitPush.
      const next = pushed
        ? `It is already pushed, so finish by hand once the cause is fixed:\n  gh pr create --head ${kept} --base ${defaultBranch}`
        : "It has NOT been pushed, so this branch is the only copy. Push it or cherry-pick from it once the cause is fixed.";
      throw new Error(
        `${why}\n\nYour notes are committed on \`${kept}\`, which has been left in place — the staged drafts are already consumed. ${next}`,
      );
    }
    if (kept && !committed) {
      // restoreBranch also returns the branch when it simply could not check out away
      // from it. That is not evidence of a commit, so say what is actually true.
      throw new Error(
        `${why}\n\nNothing was committed. You may still be on \`${kept}\`; the ${promoted.length} promoted note(s) are uncommitted in your working tree${promoted.length > 0 ? `: ${promoted.join(", ")}` : ""}.`,
      );
    }
    if (promoted.length > 0) {
      // No commit was made, so the branch is gone — but promoteBatch already moved the
      // drafts out of staging, so re-running reports "no staged draft" and the user has
      // no way to know the files are sitting there uncommitted.
      throw new Error(
        `${why}\n\nNothing was committed or pushed, but ${promoted.length} note(s) were already written and their staged drafts consumed. They are uncommitted in your working tree: ${promoted.join(", ")}. Commit them yourself, or delete them to start over.`,
      );
    }
    throw err;
  }

  // Step 5: Follow-up commit stamping review
  try {
    for (const rel of accepted) {
      const notePath = join(root, rel);
      const raw = await readFile(notePath, "utf8");
      const { frontmatter, body } = parseNote(raw);
      const updatedFm = stampProvenance(frontmatter, { review: prUrl });
      await writeNote(notePath, updatedFm, body);
    }
    const provenancePaths = accepted.map((rel) => join(root, rel));
    await gitAdd(kbRepo, provenancePaths);
    await gitCommit(kbRepo, `chore(provenance): record review ${prUrl}`, provenancePaths);
    await gitPush(kbRepo, branchName);
  } catch (err) {
    logger.warn(
      `Could not record review stamp on proposal branch: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const result: GroomResult = {
    accepted,
    proposalBranch: branchName,
    proposalPr: prUrl,
  };

  if (opts.json) return result;
  logger.success(`Promoted ${accepted.length} draft(s) to notes/ and opened proposal PR.`);
  for (const rel of accepted) logger.detail(rel);
  logger.detail(`Branch: ${branchName}`);
  logger.detail(`Pull Request: ${prUrl}`);
  return result;
}

function formatProposalPrBody(drafts: StagedDraft[]): string {
  const lines = [
    "## Proposed Knowledge Notes",
    "",
    "Proposed via `mage groom --accept … --propose` (ADR-0057).",
    "",
    "### Notes",
    "",
  ];
  for (const d of drafts) {
    lines.push(`- **${d.title}** (\`${d.slug}\`)`);
  }
  lines.push("");
  return lines.join("\n");
}

// ─── selection ───────────────────────────────────────────────────────────────

/** Resolve "all" or a comma-separated slug list to drafts; throws on an unknown slug. */
function select(spec: string, staged: StagedDraft[]): StagedDraft[] {
  if (spec.trim() === "all") {
    if (staged.length === 0) throw new Error("mage groom: no staged drafts to act on.");
    return staged;
  }
  const slugs = spec
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (slugs.length === 0) throw new Error("mage groom: no drafts selected (pass slugs or 'all').");
  return slugs.map((slug) => {
    const found = staged.find((d) => d.slug === slug);
    if (!found) throw new Error(`mage groom: no staged draft '${slug}'.`);
    return found;
  });
}
