import { rm } from "node:fs/promises";
import { resolve, join } from "node:path";

import { compile } from "./compile/index.js";
import type { BodyInvariant } from "./compile/index.js";

export interface BuildOptions {
  readonly srcRoot?: string;
  readonly outRoot?: string;
  readonly bodyInvariants?: readonly BodyInvariant[];
  readonly silent?: boolean;
}

export async function build(options: BuildOptions = {}): Promise<void> {
  const srcRoot = resolve(options.srcRoot ?? "./src");
  const outRoot = resolve(options.outRoot ?? "./dist");
  await rm(join(outRoot, "plugins"), { recursive: true, force: true });
  await rm(join(outRoot, ".claude-plugin"), { recursive: true, force: true });
  await compile({
    srcRoot,
    outRoot,
    ...(options.bodyInvariants ? { bodyInvariants: options.bodyInvariants } : {}),
  });
  if (!options.silent) {
    console.log(`compiled → ${outRoot}`);
  }
}
