// Programmatic API — re-exports each command so users can import and call from
// their own scripts. CLI in src/cli.ts wraps these with commander.

export {
  init,
  type InitOptions,
  type InitResult,
  type InitMode,
  type InitVisibility,
} from "./commands/init.js";
export { link, type LinkOptions, type LinkResult, type Storage } from "./commands/link.js";
export { verify, type VerifyOptions, type VerifyResult } from "./commands/verify.js";
export { unlink, type UnlinkOptions, type UnlinkResult } from "./commands/unlink.js";
export { list, type ListOptions, type ListResult, type ProjectInfo } from "./commands/list.js";
export {
  status,
  type StatusOptions,
  type StatusResult,
  type RepoStatus,
} from "./commands/status.js";
export {
  doctor,
  type DoctorOptions,
  type DoctorResult,
  type DoctorCheck,
} from "./commands/doctor.js";
export { index, type IndexOptions, type IndexResult } from "./commands/index-cmd.js";
export { skills, type SkillsOptions, type SkillsResult } from "./commands/skills-cmd.js";
export { scanNotes, type ScannedNote } from "./scan.js";

export {
  type Note,
  type NoteFrontmatter,
  type NoteStatus,
  type Provenance,
  readNote,
  writeNote,
  parseNote,
  stringifyNote,
  noteWing,
  noteRoom,
  normalizeTags,
  noteTitle,
  noteHeaders,
  deriveKeywords,
} from "./note.js";
export {
  writeObsidianScaffold,
  updateGraphColorGroups,
  assignWingColors,
  type ColorGroup,
} from "./obsidian.js";
export { writeAgentsMd, type AgentsMdOptions } from "./agents-md.js";

export {
  type MageMetadata,
  type HubMetadata,
  type HubProject,
  type HubRef,
  METADATA_SCHEMA,
  resolveDocsRoot,
} from "./paths.js";
