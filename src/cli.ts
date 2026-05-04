#!/usr/bin/env node
import { defineCommand, runMain } from "citty";

import { build } from "./build.js";
import { install, uninstall, type Target } from "./install.js";

function isTarget(value: string): value is Target {
  return value === "claude" || value === "codex";
}

function parseTargets(value: string | undefined): readonly Target[] | undefined {
  if (!value) return undefined;
  return value.split(",").map((p) => {
    const trimmed = p.trim();
    if (!isTarget(trimmed)) {
      throw new Error(`Unknown target "${trimmed}". Valid: claude, codex`);
    }
    return trimmed;
  });
}

const buildCmd = defineCommand({
  meta: { name: "build", description: "Compile typed skill sources to dist/" },
  args: {
    src: { type: "string", default: "./src", description: "source root" },
    out: { type: "string", default: "./dist", description: "output root" },
    silent: { type: "boolean", default: false, description: "suppress success log" },
  },
  run: async ({ args }) => {
    await build({ srcRoot: args.src, outRoot: args.out, silent: args.silent });
  },
});

const installArgs = {
  dist: { type: "string", default: "./dist", description: "dist root" },
  targets: {
    type: "string",
    description: "comma-separated targets: claude,codex (default: both)",
    required: false,
  },
  silent: { type: "boolean", default: false, description: "suppress success log" },
} as const;

const installCmd = defineCommand({
  meta: { name: "install", description: "Install compiled plugins into Claude/Codex" },
  args: installArgs,
  run: async ({ args }) => {
    const targets = parseTargets(args.targets);
    await install({
      distRoot: args.dist,
      silent: args.silent,
      ...(targets !== undefined ? { targets } : {}),
    });
  },
});

const uninstallCmd = defineCommand({
  meta: { name: "uninstall", description: "Remove installed plugins from Claude/Codex" },
  args: installArgs,
  run: async ({ args }) => {
    const targets = parseTargets(args.targets);
    await uninstall({
      distRoot: args.dist,
      silent: args.silent,
      ...(targets !== undefined ? { targets } : {}),
    });
  },
});

const main = defineCommand({
  meta: {
    name: "skill-kit",
    description: "Typed framework for authoring Claude Code skills.",
  },
  subCommands: {
    build: buildCmd,
    install: installCmd,
    uninstall: uninstallCmd,
  },
});

await runMain(main);
