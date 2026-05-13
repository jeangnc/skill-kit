import { test } from "node:test";
import { strict as assert } from "node:assert";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { check } from "./check.js";
import type { PluginSource } from "./installed.js";

const repoRoot = fileURLToPath(new URL("../", import.meta.url));

interface SkillFile {
  readonly plugin: string;
  readonly skill: string;
  readonly body: string;
}

async function withSrcFixture<T>(
  files: readonly SkillFile[],
  fn: (srcRoot: string) => Promise<T>,
): Promise<T> {
  const sandbox = mkdtempSync(join(repoRoot, ".test-tmp-check-"));
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

interface InstalledArtifact {
  readonly plugin: string;
  readonly skill?: string;
  readonly command?: string;
  readonly agent?: string;
}

async function withInstalledFixture<T>(
  installed: readonly InstalledArtifact[],
  fn: (sources: readonly PluginSource[]) => Promise<T>,
): Promise<T> {
  const root = mkdtempSync(join(tmpdir(), "skill-kit-check-installed-"));
  for (const item of installed) {
    const pluginRoot = join(root, "marketplace", item.plugin);
    mkdirSync(join(pluginRoot, ".claude-plugin"), { recursive: true });
    writeFileSync(
      join(pluginRoot, ".claude-plugin/plugin.json"),
      JSON.stringify({ name: item.plugin, version: "1.0.0" }),
    );
    if (item.skill) {
      const skillDir = join(pluginRoot, "skills", item.skill);
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(
        join(skillDir, "SKILL.md"),
        `---\nname: ${item.skill}\ndescription: x\n---\n\nbody\n`,
      );
    }
    if (item.command) {
      const dir = join(pluginRoot, "commands");
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        join(dir, `${item.command}.md`),
        `---\nname: ${item.command}\ndescription: x\n---\n\nbody\n`,
      );
    }
    if (item.agent) {
      const dir = join(pluginRoot, "agents");
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        join(dir, `${item.agent}.md`),
        `---\nname: ${item.agent}\ndescription: x\n---\n\nbody\n`,
      );
    }
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
  const sandbox = mkdtempSync(join(repoRoot, ".test-tmp-check-ts-"));
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

test("check returns no violations when an ext-command resolves to an installed command", async () => {
  await withInstalledFixture([{ plugin: "dev-tools", command: "open-pr" }], async (sources) => {
    await withSrcFixture(
      [{ plugin: "foo", skill: "bar", body: "run {{ext-command:dev-tools:open-pr}}\n" }],
      async (srcRoot) => {
        const result = await check({ srcRoot, sources });
        assert.deepEqual([...result.violations], []);
      },
    );
  });
});

test("check reports an unresolved ext-command when no installed plugin has the command", async () => {
  await withInstalledFixture([{ plugin: "dev-tools", command: "open-pr" }], async (sources) => {
    await withSrcFixture(
      [{ plugin: "foo", skill: "bar", body: "run {{ext-command:dev-tools:ghost}}\n" }],
      async (srcRoot) => {
        const result = await check({ srcRoot, sources });
        assert.equal(result.violations.length, 1);
        assert.equal(result.violations[0]!.kind, "unresolved");
        assert.match(result.violations[0]!.token, /ext-command:dev-tools:ghost/);
      },
    );
  });
});

test("check suggests the closest command match when an ext-command id is a near-miss", async () => {
  await withInstalledFixture([{ plugin: "dev-tools", command: "open-pr" }], async (sources) => {
    await withSrcFixture(
      [{ plugin: "foo", skill: "bar", body: "run {{ext-command:dev-tools:open-prs}}\n" }],
      async (srcRoot) => {
        const result = await check({ srcRoot, sources });
        assert.equal(result.violations.length, 1);
        assert.match(result.violations[0]!.message, /dev-tools:open-pr/);
      },
    );
  });
});

test("check does not cross-suggest a skill id for an unresolved ext-command", async () => {
  await withInstalledFixture([{ plugin: "dev-tools", skill: "open-pr" }], async (sources) => {
    await withSrcFixture(
      [{ plugin: "foo", skill: "bar", body: "run {{ext-command:dev-tools:open-pr}}\n" }],
      async (srcRoot) => {
        const result = await check({ srcRoot, sources });
        assert.equal(result.violations.length, 1);
        assert.equal(result.violations[0]!.kind, "unresolved");
        assert.doesNotMatch(result.violations[0]!.message, /did you mean/);
      },
    );
  });
});

test("check returns no violations when an ext-agent resolves to an installed agent", async () => {
  await withInstalledFixture([{ plugin: "dev-tools", agent: "code-reviewer" }], async (sources) => {
    await withSrcFixture(
      [{ plugin: "foo", skill: "bar", body: "dispatch {{ext-agent:dev-tools:code-reviewer}}\n" }],
      async (srcRoot) => {
        const result = await check({ srcRoot, sources });
        assert.deepEqual([...result.violations], []);
      },
    );
  });
});

test("check reports an unresolved ext-agent when no installed plugin has the agent", async () => {
  await withInstalledFixture([{ plugin: "dev-tools", agent: "code-reviewer" }], async (sources) => {
    await withSrcFixture(
      [{ plugin: "foo", skill: "bar", body: "dispatch {{ext-agent:dev-tools:ghost}}\n" }],
      async (srcRoot) => {
        const result = await check({ srcRoot, sources });
        assert.equal(result.violations.length, 1);
        assert.equal(result.violations[0]!.kind, "unresolved");
        assert.match(result.violations[0]!.token, /ext-agent:dev-tools:ghost/);
      },
    );
  });
});

test("check reports a malformed ext-command when value does not match <plugin>:<command>", async () => {
  await withInstalledFixture([], async (sources) => {
    await withSrcFixture(
      [{ plugin: "foo", skill: "bar", body: "{{ext-command:lonely}}\n" }],
      async (srcRoot) => {
        const result = await check({ srcRoot, sources });
        assert.equal(result.violations.length, 1);
        assert.equal(result.violations[0]!.kind, "malformed");
      },
    );
  });
});

test("check reports a malformed ext-agent when value does not match <plugin>:<agent>", async () => {
  await withInstalledFixture([], async (sources) => {
    await withSrcFixture(
      [{ plugin: "foo", skill: "bar", body: "{{ext-agent:lonely}}\n" }],
      async (srcRoot) => {
        const result = await check({ srcRoot, sources });
        assert.equal(result.violations.length, 1);
        assert.equal(result.violations[0]!.kind, "malformed");
      },
    );
  });
});
