export { defineSkill, SkillSchema, CompanionSchema } from "./skill.js";
export type { Skill, Companion } from "./skill.js";
export { compile } from "./compile.js";
export type { CompileOptions, BodyInvariant } from "./compile.js";
export { build } from "./build.js";
export type { BuildOptions } from "./build.js";
export { install, uninstall } from "./install.js";
export type { InstallOptions, Target } from "./install.js";
export { checkCompanionFiles } from "./invariants.js";
export { parsePlaceholders, substitute } from "./placeholders.js";
export type {
  Placeholder,
  Validator,
  ValidatorRegistry,
  ValidatorResult,
  SubstituteResult,
} from "./placeholders.js";
