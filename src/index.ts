// Programmatic API — re-exports each command so users can import and call from
// their own scripts. CLI in src/cli.ts wraps these with commander.

export { type AgentsMdOptions, writeAgentsMd } from "./agents-md.js";
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
  hasLiveSecret,
  redact,
  type SecretFinding,
  scanSecrets,
} from "./redact.js";
export { type ScannedNote, scanNotes } from "./scan.js";
