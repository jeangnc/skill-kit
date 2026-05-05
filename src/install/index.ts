import { homedir } from "node:os";
import { resolve, join } from "node:path";

import type { DiscoveredPlugin } from "./discovery.js";
import { discoverPlugins, readMarketplaceName } from "./discovery.js";
import { defaultRunner, type CommandRunner } from "./runner.js";
import { installClaude, uninstallClaude } from "./claude.js";
import { installCodex, uninstallCodex } from "./codex.js";

export type Target = "claude" | "codex";

export interface InstallOptions {
  readonly distRoot?: string;
  readonly targets?: readonly Target[];
  readonly claudeHome?: string;
  readonly codexHome?: string;
  readonly silent?: boolean;
}

/** @internal Used by per-target modules; not part of the public surface. */
export interface InstallContext {
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
  await installWithRunner(options, defaultRunner);
}

export async function uninstall(options: InstallOptions = {}): Promise<void> {
  await uninstallWithRunner(options, defaultRunner);
}

/** @internal Test-only entry; lets callers inject a recording runner. */
export async function installWithRunner(
  options: InstallOptions,
  runner: CommandRunner,
): Promise<void> {
  const ctx = await resolveContext(options, runner);
  if (ctx.targets.has("claude")) await installClaude(ctx);
  if (ctx.targets.has("codex")) await installCodex(ctx);
}

/** @internal Test-only entry; lets callers inject a recording runner. */
export async function uninstallWithRunner(
  options: InstallOptions,
  runner: CommandRunner,
): Promise<void> {
  const ctx = await resolveContext(options, runner);
  if (ctx.targets.has("claude")) await uninstallClaude(ctx);
  if (ctx.targets.has("codex")) await uninstallCodex(ctx);
}

async function resolveContext(
  options: InstallOptions,
  runner: CommandRunner,
): Promise<InstallContext> {
  const distRoot = resolve(options.distRoot ?? "./dist");
  const claudeHome = options.claudeHome ?? join(homedir(), ".claude");
  const codexHome = options.codexHome ?? join(homedir(), ".codex");
  const targets = new Set<Target>(options.targets ?? ALL_TARGETS);
  const silent = options.silent ?? false;
  const log = (msg: string): void => {
    if (!silent) console.log(msg);
  };
  const marketplace = await readMarketplaceName(distRoot);
  const plugins = await discoverPlugins(distRoot);
  return { distRoot, claudeHome, codexHome, targets, marketplace, plugins, run: runner, log };
}
