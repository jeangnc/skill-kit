import { test } from "node:test";
import { strict as assert } from "node:assert";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "./build.js";

const fixturesRoot = fileURLToPath(new URL("./fixtures", import.meta.url));

function withSandbox<T>(fn: (srcRoot: string, outRoot: string) => Promise<T>): Promise<T> {
  const sandbox = mkdtempSync(join(fixturesRoot, "_tmp_"));
  const srcRoot = join(sandbox, "src");
  const outRoot = join(sandbox, "out");
  const skillDir = join(srcRoot, "plugins/foo/skills/bar");
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(
    join(skillDir, "SKILL.ts"),
    `import { defineSkill } from "#skill-kit";\nexport default defineSkill({ name: "bar", description: "fixture" });\n`,
  );
  writeFileSync(join(skillDir, "body.md"), "# Bar\n");
  return fn(srcRoot, outRoot).finally(() => rmSync(sandbox, { recursive: true, force: true }));
}

test("build emits SKILL.md to outRoot when given explicit paths", async () => {
  await withSandbox(async (srcRoot, outRoot) => {
    await build({ srcRoot, outRoot, silent: true });
    assert.ok(existsSync(join(outRoot, "plugins/foo/skills/bar/SKILL.md")));
  });
});

test("build cleans the outRoot/plugins tree before compiling", async () => {
  await withSandbox(async (srcRoot, outRoot) => {
    const stalePath = join(outRoot, "plugins/old/skills/gone/SKILL.md");
    mkdirSync(join(outRoot, "plugins/old/skills/gone"), { recursive: true });
    writeFileSync(stalePath, "stale\n");
    await build({ srcRoot, outRoot, silent: true });
    assert.ok(!existsSync(stalePath), "stale plugin should be removed");
    assert.ok(existsSync(join(outRoot, "plugins/foo/skills/bar/SKILL.md")));
  });
});

test("build forwards bodyInvariants to compile", async () => {
  await withSandbox(async (srcRoot, outRoot) => {
    const flagFOO = (body: string): string[] => (body.includes("Bar") ? ["found Bar"] : []);
    await assert.rejects(
      build({ srcRoot, outRoot, silent: true, bodyInvariants: [flagFOO] }),
      /found Bar/,
    );
  });
});

test("build writes a success line to stdout when not silent", async () => {
  await withSandbox(async (srcRoot, outRoot) => {
    const original = console.log;
    const lines: string[] = [];
    console.log = (msg: string) => lines.push(msg);
    try {
      await build({ srcRoot, outRoot });
    } finally {
      console.log = original;
    }
    const joined = lines.join("\n");
    assert.match(joined, /compiled →/);
    assert.ok(joined.includes(outRoot));
  });
});
