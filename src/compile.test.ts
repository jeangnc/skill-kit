import { test } from "node:test";
import { strict as assert } from "node:assert";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { compile } from "./compile.js";

const fixturesRoot = fileURLToPath(new URL("./fixtures", import.meta.url));
const goodRoot = join(fixturesRoot, "good");
const companionRenderRoot = join(fixturesRoot, "companionRender");

const VALID_SKILL_IDS = ["dev-tools:ruby", "dev-tools:typescript", "foo:bar"] as const;

function withTempDist<T>(fn: (dist: string) => Promise<T>): Promise<T> {
  const dist = mkdtempSync(join(tmpdir(), "skill-kit-test-"));
  return fn(dist).finally(() => rmSync(dist, { recursive: true, force: true }));
}

interface SkillFixtureOptions {
  readonly skillSource: string;
  readonly bodyMd?: string;
  readonly companionFiles?: Readonly<Record<string, string>>;
}

function withSkillFixture<T>(
  options: SkillFixtureOptions,
  fn: (srcRoot: string, distRoot: string) => Promise<T>,
): Promise<T> {
  // Sandbox lives inside the package so SKILL.ts can resolve `#skill-kit` subpath imports.
  const sandbox = mkdtempSync(join(fixturesRoot, "_tmp_"));
  const srcRoot = join(sandbox, "src");
  const distRoot = mkdtempSync(join(tmpdir(), "skill-kit-dist-"));
  const skillDir = join(srcRoot, "plugins/foo/skills/bar");
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(join(skillDir, "SKILL.ts"), options.skillSource);
  if (options.bodyMd !== undefined) {
    writeFileSync(join(skillDir, "body.md"), options.bodyMd);
  }
  for (const [name, content] of Object.entries(options.companionFiles ?? {})) {
    writeFileSync(join(skillDir, name), content);
  }
  return fn(srcRoot, distRoot).finally(() => {
    rmSync(sandbox, { recursive: true, force: true });
    rmSync(distRoot, { recursive: true, force: true });
  });
}

const SKILL_TS_BARE = `import { defineSkill } from "#skill-kit";
export default defineSkill({ name: "bar", description: "fixture skill" });
`;

const SKILL_TS_WITH_COMPANION = `import { defineSkill } from "#skill-kit";
export default defineSkill({
  name: "bar",
  description: "fixture skill with companions",
  companions: [{ file: "a.md", summary: "First." }],
});
`;

test("compile emits SKILL.md with frontmatter and body for a typed skill source", async () => {
  await withTempDist(async (dist) => {
    await compile({ srcRoot: goodRoot, outRoot: dist, validSkillIds: VALID_SKILL_IDS });

    const skillPath = join(dist, "plugins/foo/skills/bar/SKILL.md");
    assert.ok(existsSync(skillPath), `expected ${skillPath} to exist`);

    const content = readFileSync(skillPath, "utf8");
    assert.match(
      content,
      /^---\nname: bar\ndescription: A tiny test skill that asserts the compile pipeline works\.\n---\n\n# Bar\n\nThis is the body\.\n$/,
    );
  });
});

test("compile copies non-skill plugin files verbatim", async () => {
  await withTempDist(async (dist) => {
    await compile({ srcRoot: goodRoot, outRoot: dist, validSkillIds: VALID_SKILL_IDS });

    const manifestPath = join(dist, "plugins/foo/.claude-plugin/plugin.json");
    assert.ok(existsSync(manifestPath), `expected ${manifestPath} to exist`);

    const original = readFileSync(join(goodRoot, "plugins/foo/.claude-plugin/plugin.json"), "utf8");
    const copied = readFileSync(manifestPath, "utf8");
    assert.equal(copied, original);
  });
});

test("compile does not write SKILL.ts source files into dist", async () => {
  await withTempDist(async (dist) => {
    await compile({ srcRoot: goodRoot, outRoot: dist, validSkillIds: VALID_SKILL_IDS });

    const tsPath = join(dist, "plugins/foo/skills/bar/SKILL.ts");
    assert.ok(!existsSync(tsPath), `did not expect ${tsPath} to exist`);
  });
});

test("compile copies .claude-plugin/marketplace.json verbatim into dist root", async () => {
  await withTempDist(async (dist) => {
    await compile({ srcRoot: goodRoot, outRoot: dist, validSkillIds: VALID_SKILL_IDS });

    const distManifest = join(dist, ".claude-plugin/marketplace.json");
    assert.ok(existsSync(distManifest), `expected ${distManifest} to exist`);
    const original = readFileSync(join(goodRoot, ".claude-plugin/marketplace.json"), "utf8");
    const copied = readFileSync(distManifest, "utf8");
    assert.equal(copied, original);
  });
});

test("compile ignores top-level files outside plugins/ and .claude-plugin/", async () => {
  await withTempDist(async (dist) => {
    await compile({ srcRoot: goodRoot, outRoot: dist, validSkillIds: VALID_SKILL_IDS });

    const stray = join(dist, "README.md");
    assert.ok(!existsSync(stray), `did not expect ${stray} to exist`);
  });
});

test("compile renders typed companions into the {{companions}} placeholder", async () => {
  await withTempDist(async (dist) => {
    await compile({
      srcRoot: companionRenderRoot,
      outRoot: dist,
      validSkillIds: VALID_SKILL_IDS,
    });

    const skillPath = join(dist, "plugins/foo/skills/bar/SKILL.md");
    const content = readFileSync(skillPath, "utf8");

    assert.ok(
      content.includes(
        "## Companion files (read on demand)\n\n- `a.md` — First companion.\n- `b.md` — Second companion.",
      ),
      `expected rendered companions section, got:\n${content}`,
    );
    assert.ok(
      !content.includes("{{companions}}"),
      `dist should not contain the raw token, got:\n${content}`,
    );
  });
});

test("compile reads body from sibling body.md", async () => {
  await withSkillFixture(
    {
      skillSource: SKILL_TS_BARE,
      bodyMd: "# Bar from body.md\n\nReal body content.\n",
    },
    async (srcRoot, distRoot) => {
      await compile({ srcRoot, outRoot: distRoot, validSkillIds: VALID_SKILL_IDS });
      const out = readFileSync(join(distRoot, "plugins/foo/skills/bar/SKILL.md"), "utf8");
      assert.match(out, /# Bar from body\.md\n\nReal body content\./);
    },
  );
});

test("compile fails when body.md is missing", async () => {
  await withSkillFixture({ skillSource: SKILL_TS_BARE }, async (srcRoot, distRoot) => {
    await assert.rejects(
      compile({ srcRoot, outRoot: distRoot, validSkillIds: VALID_SKILL_IDS }),
      /body\.md/,
    );
  });
});

test("compile does not copy body.md into dist", async () => {
  await withSkillFixture(
    { skillSource: SKILL_TS_BARE, bodyMd: "# Bar\n" },
    async (srcRoot, distRoot) => {
      await compile({ srcRoot, outRoot: distRoot, validSkillIds: VALID_SKILL_IDS });
      const stray = join(distRoot, "plugins/foo/skills/bar/body.md");
      assert.ok(!existsSync(stray), `did not expect ${stray} to exist`);
    },
  );
});

test("compile substitutes {{skill:...}} with a backticked skill id", async () => {
  await withSkillFixture(
    {
      skillSource: SKILL_TS_BARE,
      bodyMd: "see {{skill:dev-tools:ruby}} for ruby idioms",
    },
    async (srcRoot, distRoot) => {
      await compile({ srcRoot, outRoot: distRoot, validSkillIds: VALID_SKILL_IDS });
      const out = readFileSync(join(distRoot, "plugins/foo/skills/bar/SKILL.md"), "utf8");
      assert.match(out, /see `dev-tools:ruby` for ruby idioms/);
    },
  );
});

test("compile fails when {{skill:...}} references an id outside validSkillIds", async () => {
  await withSkillFixture(
    {
      skillSource: SKILL_TS_BARE,
      bodyMd: "see {{skill:dev-tools:nonexistent}}",
    },
    async (srcRoot, distRoot) => {
      await assert.rejects(
        compile({ srcRoot, outRoot: distRoot, validSkillIds: VALID_SKILL_IDS }),
        /dev-tools:nonexistent/,
      );
    },
  );
});

test("compile substitutes {{companion:...}} for a declared companion file", async () => {
  await withSkillFixture(
    {
      skillSource: SKILL_TS_WITH_COMPANION,
      bodyMd: "details in {{companion:a.md}}\n\n{{companions}}\n",
      companionFiles: { "a.md": "# A\n" },
    },
    async (srcRoot, distRoot) => {
      await compile({ srcRoot, outRoot: distRoot, validSkillIds: VALID_SKILL_IDS });
      const out = readFileSync(join(distRoot, "plugins/foo/skills/bar/SKILL.md"), "utf8");
      assert.match(out, /details in `a\.md`/);
    },
  );
});

test("compile fails when {{companion:...}} references an undeclared file", async () => {
  await withSkillFixture(
    {
      skillSource: SKILL_TS_WITH_COMPANION,
      bodyMd: "details in {{companion:ghost.md}}\n\n{{companions}}\n",
      companionFiles: { "a.md": "# A\n" },
    },
    async (srcRoot, distRoot) => {
      await assert.rejects(
        compile({ srcRoot, outRoot: distRoot, validSkillIds: VALID_SKILL_IDS }),
        /ghost\.md/,
      );
    },
  );
});

test("compile fails when companions are declared but {{companions}} token is absent", async () => {
  await withSkillFixture(
    {
      skillSource: SKILL_TS_WITH_COMPANION,
      bodyMd: "# Bar\n\nNo token here.\n",
      companionFiles: { "a.md": "# A\n" },
    },
    async (srcRoot, distRoot) => {
      await assert.rejects(
        compile({ srcRoot, outRoot: distRoot, validSkillIds: VALID_SKILL_IDS }),
        /\{\{companions\}\}/,
      );
    },
  );
});

test("compile fails when {{companions}} is present but no companions are declared", async () => {
  await withSkillFixture(
    {
      skillSource: SKILL_TS_BARE,
      bodyMd: "# Bar\n\n{{companions}}\n",
    },
    async (srcRoot, distRoot) => {
      await assert.rejects(
        compile({ srcRoot, outRoot: distRoot, validSkillIds: VALID_SKILL_IDS }),
        /no companions are declared/,
      );
    },
  );
});

test("compile fails on unknown placeholder prefix", async () => {
  await withSkillFixture(
    {
      skillSource: SKILL_TS_BARE,
      bodyMd: "# Bar\n\n{{nope:foo}}\n",
    },
    async (srcRoot, distRoot) => {
      await assert.rejects(
        compile({ srcRoot, outRoot: distRoot, validSkillIds: VALID_SKILL_IDS }),
        /unknown placeholder prefix "nope"/,
      );
    },
  );
});

test("compile runs consumer-supplied bodyInvariants", async () => {
  const callsForbidden = (body: string): string[] =>
    body.includes("FORBIDDEN") ? [`body contains forbidden token`] : [];
  await withSkillFixture(
    {
      skillSource: SKILL_TS_BARE,
      bodyMd: "# Bar\n\nFORBIDDEN should fail.\n",
    },
    async (srcRoot, distRoot) => {
      await assert.rejects(
        compile({
          srcRoot,
          outRoot: distRoot,
          validSkillIds: VALID_SKILL_IDS,
          bodyInvariants: [callsForbidden],
        }),
        /forbidden token/,
      );
    },
  );
});
