import { readFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { formatZodIssues } from "../errors/index.js";
import { MarketplaceSchema, type Marketplace, type PluginEntry } from "../marketplace/index.js";
import { PluginSchema, type Plugin } from "../plugin/index.js";
import { err, ok, type Result } from "../result.js";

export interface ResolvedPlugin {
  readonly name: string;
  readonly pluginDir: string;
  readonly manifest: Plugin;
  readonly manifestSource: "PLUGIN.ts" | "plugin.json";
  readonly skillsDir: string;
  readonly commandsDir: string;
  readonly agentsDir: string;
  readonly hooksDir: string;
}

export interface OpaquePlugin {
  readonly name: string;
  readonly source: Exclude<PluginEntry["source"], { kind: "relative" }>;
}

export interface LayoutAdapter {
  readonly srcRoot: string;
  readonly marketplace: Marketplace;
  readonly plugins: readonly ResolvedPlugin[];
  readonly opaquePlugins: readonly OpaquePlugin[];
}

export type LayoutError =
  | { readonly kind: "marketplace-missing"; readonly path: string }
  | {
      readonly kind: "marketplace-invalid";
      readonly path: string;
      readonly issues: readonly string[];
    }
  | { readonly kind: "plugin-missing"; readonly name: string; readonly path: string }
  | { readonly kind: "manifest-missing"; readonly name: string; readonly pluginDir: string }
  | { readonly kind: "manifest-collision"; readonly name: string; readonly pluginDir: string }
  | {
      readonly kind: "manifest-invalid";
      readonly name: string;
      readonly path: string;
      readonly issues: readonly string[];
    }
  | {
      readonly kind: "plugin-name-mismatch";
      readonly entryName: string;
      readonly manifestName: string;
      readonly path: string;
    };

const MANIFEST_JSON = ".claude-plugin/plugin.json";
const MANIFEST_TS = "PLUGIN.ts";

async function pathExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

function resolvePluginDir(srcRoot: string, pluginRoot: string | undefined, source: string): string {
  if (source.startsWith("./") || source.startsWith("../") || source === ".") {
    return resolve(srcRoot, source);
  }
  if (pluginRoot !== undefined) {
    return resolve(srcRoot, pluginRoot, source);
  }
  return resolve(srcRoot, source);
}

function joinUnder(pluginDir: string, override: string | undefined, fallback: string): string {
  return join(pluginDir, override ?? fallback);
}

async function loadPluginManifest(
  entryName: string,
  pluginDir: string,
): Promise<Result<{ manifest: Plugin; source: "PLUGIN.ts" | "plugin.json" }, LayoutError>> {
  const tsPath = join(pluginDir, MANIFEST_TS);
  const jsonPath = join(pluginDir, MANIFEST_JSON);
  const [hasTs, hasJson] = await Promise.all([pathExists(tsPath), pathExists(jsonPath)]);

  if (hasTs && hasJson) {
    return err({ kind: "manifest-collision", name: entryName, pluginDir });
  }
  if (!hasTs && !hasJson) {
    return err({ kind: "manifest-missing", name: entryName, pluginDir });
  }

  if (hasTs) {
    const mod = (await import(pathToFileURL(tsPath).href)) as { default: unknown };
    const parsed = PluginSchema.safeParse(mod.default);
    if (!parsed.success) {
      return err({
        kind: "manifest-invalid",
        name: entryName,
        path: tsPath,
        issues: formatZodIssues(parsed.error),
      });
    }
    return ok({ manifest: parsed.data, source: "PLUGIN.ts" });
  }

  const raw = await readFile(jsonPath, "utf8");
  const parsed = PluginSchema.safeParse(JSON.parse(raw));
  if (!parsed.success) {
    return err({
      kind: "manifest-invalid",
      name: entryName,
      path: jsonPath,
      issues: formatZodIssues(parsed.error),
    });
  }
  return ok({ manifest: parsed.data, source: "plugin.json" });
}

export async function loadLayout(srcRoot: string): Promise<Result<LayoutAdapter, LayoutError>> {
  const marketplacePath = join(srcRoot, ".claude-plugin/marketplace.json");
  if (!(await pathExists(marketplacePath))) {
    return err({ kind: "marketplace-missing", path: marketplacePath });
  }

  const rawMarketplace = await readFile(marketplacePath, "utf8");
  const parsed = MarketplaceSchema.safeParse(JSON.parse(rawMarketplace));
  if (!parsed.success) {
    return err({
      kind: "marketplace-invalid",
      path: marketplacePath,
      issues: formatZodIssues(parsed.error),
    });
  }
  const marketplace = parsed.data;
  const pluginRoot = marketplace.metadata?.pluginRoot;

  const plugins: ResolvedPlugin[] = [];
  const opaquePlugins: OpaquePlugin[] = [];

  for (const entry of marketplace.plugins) {
    if (entry.source.kind !== "relative") {
      opaquePlugins.push({ name: entry.name, source: entry.source });
      continue;
    }

    const pluginDir = resolvePluginDir(srcRoot, pluginRoot, entry.source.path);
    if (!(await pathExists(pluginDir))) {
      return err({ kind: "plugin-missing", name: entry.name, path: pluginDir });
    }

    const manifestResult = await loadPluginManifest(entry.name, pluginDir);
    if (!manifestResult.ok) return manifestResult;
    const { manifest, source: manifestSource } = manifestResult.value;

    if (manifest.name !== entry.name) {
      return err({
        kind: "plugin-name-mismatch",
        entryName: entry.name,
        manifestName: manifest.name,
        path: join(pluginDir, manifestSource === "PLUGIN.ts" ? MANIFEST_TS : MANIFEST_JSON),
      });
    }

    plugins.push({
      name: entry.name,
      pluginDir,
      manifest,
      manifestSource,
      skillsDir: joinUnder(pluginDir, undefined, "skills"),
      commandsDir: joinUnder(pluginDir, manifest.commands, "commands"),
      agentsDir: joinUnder(pluginDir, manifest.agents, "agents"),
      hooksDir: joinUnder(pluginDir, manifest.hooks, "hooks"),
    });
  }

  return ok({ srcRoot, marketplace, plugins, opaquePlugins });
}
