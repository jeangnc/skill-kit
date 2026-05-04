import { mkdir, readdir, readFile, copyFile, writeFile, stat } from "node:fs/promises";
import { basename, dirname, join, relative } from "node:path";
import { pathToFileURL } from "node:url";

import { SkillSchema, type Companion, type Skill } from "./skill.js";
import { checkCompanionFiles } from "./invariants.js";
import { parsePlaceholders, substitute, type ValidatorRegistry } from "./placeholders.js";

export type BodyInvariant = (body: string) => string[];

export interface CompileOptions {
  readonly srcRoot: string;
  readonly outRoot: string;
  readonly bodyInvariants?: readonly BodyInvariant[];
}

const ALLOWED_TOP_LEVEL = ["plugins", ".claude-plugin"] as const;
const COMPANIONS_PREFIX = "companions";

export async function compile(options: CompileOptions): Promise<void> {
  const { srcRoot, outRoot } = options;
  const localSkillIds = await discoverLocalSkillIds(srcRoot);
  for (const sub of ALLOWED_TOP_LEVEL) {
    const subPath = join(srcRoot, sub);
    if (await pathExists(subPath)) {
      await mirror(subPath, join(outRoot, sub), localSkillIds, options.bodyInvariants ?? []);
    }
  }
}

async function discoverLocalSkillIds(srcRoot: string): Promise<ReadonlySet<string>> {
  const ids = new Set<string>();
  const pluginsRoot = join(srcRoot, "plugins");
  if (!(await pathExists(pluginsRoot))) return ids;
  const plugins = await readdir(pluginsRoot, { withFileTypes: true });
  for (const plugin of plugins) {
    if (!plugin.isDirectory()) continue;
    const skillsDir = join(pluginsRoot, plugin.name, "skills");
    if (!(await pathExists(skillsDir))) continue;
    const skills = await readdir(skillsDir, { withFileTypes: true });
    for (const skill of skills) {
      if (!skill.isDirectory()) continue;
      if (await pathExists(join(skillsDir, skill.name, "SKILL.ts"))) {
        ids.add(`${plugin.name}:${skill.name}`);
      }
    }
  }
  return ids;
}

async function mirror(
  srcRoot: string,
  outRoot: string,
  localSkillIds: ReadonlySet<string>,
  bodyInvariants: readonly BodyInvariant[],
): Promise<void> {
  const skillFolders = await collectSkillFolders(srcRoot);

  for await (const absPath of walk(srcRoot)) {
    const rel = relative(srcRoot, absPath);
    const target = join(outRoot, rel);

    if (basename(absPath) === "SKILL.ts") {
      const companions = skillFolders.get(dirname(absPath)) ?? [];
      await emitSkill(
        absPath,
        join(dirname(target), "SKILL.md"),
        companions,
        localSkillIds,
        bodyInvariants,
      );
      continue;
    }

    if (absPath.endsWith(".ts")) continue;
    if (basename(absPath) === "body.md") continue;

    await mkdir(dirname(target), { recursive: true });
    await copyFile(absPath, target);
  }
}

async function collectSkillFolders(srcRoot: string): Promise<Map<string, string[]>> {
  const result = new Map<string, string[]>();
  for await (const absPath of walk(srcRoot)) {
    const dir = dirname(absPath);
    const file = basename(absPath);
    if (file === "SKILL.ts") {
      result.set(dir, result.get(dir) ?? []);
    } else if (file.endsWith(".md") && file !== "SKILL.md" && file !== "body.md") {
      const list = result.get(dir) ?? [];
      list.push(file);
      result.set(dir, list);
    }
  }
  return result;
}

async function emitSkill(
  srcPath: string,
  outPath: string,
  siblings: readonly string[],
  localSkillIds: ReadonlySet<string>,
  bodyInvariants: readonly BodyInvariant[],
): Promise<void> {
  const mod = (await import(pathToFileURL(srcPath).href)) as { default: unknown };
  const parsed = SkillSchema.safeParse(mod.default);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`);
    throw new Error(`invariant violations in ${srcPath}:\n  - ${issues.join("\n  - ")}`);
  }
  const skill: Skill = parsed.data;
  const expectedName = basename(dirname(srcPath));

  const bodyPath = join(dirname(srcPath), "body.md");
  let body: string;
  try {
    body = await readFile(bodyPath, "utf8");
  } catch {
    throw new Error(
      `invariant violations in ${srcPath}:\n  - missing sibling body.md at ${bodyPath}`,
    );
  }

  const errors: string[] = [];
  if (skill.name !== expectedName) {
    errors.push(`name "${skill.name}" does not match folder "${expectedName}"`);
  }
  for (const check of bodyInvariants) {
    errors.push(...check(body));
  }
  errors.push(...checkCompanionFiles(skill.companions, siblings));
  errors.push(...checkCompanionsTokenParity(body, skill.companions));

  if (errors.length > 0) {
    throw new Error(`invariant violations in ${srcPath}:\n  - ${errors.join("\n  - ")}`);
  }

  const registry = buildRegistry(skill.companions, localSkillIds);
  const result = substitute(body, registry);
  if (!result.ok) {
    throw new Error(`invariant violations in ${srcPath}:\n  - ${result.errors.join("\n  - ")}`);
  }

  const frontmatter = `---\nname: ${skill.name}\ndescription: ${skill.description}\n---\n\n`;
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, frontmatter + result.rendered);
}

function buildRegistry(
  companions: readonly Companion[] | undefined,
  localSkillIds: ReadonlySet<string>,
): ValidatorRegistry {
  const declaredCompanions = new Set((companions ?? []).map((c) => c.file));
  return {
    skill: (value) => {
      if (value === null) return { ok: false, error: "expected `{{skill:<plugin>:<name>}}`" };
      if (!localSkillIds.has(value)) {
        return { ok: false, error: `unknown skill id "${value}" — not a local skill` };
      }
      return { ok: true, rendered: `\`${value}\`` };
    },
    external: (value) => {
      if (value === null) return { ok: false, error: "expected `{{external:<id>}}`" };
      return { ok: true, rendered: `\`${value}\`` };
    },
    companion: (value) => {
      if (value === null) return { ok: false, error: "expected `{{companion:<file>.md}}`" };
      if (!declaredCompanions.has(value)) {
        return { ok: false, error: `companion "${value}" is not declared in companions` };
      }
      return { ok: true, rendered: `\`${value}\`` };
    },
    [COMPANIONS_PREFIX]: () => {
      if (!companions?.length) {
        return { ok: false, error: "no companions are declared on this skill" };
      }
      return { ok: true, rendered: renderCompanions(companions) };
    },
  };
}

function renderCompanions(companions: readonly Companion[]): string {
  const bullets = companions.map((c) => `- \`${c.file}\` — ${c.summary}`).join("\n");
  return `## Companion files (read on demand)\n\n${bullets}`;
}

function checkCompanionsTokenParity(
  body: string,
  companions: readonly Companion[] | undefined,
): string[] {
  const hasCompanions = (companions?.length ?? 0) > 0;
  if (!hasCompanions) return [];
  const hasToken = parsePlaceholders(body).some(
    (t) => t.prefix === COMPANIONS_PREFIX && t.value === null,
  );
  if (!hasToken) {
    return [`companions declared but body is missing the {{${COMPANIONS_PREFIX}}} placeholder`];
  }
  return [];
}

async function* walk(dir: string): AsyncGenerator<string> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (entry.isFile()) yield full;
  }
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}
