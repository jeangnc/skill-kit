#!/usr/bin/env node
import { parseArgs } from "node:util";

import { build } from "./build.js";
import { install, uninstall, type Target } from "./install.js";

type Subcommand = "build" | "install" | "uninstall" | "help";

const SUBCOMMANDS: readonly Subcommand[] = ["build", "install", "uninstall", "help"] as const;

function readSubcommand(argv: readonly string[]): { sub: Subcommand; rest: readonly string[] } {
  const first = argv[0];
  if (first === undefined || first.startsWith("-")) {
    return { sub: "build", rest: argv };
  }
  if (!isSubcommand(first)) {
    process.stderr.write(`Unknown subcommand: ${first}\n`);
    printHelp();
    process.exit(2);
  }
  return { sub: first, rest: argv.slice(1) };
}

function isSubcommand(value: string): value is Subcommand {
  return (SUBCOMMANDS as readonly string[]).includes(value);
}

function parseTargets(value: string | undefined): readonly Target[] | undefined {
  if (!value) return undefined;
  const parts = value.split(",").map((p) => p.trim());
  for (const part of parts) {
    if (part !== "claude" && part !== "codex") {
      throw new Error(`Unknown target "${part}". Valid: claude, codex`);
    }
  }
  return parts as readonly Target[];
}

function printHelp(): void {
  process.stdout.write(
    [
      "Usage: skill-kit <subcommand> [options]",
      "",
      "Subcommands:",
      "  build       Compile typed skill sources to dist/ (default)",
      "  install     Install compiled plugins into Claude/Codex",
      "  uninstall   Remove installed plugins from Claude/Codex",
      "  help        Show this message",
      "",
      "build options:",
      "  --src <path>      source root (default: ./src)",
      "  --out <path>      output root (default: ./dist)",
      "  --silent          suppress success log",
      "",
      "install/uninstall options:",
      "  --dist <path>     dist root (default: ./dist)",
      "  --targets <list>  comma-separated: claude,codex (default: both)",
      "  --silent          suppress success log",
      "",
    ].join("\n"),
  );
}

const { sub, rest } = readSubcommand(process.argv.slice(2));

if (sub === "help") {
  printHelp();
  process.exit(0);
}

if (sub === "build") {
  const { values } = parseArgs({
    args: [...rest],
    options: {
      src: { type: "string", default: "./src" },
      out: { type: "string", default: "./dist" },
      silent: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
    strict: true,
  });
  if (values.help) {
    printHelp();
    process.exit(0);
  }
  await build({ srcRoot: values.src, outRoot: values.out, silent: values.silent });
} else if (sub === "install" || sub === "uninstall") {
  const { values } = parseArgs({
    args: [...rest],
    options: {
      dist: { type: "string", default: "./dist" },
      targets: { type: "string" },
      silent: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
    strict: true,
  });
  if (values.help) {
    printHelp();
    process.exit(0);
  }
  const targets = parseTargets(values.targets);
  const fn = sub === "install" ? install : uninstall;
  await fn({
    distRoot: values.dist,
    silent: values.silent,
    ...(targets !== undefined ? { targets } : {}),
  });
}
