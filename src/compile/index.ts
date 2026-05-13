import { copyFile, mkdir, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { compileTree, type BodyInvariant, type LocalIds, type OwningPlugin } from "./emit.js";
import { pathExists, throwInvariantViolations } from "./discovery.js";
import { loadLayout, type LayoutAdapter, type ResolvedPlugin } from "../layout/index.js";
import type { HookRequirement, Plugin } from "../plugin/index.js";

export type { BodyInvariant } from "./emit.js";

export interface CompileOptions {
  readonly srcRoot: string;
  readonly outRoot: string;
  readonly bodyInvariants?: readonly BodyInvariant[];
}

export async function compile(options: CompileOptions): Promise<void> {
  const { srcRoot, outRoot } = options;
  const adapter = await loadAdapter(srcRoot);
  const localIds = await collectLocalIds(adapter);
  await checkContextFiles(adapter);
  checkHookRequires(adapter, localIds);

  await copyMarketplaceManifest(srcRoot, outRoot);
  for (const plugin of adapter.plugins) {
    await emitPlugin(plugin, outRoot, localIds, options.bodyInvariants ?? []);
  }
}

async function loadAdapter(srcRoot: string): Promise<LayoutAdapter> {
  const result = await loadLayout(srcRoot);
  if (result.ok) return result.value;
  const error = result.error;
  switch (error.kind) {
    case "marketplace-missing":
      throw new Error(`marketplace.json not found at ${error.path}`);
    case "marketplace-invalid":
      return throwInvariantViolations(error.path, error.issues);
    case "plugin-missing":
      throw new Error(`plugin "${error.name}" not found at ${error.path}`);
    case "manifest-missing":
      return throwInvariantViolations(error.pluginDir, [
        `plugin "${error.name}": no PLUGIN.ts or .claude-plugin/plugin.json`,
      ]);
    case "manifest-collision":
      return throwInvariantViolations(join(error.pluginDir, "PLUGIN.ts"), [
        `both PLUGIN.ts and .claude-plugin/plugin.json exist at ${error.pluginDir} — pick one`,
      ]);
    case "manifest-invalid":
      return throwInvariantViolations(error.path, error.issues);
    case "plugin-name-mismatch":
      return throwInvariantViolations(error.path, [
        `name "${error.manifestName}" does not match folder "${error.entryName}"`,
      ]);
  }
}

async function collectLocalIds(adapter: LayoutAdapter): Promise<LocalIds> {
  const skills = new Set<string>();
  const commands = new Set<string>();
  const agents = new Set<string>();
  for (const plugin of adapter.plugins) {
    for (const name of await listSkills(plugin.skillsDir)) skills.add(`${plugin.name}:${name}`);
    for (const name of await listFlat(plugin.commandsDir)) commands.add(`${plugin.name}:${name}`);
    for (const name of await listFlat(plugin.agentsDir)) agents.add(`${plugin.name}:${name}`);
  }
  return { skills, commands, agents };
}

async function listSkills(dir: string): Promise<readonly string[]> {
  if (!(await pathExists(dir))) return [];
  const entries = await readdir(dir, { withFileTypes: true });
  const out: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const skillDir = join(dir, entry.name);
    const [hasTs, hasMd] = await Promise.all([
      pathExists(join(skillDir, "SKILL.ts")),
      pathExists(join(skillDir, "SKILL.md")),
    ]);
    if (hasTs || hasMd) out.push(entry.name);
  }
  return out;
}

async function listFlat(dir: string): Promise<readonly string[]> {
  if (!(await pathExists(dir))) return [];
  const entries = await readdir(dir, { withFileTypes: true });
  const out: string[] = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!entry.name.endsWith(".md")) continue;
    out.push(entry.name.slice(0, -3));
  }
  return out;
}

async function copyMarketplaceManifest(srcRoot: string, outRoot: string): Promise<void> {
  const src = join(srcRoot, ".claude-plugin/marketplace.json");
  const dst = join(outRoot, ".claude-plugin/marketplace.json");
  await mkdir(join(outRoot, ".claude-plugin"), { recursive: true });
  await copyFile(src, dst);
}

async function emitPlugin(
  plugin: ResolvedPlugin,
  outRoot: string,
  localIds: LocalIds,
  bodyInvariants: readonly BodyInvariant[],
): Promise<void> {
  const pluginOutDir = join(outRoot, "plugins", plugin.name);
  await emitPluginManifest(plugin, pluginOutDir);
  const contextFiles = pluginContextFiles(plugin);
  const owner: OwningPlugin = {
    name: plugin.name,
    dependencies: new Set(plugin.manifest.dependencies ?? []),
  };
  await compileTree({
    srcRoot: plugin.pluginDir,
    outRoot: pluginOutDir,
    localIds,
    bodyInvariants,
    contextFiles,
    owner,
  });
}

async function emitPluginManifest(plugin: ResolvedPlugin, pluginOutDir: string): Promise<void> {
  const target = join(pluginOutDir, ".claude-plugin/plugin.json");
  await mkdir(join(pluginOutDir, ".claude-plugin"), { recursive: true });
  await writeFile(target, JSON.stringify(toLegacyPluginJson(plugin.manifest), null, 2) + "\n");
}

type LegacyPluginManifest = Omit<Plugin, "context" | "hookRequires">;

function toLegacyPluginJson(plugin: Plugin): LegacyPluginManifest {
  const { context: _ctx, hookRequires: _hr, ...legacy } = plugin;
  return legacy;
}

function pluginContextFiles(plugin: ResolvedPlugin): ReadonlySet<string> {
  const result = new Set<string>();
  for (const entry of plugin.manifest.context ?? []) {
    result.add(join(plugin.pluginDir, entry.file));
  }
  return result;
}

async function checkContextFiles(adapter: LayoutAdapter): Promise<void> {
  for (const plugin of adapter.plugins) {
    const errors: string[] = [];
    for (const entry of plugin.manifest.context ?? []) {
      if (!(await pathExists(join(plugin.pluginDir, entry.file)))) {
        errors.push(`context entry: file not found: ${entry.file}`);
      }
    }
    if (errors.length > 0) {
      throwInvariantViolations(join(plugin.pluginDir, "PLUGIN.ts"), errors);
    }
  }
}

function checkHookRequires(adapter: LayoutAdapter, localIds: LocalIds): void {
  for (const plugin of adapter.plugins) {
    const errors: string[] = [];
    for (const req of plugin.manifest.hookRequires ?? []) {
      const violation = hookRequireViolation(req, localIds);
      if (violation) errors.push(`hookRequires (${req.event}): ${violation}`);
    }
    if (errors.length > 0) {
      throwInvariantViolations(join(plugin.pluginDir, "PLUGIN.ts"), errors);
    }
  }
}

function hookRequireViolation(req: HookRequirement, localIds: LocalIds): string | null {
  if (req.skill !== undefined) {
    return localIds.skills.has(req.skill) ? null : `${req.skill} is not a local skill`;
  }
  if (req.command !== undefined) {
    return localIds.commands.has(req.command) ? null : `${req.command} is not a local command`;
  }
  if (req.agent !== undefined) {
    return localIds.agents.has(req.agent) ? null : `${req.agent} is not a local agent`;
  }
  return null;
}
