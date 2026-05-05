import { test } from "node:test";
import { strict as assert } from "node:assert";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { check } from "../src/check.js";
import type { PluginSource } from "../src/sources.js";

const fixturesRoot = fileURLToPath(new URL("./fixtures", import.meta.url));

interface SkillFile {
  readonly plugin: string;
  readonly skill: string;
  readonly body: string;
}

function withSrcFixture<T>(
  files: readonly SkillFile[],
  fn: (srcRoot: string) => Promise<T>,
): Promise<T> {
  const sandbox = mkdtempSync(join(fixturesRoot, "_tmp_check_"));
  const srcRoot = join(sandbox, "src");
  for (const file of files) {
    const skillDir = join(srcRoot, "plugins", file.plugin, "skills", file.skill);
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      join(skillDir, "SKILL.md"),
      `---\nname: ${file.skill}\ndescription: x\n---\n\n${file.body}`,
    );
  }
  return fn(srcRoot).finally(() => rmSync(sandbox, { recursive: true, force: true }));
}

function withInstalledFixture<T>(
  installed: ReadonlyArray<{ plugin: string; skill: string }>,
  fn: (sources: readonly PluginSource[]) => Promise<T>,
): Promise<T> {
  const root = mkdtempSync(join(tmpdir(), "skill-kit-check-installed-"));
  for (const { plugin, skill } of installed) {
    const pluginRoot = join(root, "marketplace", plugin);
    const skillDir = join(pluginRoot, "skills", skill);
    mkdirSync(skillDir, { recursive: true });
    mkdirSync(join(pluginRoot, ".claude-plugin"), { recursive: true });
    writeFileSync(
      join(pluginRoot, ".claude-plugin/plugin.json"),
      JSON.stringify({ name: plugin, version: "1.0.0" }),
    );
    writeFileSync(join(skillDir, "SKILL.md"), `---\nname: ${skill}\ndescription: x\n---\n\nbody\n`);
  }
  return fn([{ name: "claude", root }]).finally(() =>
    rmSync(root, { recursive: true, force: true }),
  );
}

test("check returns no violations when all ext: refs resolve", async () => {
  await withInstalledFixture([{ plugin: "superpowers", skill: "tdd" }], async (sources) => {
    await withSrcFixture(
      [{ plugin: "foo", skill: "bar", body: "see {{ext:superpowers:tdd}}\n" }],
      async (srcRoot) => {
        const result = await check({ srcRoot, sources });
        assert.deepEqual([...result.violations], []);
        assert.equal(result.checkedFiles, 1);
        assert.equal(result.indexedSources[0]?.skillCount, 1);
      },
    );
  });
});

test("check reports an unresolved ext: when no installed source has the referenced skill", async () => {
  await withInstalledFixture([{ plugin: "superpowers", skill: "tdd" }], async (sources) => {
    await withSrcFixture(
      [{ plugin: "foo", skill: "bar", body: "see {{ext:nope:missing}}\n" }],
      async (srcRoot) => {
        const result = await check({ srcRoot, sources });
        assert.equal(result.violations.length, 1);
        assert.equal(result.violations[0]!.kind, "unresolved");
        assert.match(result.violations[0]!.message, /not installed/i);
        assert.match(result.violations[0]!.token, /nope:missing/);
      },
    );
  });
});

test("check reports a malformed ext: when value does not match <plugin>:<skill>", async () => {
  await withInstalledFixture([], async (sources) => {
    await withSrcFixture(
      [{ plugin: "foo", skill: "bar", body: "see {{ext:lonelyid}}\n" }],
      async (srcRoot) => {
        const result = await check({ srcRoot, sources });
        assert.equal(result.violations.length, 1);
        assert.equal(result.violations[0]!.kind, "malformed");
      },
    );
  });
});

test("check suggests the closest match when an unresolved ext: id is a near-miss", async () => {
  await withInstalledFixture([{ plugin: "superpowers", skill: "tdd" }], async (sources) => {
    await withSrcFixture(
      [{ plugin: "foo", skill: "bar", body: "see {{ext:supperpowers:tdd}}\n" }],
      async (srcRoot) => {
        const result = await check({ srcRoot, sources });
        assert.equal(result.violations.length, 1);
        assert.match(result.violations[0]!.message, /superpowers:tdd/);
      },
    );
  });
});

test("check reports line:col into the source file", async () => {
  await withInstalledFixture([], async (sources) => {
    await withSrcFixture(
      [
        {
          plugin: "foo",
          skill: "bar",
          body: "line one\nline two with {{ext:nope:miss}} ref\n",
        },
      ],
      async (srcRoot) => {
        const result = await check({ srcRoot, sources });
        const violation = result.violations[0]!;
        // Frontmatter is 4 lines (---, name, description, ---), blank separator = 5
        // Body line "line one" -> source line 6, "line two with..." -> source line 7
        assert.equal(violation.line, 7);
        assert.equal(typeof violation.column, "number");
        assert.ok(violation.column > 1);
      },
    );
  });
});

test("check counts each scanned skill body as a checked file", async () => {
  await withInstalledFixture([{ plugin: "superpowers", skill: "tdd" }], async (sources) => {
    await withSrcFixture(
      [
        { plugin: "foo", skill: "bar", body: "{{ext:superpowers:tdd}}\n" },
        { plugin: "foo", skill: "baz", body: "no refs\n" },
      ],
      async (srcRoot) => {
        const result = await check({ srcRoot, sources });
        assert.equal(result.checkedFiles, 2);
        assert.deepEqual([...result.violations], []);
      },
    );
  });
});

test("check works with TS-authored skills (body in body.md)", async () => {
  const sandbox = mkdtempSync(join(fixturesRoot, "_tmp_check_ts_"));
  const srcRoot = join(sandbox, "src");
  const skillDir = join(srcRoot, "plugins/foo/skills/bar");
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(
    join(skillDir, "SKILL.ts"),
    `import { defineSkill } from "#skill-kit";\nexport default defineSkill({ name: "bar", description: "x" });\n`,
  );
  writeFileSync(join(skillDir, "body.md"), "see {{ext:nope:missing}}\n");
  try {
    await withInstalledFixture([], async (sources) => {
      const result = await check({ srcRoot, sources });
      assert.equal(result.violations.length, 1);
      assert.equal(result.violations[0]!.kind, "unresolved");
    });
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
});
