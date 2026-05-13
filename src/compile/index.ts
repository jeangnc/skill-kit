import { join } from "node:path";

import {
  discoverLocalAgentIds,
  discoverLocalCommandIds,
  discoverLocalSkillIds,
  discoverPlugins,
  pathExists,
} from "./discovery.js";
import { compileTree, emitPluginManifests, type BodyInvariant } from "./emit.js";

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
  const localIds = { skills, commands, agents };
  const plugins = await discoverPlugins(srcRoot);
  await emitPluginManifests(plugins, outRoot);
  for (const sub of ALLOWED_TOP_LEVEL) {
    const subPath = join(srcRoot, sub);
    if (await pathExists(subPath)) {
      await compileTree(subPath, join(outRoot, sub), localIds, options.bodyInvariants ?? []);
    }
  }
}
