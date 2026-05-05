import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { z } from "zod";

import { formatZodIssues } from "../errors/index.js";

export const PluginManifestSchema = z.object({
  name: z.string().min(1),
  version: z.string().min(1),
});

export type PluginManifest = z.infer<typeof PluginManifestSchema>;

const MarketplaceManifestSchema = z.object({
  name: z.string().min(1),
});

export interface DiscoveredPlugin {
  readonly name: string;
  readonly path: string;
  readonly claudeManifest: PluginManifest | null;
  readonly codexManifest: PluginManifest | null;
}

export async function readMarketplaceName(distRoot: string): Promise<string> {
  const manifestPath = join(distRoot, ".claude-plugin/marketplace.json");
  const raw = await readFile(manifestPath, "utf8");
  const parsed = MarketplaceManifestSchema.safeParse(JSON.parse(raw));
  if (!parsed.success) {
    throw new Error(
      `invalid marketplace manifest at ${manifestPath}: ${formatZodIssues(parsed.error).join("; ")}`,
    );
  }
  return parsed.data.name;
}

export async function discoverPlugins(distRoot: string): Promise<readonly DiscoveredPlugin[]> {
  const pluginsDir = join(distRoot, "plugins");
  const entries = await readdir(pluginsDir, { withFileTypes: true });
  const result: DiscoveredPlugin[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const path = join(pluginsDir, entry.name);
    const claudeManifest = await tryReadManifest(join(path, ".claude-plugin/plugin.json"));
    const codexManifest = await tryReadManifest(join(path, ".codex-plugin/plugin.json"));
    if (!claudeManifest && !codexManifest) continue;
    result.push({ name: entry.name, path, claudeManifest, codexManifest });
  }
  return result;
}

async function tryReadManifest(path: string): Promise<PluginManifest | null> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    return null;
  }
  const parsed = PluginManifestSchema.safeParse(JSON.parse(raw));
  if (!parsed.success) {
    throw new Error(
      `invalid plugin manifest at ${path}: ${formatZodIssues(parsed.error).join("; ")}`,
    );
  }
  return parsed.data;
}
