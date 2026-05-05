import { readFile, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";

export interface PluginSource {
  readonly name: string;
  readonly root: string;
}

export interface InstalledSkill {
  readonly source: string;
  readonly plugin: string;
  readonly skill: string;
  readonly path: string;
}

export const DEFAULT_SOURCES: readonly PluginSource[] = [
  { name: "claude", root: join(homedir(), ".claude/plugins/cache") },
  { name: "codex", root: join(homedir(), ".codex/plugins/cache") },
];

const PLUGIN_MANIFEST_RELATIVE_PATHS = [
  ".claude-plugin/plugin.json",
  ".codex-plugin/plugin.json",
] as const;

export async function discoverInstalledSkills(
  sources: readonly PluginSource[],
): Promise<readonly InstalledSkill[]> {
  const all: InstalledSkill[] = [];
  for (const source of sources) {
    for await (const skillFile of walkSkillFiles(source.root)) {
      const pluginInfo = await findEnclosingPlugin(dirname(skillFile), source.root);
      if (!pluginInfo) continue;
      all.push({
        source: source.name,
        plugin: pluginInfo.name,
        skill: basename(dirname(skillFile)),
        path: skillFile,
      });
    }
  }
  return all;
}

export function indexSkills(
  skills: readonly InstalledSkill[],
): ReadonlyMap<string, readonly InstalledSkill[]> {
  const index = new Map<string, InstalledSkill[]>();
  for (const skill of skills) {
    const key = `${skill.plugin}:${skill.skill}`;
    const existing = index.get(key);
    if (existing) existing.push(skill);
    else index.set(key, [skill]);
  }
  return index;
}

async function* walkSkillFiles(dir: string): AsyncGenerator<string> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walkSkillFiles(full);
    } else if (entry.isFile() && entry.name === "SKILL.md") {
      yield full;
    }
  }
}

interface EnclosingPlugin {
  readonly name: string;
  readonly root: string;
}

async function findEnclosingPlugin(
  startDir: string,
  sourceRoot: string,
): Promise<EnclosingPlugin | null> {
  let current = startDir;
  while (current.startsWith(sourceRoot) && current !== sourceRoot) {
    for (const relPath of PLUGIN_MANIFEST_RELATIVE_PATHS) {
      const manifestPath = join(current, relPath);
      const name = await readPluginName(manifestPath);
      if (name) return { name, root: current };
    }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return null;
}

async function readPluginName(manifestPath: string): Promise<string | null> {
  let raw: string;
  try {
    raw = await readFile(manifestPath, "utf8");
  } catch {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as { name?: unknown };
    return typeof parsed.name === "string" && parsed.name.length > 0 ? parsed.name : null;
  } catch {
    return null;
  }
}
