import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { PluginSchema, type Plugin } from "../plugin/index.js";
import { formatZodIssues } from "../errors/index.js";

export async function pathExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

export function throwInvariantViolations(srcPath: string, errors: readonly string[]): never {
  throw new Error(`invariant violations in ${srcPath}:\n  - ${errors.join("\n  - ")}`);
}

export async function discoverPlugins(srcRoot: string): Promise<ReadonlyMap<string, Plugin>> {
  const result = new Map<string, Plugin>();
  const pluginsRoot = join(srcRoot, "plugins");
  if (!(await pathExists(pluginsRoot))) return result;
  const plugins = await readdir(pluginsRoot, { withFileTypes: true });
  for (const plugin of plugins) {
    if (!plugin.isDirectory()) continue;
    const pluginRoot = join(pluginsRoot, plugin.name);
    const pluginTsPath = join(pluginRoot, "PLUGIN.ts");
    if (!(await pathExists(pluginTsPath))) continue;

    const legacyManifestPath = join(pluginRoot, ".claude-plugin/plugin.json");
    if (await pathExists(legacyManifestPath)) {
      throwInvariantViolations(pluginTsPath, [
        `both PLUGIN.ts and .claude-plugin/plugin.json exist at ${pluginRoot} — pick one`,
      ]);
    }

    const mod = (await import(pathToFileURL(pluginTsPath).href)) as { default: unknown };
    const parsed = PluginSchema.safeParse(mod.default);
    if (!parsed.success) {
      throwInvariantViolations(pluginTsPath, formatZodIssues(parsed.error));
    }
    const pluginManifest: Plugin = parsed.data;

    if (pluginManifest.name !== plugin.name) {
      throwInvariantViolations(pluginTsPath, [
        `name "${pluginManifest.name}" does not match folder "${plugin.name}"`,
      ]);
    }

    const fileErrors: string[] = [];
    for (const entry of pluginManifest.context ?? []) {
      if (!(await pathExists(join(pluginRoot, entry.file)))) {
        fileErrors.push(`context entry: file not found: ${entry.file}`);
      }
    }
    if (fileErrors.length > 0) throwInvariantViolations(pluginTsPath, fileErrors);

    result.set(plugin.name, pluginManifest);
  }
  return result;
}

export async function discoverLocalSkillIds(srcRoot: string): Promise<ReadonlySet<string>> {
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
      const skillDir = join(skillsDir, skill.name);
      const [hasTs, hasMd] = await Promise.all([
        pathExists(join(skillDir, "SKILL.ts")),
        pathExists(join(skillDir, "SKILL.md")),
      ]);
      if (hasTs || hasMd) {
        ids.add(`${plugin.name}:${skill.name}`);
      }
    }
  }
  return ids;
}
