export { defineSkill, SkillSchema, CompanionSchema } from "./skill.js";
export type { Skill, Companion } from "./skill.js";
export { loadSkill, findSkillFile } from "./skill-source.js";
export type { LoadedSkill, SkillFile, SkillSource } from "./skill-source.js";
export { parseFrontmatter } from "./frontmatter.js";
export type { ParsedFrontmatter } from "./frontmatter.js";
export { definePlugin, PluginSchema, ContextEntrySchema } from "./plugin.js";
export type { Plugin, ContextEntry } from "./plugin.js";
export { compile } from "./compile/index.js";
export type { CompileOptions, BodyInvariant } from "./compile/index.js";
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
export { DEFAULT_SOURCES, discoverInstalledSkills, indexSkills } from "./sources.js";
export type { PluginSource, InstalledSkill } from "./sources.js";
export { checkCompanionFiles } from "./invariants.js";
export { parsePlaceholders, substitute } from "./placeholders.js";
export type {
  Placeholder,
  Validator,
  ValidatorRegistry,
  ValidatorResult,
  SubstituteResult,
} from "./placeholders.js";
