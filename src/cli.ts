#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { defineCommand, runMain } from "citty";
import { z } from "zod";

import { build } from "./build.js";
import { check, type CheckMode, type ExtViolation } from "./check/index.js";
import { install, uninstall, type Target } from "./install/index.js";
import { lint } from "./lint.js";

const PackageJsonSchema = z.object({ version: z.string().min(1) });

const pkgPath = fileURLToPath(new URL("../package.json", import.meta.url));
const pkg = PackageJsonSchema.parse(JSON.parse(readFileSync(pkgPath, "utf8")));

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

function parseCheckMode(value: string): CheckMode {
  if (value === "local" || value === "installed" || value === "all") return value;
  throw new Error(`Unknown check mode "${value}". Valid: local, installed, all`);
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

const checkCmd = defineCommand({
  meta: {
    name: "check",
    description: "Validate plugin references — local, installed (ext:), or both",
  },
  args: {
    src: { type: "string", default: "./src", description: "source root" },
    mode: {
      type: "string",
      default: "installed",
      description: "validation scope: local | installed | all",
    },
    silent: { type: "boolean", default: false, description: "suppress non-error output" },
  },
  run: async ({ args }) => {
    const mode = parseCheckMode(args.mode);
    const result = await check({ srcRoot: args.src, mode });
    if (!args.silent) {
      const breakdown = result.indexedSources.map((s) => `${s.source}=${s.skillCount}`).join(", ");
      const total = result.indexedSources.reduce((acc, s) => acc + s.skillCount, 0);
      console.log(
        `indexed ${total} skills across ${result.indexedSources.length} sources (${breakdown})`,
      );
      console.log(`checked ${result.checkedFiles} source files`);
      if (result.violations.length > 0) console.log("");
    }
    for (const v of result.violations) {
      console.log(formatViolation(v));
    }
    if (result.violations.length > 0) {
      if (!args.silent) {
        console.log("");
        console.log(`${result.violations.length} violations`);
      }
      process.exit(1);
    }
  },
});

function formatViolation(v: ExtViolation): string {
  return `${v.file}:${v.line}:${v.column}  \`${v.token}\` — ${v.message}`;
}

const lintCmd = defineCommand({
  meta: {
    name: "lint",
    description: "Lint compiled markdown under dist/ with skill-kit's default rules",
  },
  args: {
    out: { type: "string", default: "./dist", description: "output root" },
    silent: { type: "boolean", default: false, description: "suppress non-error output" },
  },
  run: async ({ args }) => {
    const result = await lint({ outRoot: args.out, silent: args.silent });
    if (result.errorCount > 0) process.exit(1);
  },
});

const main = defineCommand({
  meta: {
    name: "skill-kit",
    version: pkg.version,
    description: "Typed framework for authoring Claude Code skills.",
  },
  subCommands: {
    build: buildCmd,
    check: checkCmd,
    install: installCmd,
    lint: lintCmd,
    uninstall: uninstallCmd,
  },
});

await runMain(main);
