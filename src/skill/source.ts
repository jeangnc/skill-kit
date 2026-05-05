import { stat, readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { formatZodIssues } from "../errors/index.js";
import {
  formatFrontmatterError,
  parseFrontmatter,
  type FrontmatterError,
} from "../parsing/index.js";
import { err, ok, type Result } from "../result.js";

import { SkillSchema, type Skill } from "./schema.js";

export type SkillSource = "ts" | "md";

export interface SkillFile {
  readonly path: string;
  readonly source: SkillSource;
}

export interface LoadedSkill {
  readonly skill: Skill;
  readonly body: string;
  readonly source: SkillSource;
  readonly skillFilePath: string;
  readonly bodyFilePath: string;
  readonly skillDir: string;
  readonly bodyOffset: number;
}

export interface FindSkillFileError {
  readonly tag: "ambiguous-source";
  readonly skillDir: string;
}

export type LoadSkillError =
  | { readonly tag: "ambiguous-source"; readonly skillDir: string }
  | { readonly tag: "no-source"; readonly skillDir: string }
  | { readonly tag: "schema-violation"; readonly path: string; readonly issues: readonly string[] }
  | { readonly tag: "missing-body"; readonly path: string; readonly bodyPath: string }
  | { readonly tag: "forbidden-body"; readonly path: string; readonly bodyPath: string }
  | {
      readonly tag: "invalid-frontmatter";
      readonly path: string;
      readonly cause: FrontmatterError;
    };

export async function findSkillFile(
  skillDir: string,
): Promise<Result<SkillFile | null, FindSkillFileError>> {
  const tsPath = join(skillDir, "SKILL.ts");
  const mdPath = join(skillDir, "SKILL.md");
  const [tsExists, mdExists] = await Promise.all([pathExists(tsPath), pathExists(mdPath)]);
  if (tsExists && mdExists) {
    return err({ tag: "ambiguous-source", skillDir });
  }
  if (tsExists) return ok({ path: tsPath, source: "ts" });
  if (mdExists) return ok({ path: mdPath, source: "md" });
  return ok(null);
}

export async function loadSkill(skillDir: string): Promise<Result<LoadedSkill, LoadSkillError>> {
  const file = await findSkillFile(skillDir);
  if (!file.ok) return err(file.error);
  if (!file.value) return err({ tag: "no-source", skillDir });
  return file.value.source === "ts"
    ? loadFromTs(file.value.path, skillDir)
    : loadFromMd(file.value.path, skillDir);
}

export function formatLoadSkillError(error: LoadSkillError): readonly string[] {
  switch (error.tag) {
    case "ambiguous-source":
      return [`both SKILL.ts and SKILL.md exist at ${error.skillDir} — pick one`];
    case "no-source":
      return [`no SKILL.ts or SKILL.md found at ${error.skillDir}`];
    case "schema-violation":
      return error.issues;
    case "missing-body":
      return [`missing sibling body.md at ${error.bodyPath}`];
    case "forbidden-body":
      return [
        "body.md is forbidden when SKILL.md is the source — body lives inline below the frontmatter",
      ];
    case "invalid-frontmatter":
      return [formatFrontmatterError(error.cause)];
  }
}

async function loadFromTs(
  skillFilePath: string,
  skillDir: string,
): Promise<Result<LoadedSkill, LoadSkillError>> {
  const mod = (await import(pathToFileURL(skillFilePath).href)) as { default: unknown };
  const parsed = SkillSchema.safeParse(mod.default);
  if (!parsed.success) {
    return err({
      tag: "schema-violation",
      path: skillFilePath,
      issues: formatZodIssues(parsed.error),
    });
  }
  const bodyPath = join(skillDir, "body.md");
  let body: string;
  try {
    body = await readFile(bodyPath, "utf8");
  } catch {
    return err({ tag: "missing-body", path: skillFilePath, bodyPath });
  }
  return ok({
    skill: parsed.data,
    body,
    source: "ts",
    skillFilePath,
    bodyFilePath: bodyPath,
    skillDir,
    bodyOffset: 0,
  });
}

async function loadFromMd(
  skillFilePath: string,
  skillDir: string,
): Promise<Result<LoadedSkill, LoadSkillError>> {
  const bodyPath = join(skillDir, "body.md");
  if (await pathExists(bodyPath)) {
    return err({ tag: "forbidden-body", path: skillFilePath, bodyPath });
  }
  const raw = await readFile(skillFilePath, "utf8");
  const fm = parseFrontmatter(raw);
  if (!fm.ok) {
    return err({ tag: "invalid-frontmatter", path: skillFilePath, cause: fm.error });
  }
  const parsed = SkillSchema.safeParse(fm.value.data);
  if (!parsed.success) {
    return err({
      tag: "schema-violation",
      path: skillFilePath,
      issues: formatZodIssues(parsed.error),
    });
  }
  return ok({
    skill: parsed.data,
    body: fm.value.body,
    source: "md",
    skillFilePath,
    bodyFilePath: skillFilePath,
    skillDir,
    bodyOffset: fm.value.bodyOffset,
  });
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}
