#!/usr/bin/env node
import { parseArgs } from "node:util";

import { build } from "./build.js";

const { values } = parseArgs({
  options: {
    src: { type: "string", default: "./src" },
    out: { type: "string", default: "./dist" },
    silent: { type: "boolean", default: false },
    help: { type: "boolean", short: "h", default: false },
  },
  strict: true,
});

if (values.help) {
  process.stdout.write(
    [
      "Usage: skill-kit [options]",
      "",
      "Options:",
      "  --src <path>    source root (default: ./src)",
      "  --out <path>    output root (default: ./dist)",
      "  --silent        suppress success log",
      "  -h, --help      show this help",
      "",
    ].join("\n"),
  );
  process.exit(0);
}

await build({
  srcRoot: values.src,
  outRoot: values.out,
  silent: values.silent,
});
