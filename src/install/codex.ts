import { cp, mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { DiscoveredPlugin, PluginManifest } from "./discovery.js";
import { runIgnoreFailure } from "./runner.js";
import type { InstallContext } from "./index.js";

export async function installCodex(ctx: InstallContext): Promise<void> {
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
    await mkdir(dirname(dest), { recursive: true });
    await cp(plugin.path, dest, { recursive: true });
    ctx.log(`[codex] cached ${plugin.name}@${plugin.codexManifest.version}`);
  }
}

export async function uninstallCodex(ctx: InstallContext): Promise<void> {
  await runIgnoreFailure(ctx.run, "codex", ["plugin", "marketplace", "remove", ctx.marketplace]);
  await rm(join(ctx.codexHome, "plugins/cache", ctx.marketplace), {
    recursive: true,
    force: true,
  });
  ctx.log(`[codex] removed ${ctx.marketplace} cache`);
}
