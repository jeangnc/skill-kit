import { mkdir, readdir, copyFile, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";

import { dump } from "js-yaml";

import {
  checkCompanionFiles,
  formatLoadSkillError,
  isReservedCompanionFilename,
  loadSkill,
  type Companion,
  type Skill,
} from "../skill/index.js";
import { expandIncludes, formatIncludeError } from "../skill/includes.js";
import { type Plugin } from "../plugin/index.js";
import { parsePlaceholders, substitute, type ValidatorRegistry } from "../placeholders/index.js";

import { pathExists, throwInvariantViolations } from "./discovery.js";

const COMPANIONS_PREFIX = "companions";
const SKILL_SOURCE_FILENAMES: ReadonlySet<string> = new Set(["SKILL.ts", "SKILL.md"]);
const EXT_ID_PATTERN = /^[a-z0-9-]+:[a-z0-9-]+$/;

export interface LocalIds {
  readonly skills: ReadonlySet<string>;
  readonly commands: ReadonlySet<string>;
  readonly agents: ReadonlySet<string>;
}

export interface OwningPlugin {
  readonly name: string;
  readonly dependencies: ReadonlySet<string>;
}

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

type LegacyPluginManifest = Omit<Plugin, "context">;

function toLegacyPluginJson(plugin: Plugin): LegacyPluginManifest {
  const { context, ...legacy } = plugin;
  return legacy;
}

export async function compileTree(
  srcRoot: string,
  outRoot: string,
  localIds: LocalIds,
  bodyInvariants: readonly BodyInvariant[],
  contextFiles: ReadonlySet<string> = new Set(),
  pluginsByName: ReadonlyMap<string, Plugin> = new Map(),
): Promise<void> {
  const skillFolders = await collectSkillFolders(srcRoot);
  const handledAbsPaths = new Set<string>();
  const ownerFor = (absPath: string): OwningPlugin | null =>
    resolveOwner(srcRoot, absPath, pluginsByName);

  for await (const absPath of walk(srcRoot)) {
    if (!SKILL_SOURCE_FILENAMES.has(basename(absPath))) continue;
    const target = join(outRoot, relative(srcRoot, absPath));
    const companions = skillFolders.get(dirname(absPath)) ?? [];
    const result = await emitSkill(
      absPath,
      join(dirname(target), "SKILL.md"),
      companions,
      localIds,
      bodyInvariants,
      ownerFor(absPath),
    );
    for (const p of result.resolvedIncludes) handledAbsPaths.add(p);
  }

  for (const absPath of contextFiles) {
    const target = join(outRoot, relative(srcRoot, absPath));
    await emitContextFile(absPath, target, localIds, ownerFor(absPath));
    handledAbsPaths.add(absPath);
  }

  for await (const absPath of walk(srcRoot)) {
    const file = basename(absPath);
    if (SKILL_SOURCE_FILENAMES.has(file)) continue;
    if (absPath.endsWith(".ts")) continue;
    if (file === "body.md") continue;
    if (handledAbsPaths.has(absPath)) continue;

    const target = join(outRoot, relative(srcRoot, absPath));
    await mkdir(dirname(target), { recursive: true });
    await copyFile(absPath, target);
  }
}

async function emitContextFile(
  srcPath: string,
  outPath: string,
  localIds: LocalIds,
  owner: OwningPlugin | null,
): Promise<void> {
  const raw = await readFile(srcPath, "utf8");
  const dir = dirname(srcPath);
  const expanded = await expandIncludes(raw, srcPath, dir);
  if (!expanded.ok) {
    throwInvariantViolations(srcPath, expanded.error.map(formatIncludeError));
  }
  const expandedBody = expanded.value.body;
  const existingRefs = await precomputeExistingRefs(expandedBody, dir);
  const registry = buildRegistry(undefined, localIds, existingRefs, dir, owner);
  const result = substitute(expandedBody, registry);
  if (!result.ok) {
    throwInvariantViolations(srcPath, result.errors);
  }
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, result.rendered);
}

function resolveOwner(
  srcRoot: string,
  absPath: string,
  pluginsByName: ReadonlyMap<string, Plugin>,
): OwningPlugin | null {
  const rel = relative(srcRoot, absPath);
  if (rel.startsWith("..")) return null;
  const [first] = rel.split("/");
  if (!first) return null;
  const plugin = pluginsByName.get(first);
  if (!plugin) return null;
  return { name: plugin.name, dependencies: new Set(plugin.dependencies ?? []) };
}

async function collectSkillFolders(srcRoot: string): Promise<Map<string, string[]>> {
  const result = new Map<string, string[]>();
  for await (const absPath of walk(srcRoot)) {
    const dir = dirname(absPath);
    const file = basename(absPath);
    if (SKILL_SOURCE_FILENAMES.has(file)) {
      result.set(dir, result.get(dir) ?? []);
    } else if (file.endsWith(".md") && !isReservedCompanionFilename(file)) {
      const list = result.get(dir) ?? [];
      list.push(file);
      result.set(dir, list);
    }
  }
  return result;
}

interface EmitResult {
  readonly resolvedIncludes: ReadonlySet<string>;
}

async function emitSkill(
  srcPath: string,
  outPath: string,
  siblings: readonly string[],
  localIds: LocalIds,
  bodyInvariants: readonly BodyInvariant[],
  owner: OwningPlugin | null,
): Promise<EmitResult> {
  const skillDir = dirname(srcPath);
  const loaded = await loadSkill(skillDir);
  if (!loaded.ok) {
    throwInvariantViolations(srcPath, formatLoadSkillError(loaded.error));
  }
  const { skill, body } = loaded.value;
  const expectedName = basename(skillDir);

  const expanded = await expandIncludes(body, loaded.value.skillFilePath, skillDir);
  if (!expanded.ok) {
    throwInvariantViolations(srcPath, expanded.error.map(formatIncludeError));
  }
  const expandedBody = expanded.value.body;
  const includedFilenames = new Set(
    [...expanded.value.resolvedIncludes].map((p) => relative(skillDir, p)),
  );
  const filteredSiblings = siblings.filter((s) => !includedFilenames.has(s));

  const errors: string[] = [];
  if (skill.name !== expectedName) {
    errors.push(`name "${skill.name}" does not match folder "${expectedName}"`);
  }
  for (const check of bodyInvariants) {
    errors.push(...check(expandedBody));
  }
  errors.push(...checkCompanionFiles(skill.companions, filteredSiblings));
  errors.push(...checkCompanionsTokenParity(expandedBody, skill.companions));

  if (errors.length > 0) {
    throwInvariantViolations(srcPath, errors);
  }

  const existingRefs = await precomputeExistingRefs(expandedBody, skillDir);
  const registry = buildRegistry(skill.companions, localIds, existingRefs, skillDir, owner);
  const result = substitute(expandedBody, registry);
  if (!result.ok) {
    throwInvariantViolations(srcPath, result.errors);
  }

  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, renderFrontmatter(skill) + result.rendered);

  return { resolvedIncludes: expanded.value.resolvedIncludes };
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
  localIds: LocalIds,
  existingRefs: ReadonlySet<string>,
  skillDir: string,
  owner: OwningPlugin | null,
): ValidatorRegistry {
  return {
    skill: (value) => {
      if (value === null) return { ok: false, error: "expected `{{skill:<plugin>:<name>}}`" };
      if (!localIds.skills.has(value)) {
        return { ok: false, error: `unknown skill id "${value}" — not a local skill` };
      }
      const crossPlugin = crossPluginViolation(value, owner);
      if (crossPlugin) return { ok: false, error: crossPlugin };
      return { ok: true, rendered: `\`${value}\`` };
    },
    command: (value) => {
      if (value === null) return { ok: false, error: "expected `{{command:<plugin>:<command>}}`" };
      if (!EXT_ID_PATTERN.test(value)) {
        return {
          ok: false,
          error: `command id "${value}" must match <plugin>:<command> (kebab-case)`,
        };
      }
      if (!localIds.commands.has(value)) {
        return { ok: false, error: `unknown command id "${value}" — not a local command` };
      }
      const crossPlugin = crossPluginViolation(value, owner);
      if (crossPlugin) return { ok: false, error: crossPlugin };
      return { ok: true, rendered: `\`/${value}\`` };
    },
    agent: (value) => {
      if (value === null) return { ok: false, error: "expected `{{agent:<plugin>:<agent>}}`" };
      if (!EXT_ID_PATTERN.test(value)) {
        return {
          ok: false,
          error: `agent id "${value}" must match <plugin>:<agent> (kebab-case)`,
        };
      }
      if (!localIds.agents.has(value)) {
        return { ok: false, error: `unknown agent id "${value}" — not a local agent` };
      }
      const crossPlugin = crossPluginViolation(value, owner);
      if (crossPlugin) return { ok: false, error: crossPlugin };
      return { ok: true, rendered: `\`${bareName(value)}\`` };
    },
    ext: (value) => {
      if (value === null) return { ok: false, error: "expected `{{ext:<plugin>:<skill>}}`" };
      if (!EXT_ID_PATTERN.test(value)) {
        return { ok: false, error: `ext id "${value}" must match <plugin>:<skill> (kebab-case)` };
      }
      return { ok: true, rendered: `\`${value}\`` };
    },
    "ext-command": (value) => {
      if (value === null) {
        return { ok: false, error: "expected `{{ext-command:<plugin>:<command>}}`" };
      }
      if (!EXT_ID_PATTERN.test(value)) {
        return {
          ok: false,
          error: `ext-command id "${value}" must match <plugin>:<command> (kebab-case)`,
        };
      }
      return { ok: true, rendered: `\`/${value}\`` };
    },
    "ext-agent": (value) => {
      if (value === null) return { ok: false, error: "expected `{{ext-agent:<plugin>:<agent>}}`" };
      if (!EXT_ID_PATTERN.test(value)) {
        return {
          ok: false,
          error: `ext-agent id "${value}" must match <plugin>:<agent> (kebab-case)`,
        };
      }
      return { ok: true, rendered: `\`${bareName(value)}\`` };
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

function bareName(id: string): string {
  const idx = id.indexOf(":");
  return idx === -1 ? id : id.slice(idx + 1);
}

function crossPluginViolation(id: string, owner: OwningPlugin | null): string | null {
  if (!owner) return null;
  const idx = id.indexOf(":");
  if (idx === -1) return null;
  const otherPlugin = id.slice(0, idx);
  if (otherPlugin === owner.name) return null;
  if (owner.dependencies.has(otherPlugin)) return null;
  return `cross-plugin reference to "${otherPlugin}" requires "${otherPlugin}" in ${owner.name}'s dependencies`;
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
