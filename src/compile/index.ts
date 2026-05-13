import { join } from "node:path";

import {
  discoverLocalAgentIds,
  discoverLocalCommandIds,
  discoverLocalSkillIds,
  discoverPlugins,
  pathExists,
  throwInvariantViolations,
} from "./discovery.js";
import { compileTree, emitPluginManifests, type BodyInvariant, type LocalIds } from "./emit.js";
import type { HookRequirement, Plugin } from "../plugin/index.js";

export type { BodyInvariant } from "./emit.js";

export interface CompileOptions {
  readonly srcRoot: string;
  readonly outRoot: string;
  readonly bodyInvariants?: readonly BodyInvariant[];
}

export const ALLOWED_TOP_LEVEL = ["plugins", ".claude-plugin"] as const;

export async function compile(options: CompileOptions): Promise<void> {
  const { srcRoot, outRoot } = options;
  const [skills, commands, agents] = await Promise.all([
    discoverLocalSkillIds(srcRoot),
    discoverLocalCommandIds(srcRoot),
    discoverLocalAgentIds(srcRoot),
  ]);
  const localIds: LocalIds = { skills, commands, agents };
  const plugins = await discoverPlugins(srcRoot);
  checkHookRequires(srcRoot, plugins, localIds);
  await emitPluginManifests(plugins, outRoot);
  const contextFiles = pluginContextFiles(srcRoot, plugins);
  for (const sub of ALLOWED_TOP_LEVEL) {
    const subPath = join(srcRoot, sub);
    if (await pathExists(subPath)) {
      await compileTree(
        subPath,
        join(outRoot, sub),
        localIds,
        options.bodyInvariants ?? [],
        sub === "plugins" ? contextFiles : new Set(),
        sub === "plugins" ? plugins : new Map(),
      );
    }
  }
}

function pluginContextFiles(
  srcRoot: string,
  plugins: ReadonlyMap<string, Plugin>,
): ReadonlySet<string> {
  const result = new Set<string>();
  for (const [name, plugin] of plugins) {
    for (const entry of plugin.context ?? []) {
      result.add(join(srcRoot, "plugins", name, entry.file));
    }
  }
  return result;
}

function checkHookRequires(
  srcRoot: string,
  plugins: ReadonlyMap<string, Plugin>,
  localIds: LocalIds,
): void {
  for (const [name, plugin] of plugins) {
    const errors: string[] = [];
    for (const req of plugin.hookRequires ?? []) {
      const violation = hookRequireViolation(req, localIds);
      if (violation) errors.push(`hookRequires (${req.event}): ${violation}`);
    }
    if (errors.length > 0) {
      throwInvariantViolations(join(srcRoot, "plugins", name, "PLUGIN.ts"), errors);
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
