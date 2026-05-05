import { test } from "node:test";
import { strict as assert } from "node:assert";
import {
  mkdtempSync,
  rmSync,
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  chmodSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { compile } from "../src/compile/index.js";

const fixturesRoot = fileURLToPath(new URL("./fixtures", import.meta.url));
const goodRoot = join(fixturesRoot, "good");
const companionRenderRoot = join(fixturesRoot, "companionRender");
const withPluginRoot = join(fixturesRoot, "withPlugin");

function withTempDist<T>(fn: (dist: string) => Promise<T>): Promise<T> {
  const dist = mkdtempSync(join(tmpdir(), "skill-kit-test-"));
  return fn(dist).finally(() => rmSync(dist, { recursive: true, force: true }));
}

interface SkillFixtureOptions {
  readonly skillSource?: string;
  readonly skillMd?: string;
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
  if (options.skillSource !== undefined) {
    writeFileSync(join(skillDir, "SKILL.ts"), options.skillSource);
  }
  if (options.skillMd !== undefined) {
    writeFileSync(join(skillDir, "SKILL.md"), options.skillMd);
  }
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

interface PluginFixtureOptions {
  readonly pluginName?: string;
  readonly pluginSource: string;
  readonly extraFiles?: Readonly<Record<string, string>>;
}

function withPluginFixture<T>(
  options: PluginFixtureOptions,
  fn: (srcRoot: string, distRoot: string) => Promise<T>,
): Promise<T> {
  const sandbox = mkdtempSync(join(fixturesRoot, "_tmp_"));
  const srcRoot = join(sandbox, "src");
  const distRoot = mkdtempSync(join(tmpdir(), "skill-kit-dist-"));
  const pluginDir = join(srcRoot, "plugins", options.pluginName ?? "foo");
  mkdirSync(pluginDir, { recursive: true });
  writeFileSync(join(pluginDir, "PLUGIN.ts"), options.pluginSource);
  for (const [relPath, content] of Object.entries(options.extraFiles ?? {})) {
    const target = join(pluginDir, relPath);
    mkdirSync(join(target, ".."), { recursive: true });
    writeFileSync(target, content);
  }
  return fn(srcRoot, distRoot).finally(() => {
    rmSync(sandbox, { recursive: true, force: true });
    rmSync(distRoot, { recursive: true, force: true });
  });
}

function makeStubSkill(srcRoot: string, plugin: string, name: string): void {
  const dir = join(srcRoot, "plugins", plugin, "skills", name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "SKILL.ts"),
    `import { defineSkill } from "#skill-kit";\nexport default defineSkill({ name: "${name}", description: "stub" });\n`,
  );
  writeFileSync(join(dir, "body.md"), `# ${name}\n`);
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
    await compile({ srcRoot: goodRoot, outRoot: dist });

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
    await compile({ srcRoot: goodRoot, outRoot: dist });

    const manifestPath = join(dist, "plugins/foo/.claude-plugin/plugin.json");
    assert.ok(existsSync(manifestPath), `expected ${manifestPath} to exist`);

    const original = readFileSync(join(goodRoot, "plugins/foo/.claude-plugin/plugin.json"), "utf8");
    const copied = readFileSync(manifestPath, "utf8");
    assert.equal(copied, original);
  });
});

test("compile does not write SKILL.ts source files into dist", async () => {
  await withTempDist(async (dist) => {
    await compile({ srcRoot: goodRoot, outRoot: dist });

    const tsPath = join(dist, "plugins/foo/skills/bar/SKILL.ts");
    assert.ok(!existsSync(tsPath), `did not expect ${tsPath} to exist`);
  });
});

test("compile copies .claude-plugin/marketplace.json verbatim into dist root", async () => {
  await withTempDist(async (dist) => {
    await compile({ srcRoot: goodRoot, outRoot: dist });

    const distManifest = join(dist, ".claude-plugin/marketplace.json");
    assert.ok(existsSync(distManifest), `expected ${distManifest} to exist`);
    const original = readFileSync(join(goodRoot, ".claude-plugin/marketplace.json"), "utf8");
    const copied = readFileSync(distManifest, "utf8");
    assert.equal(copied, original);
  });
});

test("compile ignores top-level files outside plugins/ and .claude-plugin/", async () => {
  await withTempDist(async (dist) => {
    await compile({ srcRoot: goodRoot, outRoot: dist });

    const stray = join(dist, "README.md");
    assert.ok(!existsSync(stray), `did not expect ${stray} to exist`);
  });
});

test("compile renders typed companions into the {{companions}} placeholder", async () => {
  await withTempDist(async (dist) => {
    await compile({ srcRoot: companionRenderRoot, outRoot: dist });

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
      await compile({ srcRoot, outRoot: distRoot });
      const out = readFileSync(join(distRoot, "plugins/foo/skills/bar/SKILL.md"), "utf8");
      assert.match(out, /# Bar from body\.md\n\nReal body content\./);
    },
  );
});

test("compile fails when body.md is missing", async () => {
  await withSkillFixture({ skillSource: SKILL_TS_BARE }, async (srcRoot, distRoot) => {
    await assert.rejects(compile({ srcRoot, outRoot: distRoot }), /body\.md/);
  });
});

test("compile does not copy body.md into dist", async () => {
  await withSkillFixture(
    { skillSource: SKILL_TS_BARE, bodyMd: "# Bar\n" },
    async (srcRoot, distRoot) => {
      await compile({ srcRoot, outRoot: distRoot });
      const stray = join(distRoot, "plugins/foo/skills/bar/body.md");
      assert.ok(!existsSync(stray), `did not expect ${stray} to exist`);
    },
  );
});

test("compile substitutes {{skill:...}} for a discovered local skill", async () => {
  await withSkillFixture(
    {
      skillSource: SKILL_TS_BARE,
      bodyMd: "see {{skill:dev-tools:ruby}} for ruby idioms",
    },
    async (srcRoot, distRoot) => {
      makeStubSkill(srcRoot, "dev-tools", "ruby");
      await compile({ srcRoot, outRoot: distRoot });
      const out = readFileSync(join(distRoot, "plugins/foo/skills/bar/SKILL.md"), "utf8");
      assert.match(out, /see `dev-tools:ruby` for ruby idioms/);
    },
  );
});

test("compile fails when {{skill:...}} references an id that is not a local skill", async () => {
  await withSkillFixture(
    {
      skillSource: SKILL_TS_BARE,
      bodyMd: "see {{skill:dev-tools:nonexistent}}",
    },
    async (srcRoot, distRoot) => {
      await assert.rejects(compile({ srcRoot, outRoot: distRoot }), /dev-tools:nonexistent/);
    },
  );
});

test("compile renders {{ext:...}} as a backticked id without checking it exists", async () => {
  await withSkillFixture(
    {
      skillSource: SKILL_TS_BARE,
      bodyMd: "see {{ext:superpowers:test-driven-development}} for TDD",
    },
    async (srcRoot, distRoot) => {
      await compile({ srcRoot, outRoot: distRoot });
      const out = readFileSync(join(distRoot, "plugins/foo/skills/bar/SKILL.md"), "utf8");
      assert.match(out, /see `superpowers:test-driven-development` for TDD/);
    },
  );
});

test("compile fails when {{ext:...}} value does not have <plugin>:<skill> shape", async () => {
  await withSkillFixture(
    {
      skillSource: SKILL_TS_BARE,
      bodyMd: "see {{ext:lonelyid}} for nothing",
    },
    async (srcRoot, distRoot) => {
      await assert.rejects(
        compile({ srcRoot, outRoot: distRoot }),
        /ext.*plugin.*:.*skill|<plugin>:<skill>/,
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
      await assert.rejects(compile({ srcRoot, outRoot: distRoot }), /\{\{companions\}\}/);
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
      await assert.rejects(compile({ srcRoot, outRoot: distRoot }), /no companions are declared/);
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
        compile({ srcRoot, outRoot: distRoot }),
        /unknown placeholder prefix "nope"/,
      );
    },
  );
});

test("compile rejects a default export that violates SkillSchema (e.g. defineSkill is bypassed)", async () => {
  const SKILL_TS_BYPASSES_DEFINE_SKILL = `import type { Skill } from "#skill-kit";
export default { name: "bar", description: "line one\\nline two" } as Skill;
`;
  await withSkillFixture(
    {
      skillSource: SKILL_TS_BYPASSES_DEFINE_SKILL,
      bodyMd: "# Bar\n",
    },
    async (srcRoot, distRoot) => {
      await assert.rejects(compile({ srcRoot, outRoot: distRoot }), /description/i);
    },
  );
});

test("compile emits plugin.json from PLUGIN.ts with legacy keys preserved", async () => {
  await withTempDist(async (dist) => {
    await compile({ srcRoot: withPluginRoot, outRoot: dist });

    const manifestPath = join(dist, "plugins/foo/.claude-plugin/plugin.json");
    assert.ok(existsSync(manifestPath), `expected ${manifestPath} to exist`);

    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<string, unknown>;
    assert.equal(manifest.name, "foo");
    assert.equal(manifest.version, "1.2.3");
    assert.equal(manifest.description, "demo plugin used by withPlugin fixture");
    assert.equal(manifest.license, "MIT");
    assert.deepEqual(manifest.keywords, ["claude", "demo"]);
    assert.deepEqual(manifest.dependencies, ["bar-core"]);
  });
});

test("compile does not write PLUGIN.ts source files into dist", async () => {
  await withTempDist(async (dist) => {
    await compile({ srcRoot: withPluginRoot, outRoot: dist });

    const tsPath = join(dist, "plugins/foo/PLUGIN.ts");
    assert.ok(!existsSync(tsPath), `did not expect ${tsPath} to exist`);
  });
});

test("compile does not emit context into the legacy plugin.json", async () => {
  await withTempDist(async (dist) => {
    await compile({ srcRoot: withPluginRoot, outRoot: dist });

    const manifest = JSON.parse(
      readFileSync(join(dist, "plugins/foo/.claude-plugin/plugin.json"), "utf8"),
    ) as Record<string, unknown>;
    assert.equal("context" in manifest, false);
  });
});

test("compile rejects collision when both PLUGIN.ts and .claude-plugin/plugin.json exist", async () => {
  await withPluginFixture(
    {
      pluginSource: `import { definePlugin } from "#skill-kit";
export default definePlugin({ name: "foo", version: "1.0.0", description: "demo" });
`,
      extraFiles: {
        ".claude-plugin/plugin.json": JSON.stringify({ name: "foo", version: "1.0.0" }),
      },
    },
    async (srcRoot, distRoot) => {
      await assert.rejects(
        compile({ srcRoot, outRoot: distRoot }),
        /both PLUGIN\.ts and \.claude-plugin\/plugin\.json/,
      );
    },
  );
});

test("compile fails when PLUGIN.ts name does not match the plugin folder", async () => {
  await withPluginFixture(
    {
      pluginName: "foo",
      pluginSource: `import { definePlugin } from "#skill-kit";
export default definePlugin({ name: "wrong", version: "1.0.0", description: "demo" });
`,
    },
    async (srcRoot, distRoot) => {
      await assert.rejects(
        compile({ srcRoot, outRoot: distRoot }),
        /name "wrong" does not match folder "foo"/,
      );
    },
  );
});

test("compile fails when a context entry references a missing file", async () => {
  await withPluginFixture(
    {
      pluginSource: `import { definePlugin } from "#skill-kit";
export default definePlugin({
  name: "foo",
  version: "1.0.0",
  description: "demo",
  context: [{ file: "context/ghost.md", summary: "missing" }],
});
`,
    },
    async (srcRoot, distRoot) => {
      await assert.rejects(
        compile({ srcRoot, outRoot: distRoot }),
        /context entry.*context\/ghost\.md/,
      );
    },
  );
});

test("compile accepts a plugin with context whose files exist", async () => {
  await withPluginFixture(
    {
      pluginSource: `import { definePlugin } from "#skill-kit";
export default definePlugin({
  name: "foo",
  version: "1.0.0",
  description: "demo",
  context: [{ file: "context/instructions.md", summary: "ok" }],
});
`,
      extraFiles: {
        "context/instructions.md": "# Instructions\n",
      },
    },
    async (srcRoot, distRoot) => {
      await compile({ srcRoot, outRoot: distRoot });
      assert.ok(existsSync(join(distRoot, "plugins/foo/.claude-plugin/plugin.json")));
      assert.ok(existsSync(join(distRoot, "plugins/foo/context/instructions.md")));
    },
  );
});

test("compile substitutes {{ref:path}} for a file that exists relative to the skill", async () => {
  await withPluginFixture(
    {
      pluginSource: `import { definePlugin } from "#skill-kit";
export default definePlugin({ name: "foo", version: "1.0.0", description: "demo" });
`,
      extraFiles: {
        "shared/linear-ids.md": "# Linear IDs\n",
        "skills/bar/SKILL.ts": `import { defineSkill } from "#skill-kit";
export default defineSkill({ name: "bar", description: "fixture" });
`,
        "skills/bar/body.md": "see {{ref:../../shared/linear-ids.md}} for the map\n",
      },
    },
    async (srcRoot, distRoot) => {
      await compile({ srcRoot, outRoot: distRoot });
      const out = readFileSync(join(distRoot, "plugins/foo/skills/bar/SKILL.md"), "utf8");
      assert.match(out, /see `\.\.\/\.\.\/shared\/linear-ids\.md` for the map/);
    },
  );
});

test("compile fails when {{ref:path}} resolves to a missing file", async () => {
  await withPluginFixture(
    {
      pluginSource: `import { definePlugin } from "#skill-kit";
export default definePlugin({ name: "foo", version: "1.0.0", description: "demo" });
`,
      extraFiles: {
        "skills/bar/SKILL.ts": `import { defineSkill } from "#skill-kit";
export default defineSkill({ name: "bar", description: "fixture" });
`,
        "skills/bar/body.md": "see {{ref:../../shared/missing.md}}\n",
      },
    },
    async (srcRoot, distRoot) => {
      await assert.rejects(compile({ srcRoot, outRoot: distRoot }), /ref.*missing\.md.*not found/);
    },
  );
});

test("compile preserves the executable bit on hook scripts copied through dist", async () => {
  await withPluginFixture(
    {
      pluginSource: `import { definePlugin } from "#skill-kit";
export default definePlugin({ name: "foo", version: "1.0.0", description: "demo" });
`,
      extraFiles: { "hooks/example.sh": "#!/usr/bin/env bash\necho hi\n" },
    },
    async (srcRoot, distRoot) => {
      chmodSync(join(srcRoot, "plugins/foo/hooks/example.sh"), 0o755);
      await compile({ srcRoot, outRoot: distRoot });

      const distScript = join(distRoot, "plugins/foo/hooks/example.sh");
      assert.ok(existsSync(distScript), `expected ${distScript} to exist`);
      const mode = statSync(distScript).mode & 0o777;
      assert.equal(
        mode,
        0o755,
        `expected mode 0755, got 0${mode.toString(8)} — copyFile lost the +x bit`,
      );
    },
  );
});

test("compile emits dist SKILL.md from a plain SKILL.md source", async () => {
  const skillMd = `---
name: bar
description: plain markdown skill
---

# Bar
inline body
`;
  await withSkillFixture({ skillMd }, async (srcRoot, distRoot) => {
    await compile({ srcRoot, outRoot: distRoot });
    const out = readFileSync(join(distRoot, "plugins/foo/skills/bar/SKILL.md"), "utf8");
    assert.match(
      out,
      /^---\nname: bar\ndescription: plain markdown skill\n---\n\n# Bar\ninline body\n$/,
    );
  });
});

test("compile substitutes {{ext:...}} in a plain SKILL.md body", async () => {
  const skillMd = `---
name: bar
description: plain skill
---

see {{ext:superpowers:tdd}} for tdd
`;
  await withSkillFixture({ skillMd }, async (srcRoot, distRoot) => {
    await compile({ srcRoot, outRoot: distRoot });
    const out = readFileSync(join(distRoot, "plugins/foo/skills/bar/SKILL.md"), "utf8");
    assert.match(out, /see `superpowers:tdd` for tdd/);
    assert.ok(!out.includes("{{ext:"), "raw token should not survive in dist");
  });
});

test("compile renders companions declared in SKILL.md frontmatter", async () => {
  const skillMd = `---
name: bar
description: skill with companions in frontmatter
companions:
  - file: a.md
    summary: First companion.
  - file: b.md
    summary: Second companion.
---

# Bar

{{companions}}
`;
  await withSkillFixture(
    { skillMd, companionFiles: { "a.md": "# A\n", "b.md": "# B\n" } },
    async (srcRoot, distRoot) => {
      await compile({ srcRoot, outRoot: distRoot });
      const out = readFileSync(join(distRoot, "plugins/foo/skills/bar/SKILL.md"), "utf8");
      assert.ok(
        out.includes(
          "## Companion files (read on demand)\n\n- `a.md` — First companion.\n- `b.md` — Second companion.",
        ),
        `expected rendered companions section, got:\n${out}`,
      );
    },
  );
});

test("compile emits companions in dist frontmatter when declared", async () => {
  const skillMd = `---
name: bar
description: skill with companions
companions:
  - file: a.md
    summary: First.
---

# Bar

{{companions}}
`;
  await withSkillFixture(
    { skillMd, companionFiles: { "a.md": "# A\n" } },
    async (srcRoot, distRoot) => {
      await compile({ srcRoot, outRoot: distRoot });
      const out = readFileSync(join(distRoot, "plugins/foo/skills/bar/SKILL.md"), "utf8");
      const frontmatterMatch = /^---\n([\s\S]*?)\n---/.exec(out);
      assert.ok(frontmatterMatch, "dist file should have frontmatter");
      const fm = frontmatterMatch[1] ?? "";
      assert.match(fm, /companions:/);
      assert.match(fm, /file: a\.md/);
      assert.match(fm, /summary: First\./);
    },
  );
});

test("compile fails when both SKILL.ts and SKILL.md exist in the same skill folder", async () => {
  await withSkillFixture(
    {
      skillSource: SKILL_TS_BARE,
      skillMd: `---\nname: bar\ndescription: x\n---\n\n# Bar\n`,
      bodyMd: "# Bar\n",
    },
    async (srcRoot, distRoot) => {
      await assert.rejects(compile({ srcRoot, outRoot: distRoot }), /both SKILL\.ts and SKILL\.md/);
    },
  );
});

test("compile fails when SKILL.md and body.md coexist in the same skill folder", async () => {
  const skillMd = `---\nname: bar\ndescription: x\n---\n\n# Bar\n`;
  await withSkillFixture({ skillMd, bodyMd: "# rogue body\n" }, async (srcRoot, distRoot) => {
    await assert.rejects(compile({ srcRoot, outRoot: distRoot }), /body\.md.*forbidden/i);
  });
});

test("compile does not write the source SKILL.md as both rewritten skill and verbatim copy", async () => {
  const skillMd = `---\nname: bar\ndescription: x\n---\n\nsee {{ext:foo:bar}}\n`;
  await withSkillFixture({ skillMd }, async (srcRoot, distRoot) => {
    await compile({ srcRoot, outRoot: distRoot });
    const out = readFileSync(join(distRoot, "plugins/foo/skills/bar/SKILL.md"), "utf8");
    assert.ok(
      !out.includes("{{ext:"),
      `dist SKILL.md should be the rewritten version, got:\n${out}`,
    );
  });
});

test("compile renders {{skill:...}} from a plain SKILL.md to a TS-authored sibling", async () => {
  const skillMd = `---\nname: bar\ndescription: x\n---\n\nsee {{skill:dev-tools:ruby}}\n`;
  await withSkillFixture({ skillMd }, async (srcRoot, distRoot) => {
    makeStubSkill(srcRoot, "dev-tools", "ruby");
    await compile({ srcRoot, outRoot: distRoot });
    const out = readFileSync(join(distRoot, "plugins/foo/skills/bar/SKILL.md"), "utf8");
    assert.match(out, /see `dev-tools:ruby`/);
  });
});

test("compile discovers a SKILL.md skill as a local skill (visible to {{skill:...}} from elsewhere)", async () => {
  const skillMd = `---\nname: bar\ndescription: x\n---\n\nsee {{skill:other:peer}}\n`;
  await withSkillFixture({ skillMd }, async (srcRoot, distRoot) => {
    // peer is also authored as SKILL.md — must be discovered
    const peerDir = join(srcRoot, "plugins/other/skills/peer");
    mkdirSync(peerDir, { recursive: true });
    writeFileSync(join(peerDir, "SKILL.md"), `---\nname: peer\ndescription: peer\n---\n\n# Peer\n`);
    await compile({ srcRoot, outRoot: distRoot });
    const out = readFileSync(join(distRoot, "plugins/foo/skills/bar/SKILL.md"), "utf8");
    assert.match(out, /see `other:peer`/);
  });
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
          bodyInvariants: [callsForbidden],
        }),
        /forbidden token/,
      );
    },
  );
});
