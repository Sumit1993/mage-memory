// Programmatic API — re-exports each command so users can import and call from
// their own scripts. CLI in src/cli.ts wraps these with commander.

export { type AgentsMdOptions, writeAgentsMd } from "./agents-md.js";
export { buildProgram } from "./cli-program.js";
export {
  buildGeneratedDocsData,
  DOCS_DATA_SCHEMA,
  type GeneratedDocsData,
  serializeGeneratedDocsData,
} from "./docs/generated-data.js";
export {
  type ClaudeSettings,
  type HookCommand,
  type HookGroup,
  MAGE_HOOKS,
  MAGE_ID_PREFIX,
  readClaudeSettings,
  removeMageHooks,
  resolveSettingsTarget,
  upsertMageHooks,
  writeClaudeSettings,
} from "./adapters/claude-code/settings.js";
export {
  type ConnectOptions,
  type ConnectResult,
  connect,
} from "./commands/connect.js";
export {
  type DisconnectOptions,
  type DisconnectResult,
  disconnect,
} from "./commands/disconnect.js";
export {
  distillCmd,
  type DistillOptions,
  type DistillResult,
} from "./commands/distill-cmd.js";
export {
  type DoctorCheck,
  type DoctorOptions,
  type DoctorResult,
  doctor,
} from "./commands/doctor.js";
export {
  type DreamCmdOptions,
  type DreamResult,
  dream,
} from "./commands/dream-cmd.js";
export {
  type IndexOptions,
  type IndexResult,
  index,
} from "./commands/index-cmd.js";
export {
  type IngestCmdOptions,
  ingestCmd,
} from "./commands/ingest.js";
export {
  type InitMode,
  type InitOptions,
  type InitResult,
  type InitVisibility,
  init,
} from "./commands/init.js";
export {
  type LinkOptions,
  type LinkResult,
  link,
  type Storage,
} from "./commands/link.js";
export {
  type ListOptions,
  type ListResult,
  list,
  type ProjectInfo,
} from "./commands/list.js";
export {
  type RedactOptions,
  type RedactResult,
  redactCmd,
} from "./commands/redact.js";
export {
  type SkillsOptions,
  type SkillsResult,
  skills,
} from "./commands/skills-cmd.js";
export {
  type RepoStatus,
  type StatusOptions,
  type StatusResult,
  status,
} from "./commands/status.js";
export {
  type UnlinkOptions,
  type UnlinkResult,
  unlink,
} from "./commands/unlink.js";
export {
  type VerifyOptions,
  type VerifyResult,
  verify,
} from "./commands/verify.js";
export {
  analyzeDream,
  type DreamFinding,
  type DreamOptions,
  type DreamReport,
} from "./dream.js";
export {
  deriveKeywords,
  type Note,
  type NoteFrontmatter,
  type NoteStatus,
  normalizeTags,
  noteHeaders,
  noteRoom,
  noteTitle,
  noteWing,
  noteWings,
  type Provenance,
  parseNote,
  readNote,
  stringifyNote,
  writeNote,
} from "./note.js";
export {
  assignWingColors,
  type ColorGroup,
  updateGraphColorGroups,
  writeObsidianScaffold,
} from "./obsidian.js";
export {
  type HubMetadata,
  type HubProject,
  type HubRef,
  type MageMetadata,
  METADATA_SCHEMA,
  resolveDocsRoot,
} from "./paths.js";
export {
  type IngestKind,
  type IngestSource,
  scanIngestSources,
} from "./ingest.js";
export {
  type ObserveOptions,
  observeCmd,
} from "./commands/observe.js";
export {
  promoteCmd,
  type PromoteOptions,
  type PromoteResult,
} from "./commands/promote-cmd.js";
export {
  isInteractive,
  type ResolveDecisionArgs,
  resolveDecision,
} from "./interactive.js";
export {
  computeSessionMatches,
  DEMOTE_MATCH_RATE,
  type LoadOutcome,
  loadMatches,
  LOW_MATCH_RATE,
  MATCH_WINDOW,
  type MatchDimension,
  MIN_LOADS_FOR_SUGGESTION,
} from "./metrics/context-match.js";
export {
  foldRollup,
  readRollup,
  type Rollup,
  ROLLUP_FILE,
  rollupPath,
  ROLLUP_VERSION,
  type SkillMetricRow,
  type SkillStat,
  summarize,
  writeRollup,
  METRICS_DIR as ROLLUP_METRICS_DIR,
} from "./metrics/rollup.js";
// Observe schema: the runtime constant is a value export; the rest are type-only
// (verbatimModuleSyntax requires the split).
export { OBSERVE_SCHEMA_VERSION } from "./observe/types.js";
export type {
  CompactEvent,
  ObserveEnvelope,
  ObserveEvent,
  ObserveEventType,
  SessionEndEvent,
  SessionStartEvent,
  SkillLoadEvent,
  SkillMatch,
  ToolUseEvent,
  UserPromptEvent,
} from "./observe/types.js";
export {
  hasLiveSecret,
  redact,
  type SecretFinding,
  scanSecrets,
} from "./redact.js";
// distill core (ADR-0018): the deterministic reader, its candidate-cluster types,
// and the per-session offset watermark the `--seen` write commits.
export {
  computeDistillClusters,
  readDistill,
  SALIENCE_CAP,
} from "./distill/reader.js";
export type {
  DistillCluster,
  DistillManifest,
} from "./distill/types.js";
export {
  advanceWatermark,
  DISTILL_FILE,
  DISTILL_VERSION,
  type DistillWatermark,
  distillWatermarkPath,
  readWatermark,
  writeWatermark,
} from "./distill/watermark.js";
// Gate-2 redaction (ADR-0018 §7): the staged-blob scan + the pre-commit hook
// installer/remover `mage connect`/`mage disconnect` drive.
export {
  installRedactHook,
  type InstallHookResult,
  REDACT_HOOK_MARKER,
  removeRedactHook,
  type RemoveHookResult,
  resolveHooksDir,
} from "./git-hooks.js";
export {
  scanStaged,
  type StagedFinding,
} from "./staged-scan.js";
export { type ScannedNote, scanNotes } from "./scan.js";
// grooming core (ADR-0019): the deterministic promote pipeline — signature
// extraction → recurrence tally → covering-note gate → manifest builder, plus the
// thresholds seam/dial and the gitignored proposal/rejected stores.
export type {
  Lens,
  LensCounts,
  Proposal,
  ProposalAction,
  PromoteManifest,
  PromoteTally,
  SessionFold,
  SignatureHit,
  SignatureStat,
} from "./grooming/types.js";
export {
  BASE_THRESHOLDS,
  DEFAULT_SENSITIVITY,
  narrowSensitivity,
  type Sensitivity,
  type Thresholds,
  thresholdsFor,
} from "./grooming/thresholds.js";
// The grooming-config seam (ADR-0030): one read locates metadata.json → grooming; every
// field narrows off it and the writer rides the same path. Replaces the per-field readers.
export {
  groomingFieldIsSet,
  readAutonomy,
  readGrooming,
  readSensitivity,
  type ResolvedGrooming,
  writeGroomingField,
} from "./grooming/config.js";
// The opt-in autonomy ladder (ADR-0030): Operator → Approver → Overseer.
export {
  type Autonomy,
  DEFAULT_AUTONOMY,
  LEVELS as AUTONOMY_LEVELS,
  coerceAutonomy,
  mandateFor,
  meaningOf,
  narrowAutonomy,
} from "./grooming/autonomy-ladder.js";
export {
  keywordsFromText,
  segmentSignatures,
  SIG_KEYWORDS,
  wingFromSegment,
} from "./grooming/signature.js";
export {
  foldSession,
  foldTally,
  PROMOTE_FILE,
  promoteTallyPath,
  PROMOTE_VERSION,
  readTally,
  writeTally,
} from "./grooming/tally.js";
export { coveringNote, isCovered } from "./grooming/covering-note.js";
export {
  isRejected,
  PROPOSALS_FILE,
  proposalsPath,
  readProposals,
  readRejected,
  REJECTED_FILE,
  rejectedPath,
  writeProposals,
  writeRejected,
} from "./grooming/proposals.js";
// `noteProposalFor` is GONE with the note-proposal rung (ADR-0038).
export { buildManifest, graduateProposalFor } from "./grooming/promote.js";
// dream applier (ADR-0019 §6 / ADR-0016 §4): the single serialized writer that turns
// a confirmed Proposal into file changes, enforcing the §3 ceilings. The executors
// (graduate/demote/merge/split/reword) are READ-ONLY planners; the applier is the one
// choke point. "Detection proposes, dream applies."
export { applyProposal } from "./dream/applier.js";
export type {
  ApplyResult,
  FileArchive,
  FileWrite,
  MutationPlan,
} from "./dream/types.js";
export { planGraduate, renderProcedureSkill } from "./dream/graduate.js";
export { planDemote } from "./dream/demote.js";
export { type MergePayload, planMerge } from "./dream/merge.js";
export {
  planSplit,
  type SplitNewNote,
  type SplitPayload,
} from "./dream/split.js";
export { planReword, type RewordPayload } from "./dream/reword.js";
