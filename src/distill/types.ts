// distill core types (ADR-0018). Pure shapes — no runtime logic. The reader
// (reader.ts) groups un-distilled `.learnings/*.jsonl` events into candidate
// CLUSTERS carrying salient signals across the four ADR-0018 §4 lenses; the
// `mage:distill` skill reasons over them and drafts notes. These types are the
// locked contract the command and the integrator depend on.

/**
 * One candidate cluster the reader offers (ADR-0018 §4) — a closed "chapter" of
 * un-distilled events with its salient signals split across the four lenses. The
 * skill is free to split/merge; the reader only chops mechanically.
 */
export interface DistillCluster {
  /** Session id this cluster came from (the `.learnings/<session>.jsonl` basename). */
  session: string;
  /** Informational 1-based event span in the source file, e.g. `L3-L12`. */
  span: string;
  /** Salient signals across the four ADR-0018 lenses. */
  signals: {
    /** Lens ① scaffolding: every `user_prompt.text` in the segment. */
    prompts: string[];
    /** Lens ① (first-class): a prompt whose nearest preceding act was a `tool_use`. */
    corrections: string[];
    /** Lens ②: each failing `tool_use`'s error_summary (fallback detail). */
    failures: string[];
    /** Lenses ③/④: one-liners for the SALIENT tool_uses (a workflow/preference trace). */
    tools: string[];
  };
  /** A deterministic phrase nudging the likely note-type (e.g. "a failure (likely a gotcha)"). */
  hint: string;
}

/**
 * What `mage distill --json` emits: the candidate clusters plus the SUGGESTED
 * per-session watermark (`cursors`) the human commits with `mage distill --seen`
 * after dispositioning the batch. `capped` flags that a giant chapter was capped
 * and the spilled remainder will be re-offered next run (ADR-0018 §5).
 */
export interface DistillManifest {
  clusters: DistillCluster[];
  /** SUGGESTED next watermark per session (readDistill does NOT write it). */
  cursors: Record<string, number>;
  /** True iff any session capped its output past the salience budget. */
  capped: boolean;
}
