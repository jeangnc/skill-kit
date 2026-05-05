import { mkdir, readdir, copyFile, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";

import { dump } from "js-yaml";

import { RESERVED_COMPANION_FILENAMES, type Companion, type Skill } from "../skill.js";
import { type Plugin } from "../plugin.js";
import { checkCompanionFiles } from "../invariants.js";
import { parsePlaceholders, substitute, type ValidatorRegistry } from "../placeholders.js";
import { loadSkill } from "../skill-source.js";

import { pathExists, throwInvariantViolations } from "./discovery.js";

const COMPANIONS_PREFIX = "companions";
const SKILL_SOURCE_FILENAMES: ReadonlySet<string> = new Set(["SKILL.ts", "SKILL.md"]);
const EXT_ID_PATTERN = /^[a-z0-9-]+:[a-z0-9-]+$/;

export type BodyInvariant = (body: string) => string[];

export async function emitPluginManifests(
  plugins: ReadonlyMap<string, Plugin>,
  outRoot: string,
): Promise<void> {
  for (const [name, plugin] of plugins) {
    const outManifest = join(outRoot, "plugins", name, ".claude-plugin/plugin.json");
    await mkdir(dirname(outManifest), { recursive: true });
    await writeFile(outManifest, JSON.stringify(toLegacyPluginJson(plugin), null, 2) + "\n");
  }
}

function toLegacyPluginJson(plugin: Plugin): Record<string, unknown> {
  const out: Record<string, unknown> = {
    name: plugin.name,
    version: plugin.version,
    description: plugin.description,
  };
  if (plugin.author) out.author = plugin.author;
  if (plugin.homepage) out.homepage = plugin.homepage;
  if (plugin.repository) out.repository = plugin.repository;
  if (plugin.license) out.license = plugin.license;
  if (plugin.keywords) out.keywords = plugin.keywords;
  if (plugin.dependencies) out.dependencies = plugin.dependencies;
  return out;
}

export async function compileTree(
  srcRoot: string,
  outRoot: string,
  localSkillIds: ReadonlySet<string>,
  bodyInvariants: readonly BodyInvariant[],
): Promise<void> {
  const skillFolders = await collectSkillFolders(srcRoot);

  for await (const absPath of walk(srcRoot)) {
    const rel = relative(srcRoot, absPath);
    const target = join(outRoot, rel);
    const file = basename(absPath);

    if (SKILL_SOURCE_FILENAMES.has(file)) {
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
    if (file === "body.md") continue;

    await mkdir(dirname(target), { recursive: true });
    await copyFile(absPath, target);
  }
}

async function collectSkillFolders(srcRoot: string): Promise<Map<string, string[]>> {
  const result = new Map<string, string[]>();
  for await (const absPath of walk(srcRoot)) {
    const dir = dirname(absPath);
    const file = basename(absPath);
    if (SKILL_SOURCE_FILENAMES.has(file)) {
      result.set(dir, result.get(dir) ?? []);
    } else if (file.endsWith(".md") && !RESERVED_COMPANION_FILENAMES.has(file)) {
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
  const skillDir = dirname(srcPath);
  const { skill, body } = await loadSkill(skillDir);
  const expectedName = basename(skillDir);

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
    throwInvariantViolations(srcPath, errors);
  }

  const existingRefs = await precomputeExistingRefs(body, skillDir);
  const registry = buildRegistry(skill.companions, localSkillIds, existingRefs, skillDir);
  const result = substitute(body, registry);
  if (!result.ok) {
    throwInvariantViolations(srcPath, result.errors);
  }

  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, renderFrontmatter(skill) + result.rendered);
}

function renderFrontmatter(skill: Skill): string {
  const lines = [`name: ${skill.name}`, `description: ${skill.description}`];
  if (skill.companions?.length) {
    lines.push(dump({ companions: skill.companions }).trimEnd());
  }
  return `---\n${lines.join("\n")}\n---\n\n`;
}

async function precomputeExistingRefs(
  body: string,
  skillDir: string,
): Promise<ReadonlySet<string>> {
  const refs = new Set<string>();
  const checks: Array<Promise<void>> = [];
  for (const token of parsePlaceholders(body)) {
    if (token.prefix === "ref" && token.value !== null) {
      const value = token.value;
      checks.push(
        pathExists(resolve(skillDir, value)).then((exists) => {
          if (exists) refs.add(value);
        }),
      );
    }
  }
  await Promise.all(checks);
  return refs;
}

function buildRegistry(
  companions: readonly Companion[] | undefined,
  localSkillIds: ReadonlySet<string>,
  existingRefs: ReadonlySet<string>,
  skillDir: string,
): ValidatorRegistry {
  return {
    skill: (value) => {
      if (value === null) return { ok: false, error: "expected `{{skill:<plugin>:<name>}}`" };
      if (!localSkillIds.has(value)) {
        return { ok: false, error: `unknown skill id "${value}" — not a local skill` };
      }
      return { ok: true, rendered: `\`${value}\`` };
    },
    ext: (value) => {
      if (value === null) return { ok: false, error: "expected `{{ext:<plugin>:<skill>}}`" };
      if (!EXT_ID_PATTERN.test(value)) {
        return { ok: false, error: `ext id "${value}" must match <plugin>:<skill> (kebab-case)` };
      }
      return { ok: true, rendered: `\`${value}\`` };
    },
    ref: (value) => {
      if (value === null) return { ok: false, error: "expected `{{ref:<relative-path>}}`" };
      if (!existingRefs.has(value)) {
        return { ok: false, error: `ref "${value}" not found relative to skill at ${skillDir}` };
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
  return `## Companion files (read on demand)

${bullets}`;
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
