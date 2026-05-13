import { readFile, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import { z } from "zod";

const PluginManifestSchema = z.object({ name: z.string().min(1) });

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

export interface InstalledCommand {
  readonly source: string;
  readonly plugin: string;
  readonly command: string;
  readonly path: string;
}

export interface InstalledAgent {
  readonly source: string;
  readonly plugin: string;
  readonly agent: string;
  readonly path: string;
}

export interface InstalledArtifacts {
  readonly skills: readonly InstalledSkill[];
  readonly commands: readonly InstalledCommand[];
  readonly agents: readonly InstalledAgent[];
}

export interface InstalledIndex {
  readonly skills: ReadonlyMap<string, readonly InstalledSkill[]>;
  readonly commands: ReadonlyMap<string, readonly InstalledCommand[]>;
  readonly agents: ReadonlyMap<string, readonly InstalledAgent[]>;
}

export function defaultSources(): readonly PluginSource[] {
  const home = homedir();
  return [
    { name: "claude", root: join(home, ".claude/plugins/cache") },
    { name: "codex", root: join(home, ".codex/plugins/cache") },
  ];
}

const PLUGIN_MANIFEST_RELATIVE_PATHS = [
  ".claude-plugin/plugin.json",
  ".codex-plugin/plugin.json",
] as const;

export async function discoverInstalled(
  sources: readonly PluginSource[],
): Promise<InstalledArtifacts> {
  const skills: InstalledSkill[] = [];
  const commands: InstalledCommand[] = [];
  const agents: InstalledAgent[] = [];
  for (const source of sources) {
    for await (const plugin of findPluginRoots(source.root)) {
      for await (const skill of collectSkills(plugin.root)) {
        skills.push({
          source: source.name,
          plugin: plugin.name,
          skill: skill.name,
          path: skill.path,
        });
      }
      for await (const cmd of collectFlat(plugin.root, "commands")) {
        commands.push({
          source: source.name,
          plugin: plugin.name,
          command: cmd.name,
          path: cmd.path,
        });
      }
      for await (const agent of collectFlat(plugin.root, "agents")) {
        agents.push({
          source: source.name,
          plugin: plugin.name,
          agent: agent.name,
          path: agent.path,
        });
      }
    }
  }
  return { skills, commands, agents };
}

export function indexInstalled(artifacts: InstalledArtifacts): InstalledIndex {
  return {
    skills: groupBy(artifacts.skills, (s) => `${s.plugin}:${s.skill}`),
    commands: groupBy(artifacts.commands, (c) => `${c.plugin}:${c.command}`),
    agents: groupBy(artifacts.agents, (a) => `${a.plugin}:${a.agent}`),
  };
}

export async function discoverInstalledSkills(
  sources: readonly PluginSource[],
): Promise<readonly InstalledSkill[]> {
  const { skills } = await discoverInstalled(sources);
  return skills;
}

export function indexSkills(
  skills: readonly InstalledSkill[],
): ReadonlyMap<string, readonly InstalledSkill[]> {
  return groupBy(skills, (s) => `${s.plugin}:${s.skill}`);
}

function groupBy<T>(items: readonly T[], key: (t: T) => string): ReadonlyMap<string, readonly T[]> {
  const result = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    const existing = result.get(k);
    if (existing) existing.push(item);
    else result.set(k, [item]);
  }
  return result;
}

interface PluginRoot {
  readonly name: string;
  readonly root: string;
}

async function* findPluginRoots(dir: string): AsyncGenerator<PluginRoot> {
  const name = await readPluginNameAt(dir);
  if (name !== null) {
    yield { name, root: dir };
    return;
  }
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) yield* findPluginRoots(join(dir, entry.name));
  }
}

async function readPluginNameAt(dir: string): Promise<string | null> {
  for (const rel of PLUGIN_MANIFEST_RELATIVE_PATHS) {
    const name = await readPluginName(join(dir, rel));
    if (name) return name;
  }
  return null;
}

interface NamedFile {
  readonly name: string;
  readonly path: string;
}

async function* collectSkills(pluginRoot: string): AsyncGenerator<NamedFile> {
  const skillsDir = join(pluginRoot, "skills");
  let entries;
  try {
    entries = await readdir(skillsDir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
    const skillFile = join(skillsDir, entry.name, "SKILL.md");
    try {
      await readFile(skillFile, "utf8");
    } catch {
      continue;
    }
    yield { name: entry.name, path: skillFile };
  }
}

async function* collectFlat(pluginRoot: string, subdir: string): AsyncGenerator<NamedFile> {
  const dir = join(pluginRoot, subdir);
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    if (entry.isFile() && entry.name.endsWith(".md")) {
      yield { name: entry.name.slice(0, -3), path: join(dir, entry.name) };
    }
  }
}

async function readPluginName(manifestPath: string): Promise<string | null> {
  let raw: string;
  try {
    raw = await readFile(manifestPath, "utf8");
  } catch {
    return null;
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return null;
  }
  const parsed = PluginManifestSchema.safeParse(json);
  return parsed.success ? parsed.data.name : null;
}
