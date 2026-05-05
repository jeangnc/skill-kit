import { stat, readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { parseFrontmatter } from "./frontmatter.js";
import { SkillSchema, type Skill } from "./skill.js";
import { formatZodIssues } from "./zod.js";

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

export async function findSkillFile(skillDir: string): Promise<SkillFile | null> {
  const tsPath = join(skillDir, "SKILL.ts");
  const mdPath = join(skillDir, "SKILL.md");
  const [tsExists, mdExists] = await Promise.all([pathExists(tsPath), pathExists(mdPath)]);
  if (tsExists && mdExists) {
    throw new Error(`both SKILL.ts and SKILL.md exist at ${skillDir} — pick one`);
  }
  if (tsExists) return { path: tsPath, source: "ts" };
  if (mdExists) return { path: mdPath, source: "md" };
  return null;
}

export async function loadSkill(skillDir: string): Promise<LoadedSkill> {
  const file = await findSkillFile(skillDir);
  if (!file) {
    throw new Error(`no SKILL.ts or SKILL.md found at ${skillDir}`);
  }
  return file.source === "ts" ? loadFromTs(file.path, skillDir) : loadFromMd(file.path, skillDir);
}

async function loadFromTs(skillFilePath: string, skillDir: string): Promise<LoadedSkill> {
  const mod = (await import(pathToFileURL(skillFilePath).href)) as { default: unknown };
  const parsed = SkillSchema.safeParse(mod.default);
  if (!parsed.success) {
    throwInvariantViolations(skillFilePath, formatZodIssues(parsed.error));
  }
  const bodyPath = join(skillDir, "body.md");
  let body: string;
  try {
    body = await readFile(bodyPath, "utf8");
  } catch {
    throwInvariantViolations(skillFilePath, [`missing sibling body.md at ${bodyPath}`]);
  }
  return {
    skill: parsed.data,
    body,
    source: "ts",
    skillFilePath,
    bodyFilePath: bodyPath,
    skillDir,
    bodyOffset: 0,
  };
}

async function loadFromMd(skillFilePath: string, skillDir: string): Promise<LoadedSkill> {
  if (await pathExists(join(skillDir, "body.md"))) {
    throwInvariantViolations(skillFilePath, [
      "body.md is forbidden when SKILL.md is the source — body lives inline below the frontmatter",
    ]);
  }
  const raw = await readFile(skillFilePath, "utf8");
  const { data, body, bodyOffset } = parseFrontmatter(raw, skillFilePath);
  const parsed = SkillSchema.safeParse(data);
  if (!parsed.success) {
    throwInvariantViolations(skillFilePath, formatZodIssues(parsed.error));
  }
  return {
    skill: parsed.data,
    body,
    source: "md",
    skillFilePath,
    bodyFilePath: skillFilePath,
    skillDir,
    bodyOffset,
  };
}

function throwInvariantViolations(srcPath: string, errors: readonly string[]): never {
  throw new Error(`invariant violations in ${srcPath}:
  - ${errors.join("\n  - ")}`);
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}
