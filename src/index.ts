export {
  CompanionSchema,
  SkillSchema,
  checkCompanionFiles,
  defineSkill,
  findSkillFile,
  formatLoadSkillError,
  isReservedCompanionFilename,
  loadSkill,
} from "./skill/index.js";
export type {
  Companion,
  FindSkillFileError,
  LoadedSkill,
  LoadSkillError,
  Skill,
  SkillFile,
  SkillSource,
} from "./skill/index.js";

export { ContextEntrySchema, PluginSchema, definePlugin } from "./plugin/index.js";
export type { ContextEntry, Plugin } from "./plugin/index.js";

export { formatFrontmatterError, parseFrontmatter } from "./parsing/index.js";
export type { FrontmatterError, ParsedFrontmatter } from "./parsing/index.js";

export { err, ok } from "./result.js";
export type { Result } from "./result.js";

export { parsePlaceholders, substitute } from "./placeholders/index.js";
export type {
  Placeholder,
  SubstituteResult,
  Validator,
  ValidatorRegistry,
  ValidatorResult,
} from "./placeholders/index.js";

export { compile } from "./compile/index.js";
export type { BodyInvariant, CompileOptions } from "./compile/index.js";

export { build } from "./build.js";
export type { BuildOptions } from "./build.js";

export { install, uninstall } from "./install/index.js";
export type { InstallOptions, Target } from "./install/index.js";

export { check } from "./check.js";
export type {
  CheckOptions,
  CheckResult,
  ExtViolation,
  ExtViolationKind,
  SourceSummary,
} from "./check.js";

export { defaultSources, discoverInstalledSkills, indexSkills } from "./installed.js";
export type { InstalledSkill, PluginSource } from "./installed.js";
