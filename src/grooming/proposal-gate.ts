// Refusal predicate for proposed writes (ADR-0046 §6, §7; plan Lane E).

/** The reserved branch namespace. Nothing outside it may be created. */
export const PROPOSAL_BRANCH_PREFIX = "mage/proposal/";
/** Max notes in one proposal PR (ADR-0046 §7). */
export const PROPOSAL_NOTE_CAP = 5;

export interface ProposalRequest {
  /** Absolute path of the git repo mage intends to write in. */
  repoRoot: string;
  /** `resolved.repo` of the knowledge base the notes belong to. */
  kbRepo: string;
  /** `grooming.proposals`, already narrowed. */
  proposalsEnabled: boolean;
  /** The repo's default branch name, e.g. "main". */
  defaultBranch: string;
  /** The branch mage intends to create. */
  branchName: string;
  /** True when the Gate-2 scan blocked. */
  redactionBlocked: boolean;
  /** Repo-relative dirty paths that are NOT under the knowledge base. */
  dirtyPathsOutsideKb: readonly string[];
  /** How many notes this run would propose. */
  noteCount: number;
}

export type ProposalVerdict =
  | { readonly ok: true }
  | { readonly ok: false; readonly message: string };

/**
 * Pure refusal predicate gating proposal writes (ADR-0046 §6).
 * Performs no I/O and reads no environment variable or terminal state.
 */
export function judgeProposal(req: ProposalRequest): ProposalVerdict {
  if (!req.proposalsEnabled) {
    return {
      ok: false,
      message:
        "proposals are off for this knowledge base; enable `grooming.proposals` to let mage open pull requests.",
    };
  }
  if (req.branchName === req.defaultBranch) {
    return {
      ok: false,
      message: `cannot propose on default branch '${req.defaultBranch}'; specify a proposal branch under '${PROPOSAL_BRANCH_PREFIX}'.`,
    };
  }
  if (!req.branchName.startsWith(PROPOSAL_BRANCH_PREFIX)) {
    return {
      ok: false,
      message: `branch '${req.branchName}' is outside '${PROPOSAL_BRANCH_PREFIX}'; proposal branches must stay in this namespace.`,
    };
  }
  if (req.redactionBlocked) {
    return {
      ok: false,
      message:
        "Gate-2 redaction scan blocked on live secret(s); remove secrets or allow false positives in metadata.redact before proposing.",
    };
  }
  if (req.repoRoot !== req.kbRepo) {
    return {
      ok: false,
      message: `repository '${req.repoRoot}' does not match knowledge base repository '${req.kbRepo}'; run proposals in the KB repo.`,
    };
  }
  if (req.dirtyPathsOutsideKb.length > 0) {
    const list = req.dirtyPathsOutsideKb.slice(0, 3).join(", ");
    const more =
      req.dirtyPathsOutsideKb.length > 3
        ? ` and ${req.dirtyPathsOutsideKb.length - 3} more`
        : "";
    return {
      ok: false,
      message: `working tree has dirty paths outside knowledge base (${list}${more}); commit, stash, or clean them before proposing.`,
    };
  }
  if (req.noteCount > PROPOSAL_NOTE_CAP) {
    return {
      ok: false,
      message: `cannot propose ${req.noteCount} notes in one pull request; limit is ${PROPOSAL_NOTE_CAP}. Propose fewer notes or split the batch.`,
    };
  }
  return { ok: true };
}
