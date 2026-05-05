import { rm } from "node:fs/promises";
import { join } from "node:path";

import { runIgnoreFailure } from "./runner.js";
import type { InstallContext } from "./index.js";

export async function installClaude(ctx: InstallContext): Promise<void> {
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

export async function uninstallClaude(ctx: InstallContext): Promise<void> {
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
