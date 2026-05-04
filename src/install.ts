import { homedir } from "node:os";
import { resolve, join } from "node:path";
import { readFile, readdir, mkdir, rm, cp } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { z } from "zod";

const execFileAsync = promisify(execFile);

export type Target = "claude" | "codex";

export type CommandRunner = (cmd: string, args: readonly string[]) => Promise<void>;

export interface InstallOptions {
  readonly distRoot?: string;
  readonly targets?: readonly Target[];
  readonly claudeHome?: string;
  readonly codexHome?: string;
  readonly silent?: boolean;
  /** @internal Test hook — production code uses execFile. */
  readonly runCommand?: CommandRunner;
}

const PluginManifestSchema = z.object({
  name: z.string().min(1),
  version: z.string().min(1),
});

type PluginManifest = z.infer<typeof PluginManifestSchema>;

const MarketplaceManifestSchema = z.object({
  name: z.string().min(1),
});

interface DiscoveredPlugin {
  readonly name: string;
  readonly path: string;
  readonly claudeManifest: PluginManifest | null;
  readonly codexManifest: PluginManifest | null;
}

interface InstallContext {
  readonly distRoot: string;
  readonly claudeHome: string;
  readonly codexHome: string;
  readonly targets: ReadonlySet<Target>;
  readonly marketplace: string;
  readonly plugins: readonly DiscoveredPlugin[];
  readonly run: CommandRunner;
  readonly log: (msg: string) => void;
}

const ALL_TARGETS: readonly Target[] = ["claude", "codex"] as const;

export async function install(options: InstallOptions = {}): Promise<void> {
  const ctx = await resolveContext(options);
  if (ctx.targets.has("claude")) await installClaude(ctx);
  if (ctx.targets.has("codex")) await installCodex(ctx);
}

export async function uninstall(options: InstallOptions = {}): Promise<void> {
  const ctx = await resolveContext(options);
  if (ctx.targets.has("claude")) await uninstallClaude(ctx);
  if (ctx.targets.has("codex")) await uninstallCodex(ctx);
}

async function resolveContext(options: InstallOptions): Promise<InstallContext> {
  const distRoot = resolve(options.distRoot ?? "./dist");
  const claudeHome = options.claudeHome ?? join(homedir(), ".claude");
  const codexHome = options.codexHome ?? join(homedir(), ".codex");
  const targets = new Set<Target>(options.targets ?? ALL_TARGETS);
  const run = options.runCommand ?? defaultRunner;
  const silent = options.silent ?? false;
  const log = (msg: string): void => {
    if (!silent) console.log(msg);
  };
  const marketplace = await readMarketplaceName(distRoot);
  const plugins = await discoverPlugins(distRoot);
  return { distRoot, claudeHome, codexHome, targets, marketplace, plugins, run, log };
}

async function defaultRunner(cmd: string, args: readonly string[]): Promise<void> {
  await execFileAsync(cmd, [...args]);
}

async function readMarketplaceName(distRoot: string): Promise<string> {
  const manifestPath = join(distRoot, ".claude-plugin/marketplace.json");
  const raw = await readFile(manifestPath, "utf8");
  const parsed = MarketplaceManifestSchema.safeParse(JSON.parse(raw));
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
    throw new Error(`invalid marketplace manifest at ${manifestPath}: ${issues}`);
  }
  return parsed.data.name;
}

async function discoverPlugins(distRoot: string): Promise<readonly DiscoveredPlugin[]> {
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
    const issues = parsed.error.issues
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
    throw new Error(`invalid plugin manifest at ${path}: ${issues}`);
  }
  return parsed.data;
}

async function installClaude(ctx: InstallContext): Promise<void> {
  const claudePlugins = ctx.plugins.filter((p) => p.claudeManifest !== null);
  if (claudePlugins.length === 0) return;
  ctx.log(
    `[claude] refreshing ${claudePlugins.length} plugin(s) on marketplace ${ctx.marketplace}`,
  );
  for (const plugin of claudePlugins) {
    await runIgnoreFailure(ctx.run, "claude", [
      "plugin",
      "uninstall",
      `${plugin.name}@${ctx.marketplace}`,
    ]);
    await rm(join(ctx.claudeHome, "plugins/cache", ctx.marketplace, plugin.name), {
      recursive: true,
      force: true,
    });
  }
  for (const plugin of claudePlugins) {
    await ctx.run("claude", ["plugin", "install", `${plugin.name}@${ctx.marketplace}`]);
    ctx.log(`[claude] installed ${plugin.name}`);
  }
}

async function installCodex(ctx: InstallContext): Promise<void> {
  const codexPlugins = ctx.plugins.filter(
    (p): p is DiscoveredPlugin & { codexManifest: PluginManifest } => p.codexManifest !== null,
  );
  if (codexPlugins.length === 0) return;
  ctx.log(`[codex] priming ${codexPlugins.length} plugin(s) on marketplace ${ctx.marketplace}`);
  await rm(join(ctx.codexHome, "plugins/cache", ctx.marketplace), {
    recursive: true,
    force: true,
  });
  await runIgnoreFailure(ctx.run, "codex", ["plugin", "marketplace", "add", ctx.distRoot]);
  for (const plugin of codexPlugins) {
    const dest = join(
      ctx.codexHome,
      "plugins/cache",
      ctx.marketplace,
      plugin.name,
      plugin.codexManifest.version,
    );
    await mkdir(join(dest, ".."), { recursive: true });
    await cp(plugin.path, dest, { recursive: true });
    ctx.log(`[codex] cached ${plugin.name}@${plugin.codexManifest.version}`);
  }
}

async function uninstallClaude(ctx: InstallContext): Promise<void> {
  const claudePlugins = ctx.plugins.filter((p) => p.claudeManifest !== null);
  for (const plugin of claudePlugins) {
    await runIgnoreFailure(ctx.run, "claude", [
      "plugin",
      "uninstall",
      `${plugin.name}@${ctx.marketplace}`,
    ]);
    ctx.log(`[claude] uninstalled ${plugin.name}`);
  }
  await runIgnoreFailure(ctx.run, "claude", ["plugin", "marketplace", "remove", ctx.marketplace]);
}

async function uninstallCodex(ctx: InstallContext): Promise<void> {
  await runIgnoreFailure(ctx.run, "codex", ["plugin", "marketplace", "remove", ctx.marketplace]);
  await rm(join(ctx.codexHome, "plugins/cache", ctx.marketplace), {
    recursive: true,
    force: true,
  });
  ctx.log(`[codex] removed ${ctx.marketplace} cache`);
}

async function runIgnoreFailure(
  run: CommandRunner,
  cmd: string,
  args: readonly string[],
): Promise<void> {
  try {
    await run(cmd, args);
  } catch {
    /* ignore */
  }
}
