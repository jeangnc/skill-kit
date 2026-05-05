import { test } from "node:test";
import { strict as assert } from "node:assert";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { findSkillFile, loadSkill } from "../src/skill-source.js";

const fixturesRoot = fileURLToPath(new URL("./fixtures", import.meta.url));

interface SandboxOptions {
  readonly skillTs?: string;
  readonly skillMd?: string;
  readonly bodyMd?: string;
}

function withSkillSandbox<T>(
  options: SandboxOptions,
  fn: (skillDir: string) => Promise<T>,
): Promise<T> {
  const sandbox = mkdtempSync(join(fixturesRoot, "_tmp_skill_source_"));
  const skillDir = join(sandbox, "plugins/foo/skills/bar");
  mkdirSync(skillDir, { recursive: true });
  if (options.skillTs !== undefined) writeFileSync(join(skillDir, "SKILL.ts"), options.skillTs);
  if (options.skillMd !== undefined) writeFileSync(join(skillDir, "SKILL.md"), options.skillMd);
  if (options.bodyMd !== undefined) writeFileSync(join(skillDir, "body.md"), options.bodyMd);
  return fn(skillDir).finally(() => rmSync(sandbox, { recursive: true, force: true }));
}

const SKILL_TS_BARE = `import { defineSkill } from "#skill-kit";
export default defineSkill({ name: "bar", description: "fixture skill" });
`;

const SKILL_MD_BARE = `---
name: bar
description: fixture skill
---

# Bar
inline body
`;

test("findSkillFile returns null when neither SKILL.ts nor SKILL.md exists", async () => {
  await withSkillSandbox({}, async (skillDir) => {
    assert.equal(await findSkillFile(skillDir), null);
  });
});

test("findSkillFile returns SKILL.ts when only SKILL.ts exists", async () => {
  await withSkillSandbox({ skillTs: SKILL_TS_BARE }, async (skillDir) => {
    const result = await findSkillFile(skillDir);
    assert.ok(result);
    assert.equal(result.source, "ts");
    assert.equal(result.path, join(skillDir, "SKILL.ts"));
  });
});

test("findSkillFile returns SKILL.md when only SKILL.md exists", async () => {
  await withSkillSandbox({ skillMd: SKILL_MD_BARE }, async (skillDir) => {
    const result = await findSkillFile(skillDir);
    assert.ok(result);
    assert.equal(result.source, "md");
    assert.equal(result.path, join(skillDir, "SKILL.md"));
  });
});

test("findSkillFile throws when both SKILL.ts and SKILL.md exist", async () => {
  await withSkillSandbox(
    { skillTs: SKILL_TS_BARE, skillMd: SKILL_MD_BARE, bodyMd: "# body\n" },
    async (skillDir) => {
      await assert.rejects(findSkillFile(skillDir), /both SKILL\.ts and SKILL\.md/);
    },
  );
});

test("loadSkill returns parsed skill + body for a TS source", async () => {
  await withSkillSandbox(
    { skillTs: SKILL_TS_BARE, bodyMd: "# Bar\nbody from body.md\n" },
    async (skillDir) => {
      const loaded = await loadSkill(skillDir);
      assert.equal(loaded.source, "ts");
      assert.equal(loaded.skill.name, "bar");
      assert.equal(loaded.skill.description, "fixture skill");
      assert.equal(loaded.body, "# Bar\nbody from body.md\n");
      assert.equal(loaded.bodyOffset, 0);
      assert.equal(loaded.skillFilePath, join(skillDir, "SKILL.ts"));
      assert.equal(loaded.skillDir, skillDir);
    },
  );
});

test("loadSkill returns parsed skill + body for a MD source with non-zero bodyOffset", async () => {
  await withSkillSandbox({ skillMd: SKILL_MD_BARE }, async (skillDir) => {
    const loaded = await loadSkill(skillDir);
    assert.equal(loaded.source, "md");
    assert.equal(loaded.skill.name, "bar");
    assert.equal(loaded.skill.description, "fixture skill");
    assert.equal(loaded.body, "# Bar\ninline body\n");
    assert.ok(loaded.bodyOffset > 0, "MD body offset must point past the frontmatter");
    assert.equal(loaded.skillFilePath, join(skillDir, "SKILL.md"));
  });
});

test("loadSkill throws when MD source is accompanied by a body.md", async () => {
  await withSkillSandbox({ skillMd: SKILL_MD_BARE, bodyMd: "# rogue body\n" }, async (skillDir) => {
    await assert.rejects(loadSkill(skillDir), /body\.md.*forbidden|forbidden.*body\.md/i);
  });
});

test("loadSkill throws when TS source is missing body.md", async () => {
  await withSkillSandbox({ skillTs: SKILL_TS_BARE }, async (skillDir) => {
    await assert.rejects(loadSkill(skillDir), /body\.md/);
  });
});

test("loadSkill throws when MD frontmatter violates SkillSchema", async () => {
  const badFrontmatter = `---
name: BAR
description: x
---

body
`;
  await withSkillSandbox({ skillMd: badFrontmatter }, async (skillDir) => {
    await assert.rejects(loadSkill(skillDir), /name/);
  });
});

test("loadSkill throws when neither source file is present", async () => {
  await withSkillSandbox({}, async (skillDir) => {
    await assert.rejects(loadSkill(skillDir), /SKILL\.(ts|md)/);
  });
});
