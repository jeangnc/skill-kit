import { test } from "node:test";
import { strict as assert } from "node:assert";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { findSkillFile, loadSkill } from "./source.js";

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));

interface SandboxOptions {
  readonly skillTs?: string;
  readonly skillMd?: string;
  readonly bodyMd?: string;
}

async function withSkillSandbox<T>(
  options: SandboxOptions,
  fn: (skillDir: string) => Promise<T>,
): Promise<T> {
  const sandbox = mkdtempSync(join(repoRoot, ".test-tmp-skill-source-"));
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

test("findSkillFile returns ok-null when neither SKILL.ts nor SKILL.md exists", async () => {
  await withSkillSandbox({}, async (skillDir) => {
    const result = await findSkillFile(skillDir);
    if (!result.ok) assert.fail(`expected ok, got error: ${JSON.stringify(result.error)}`);
    assert.equal(result.value, null);
  });
});

test("findSkillFile returns SKILL.ts when only SKILL.ts exists", async () => {
  await withSkillSandbox({ skillTs: SKILL_TS_BARE }, async (skillDir) => {
    const result = await findSkillFile(skillDir);
    if (!result.ok) assert.fail(`expected ok, got error: ${JSON.stringify(result.error)}`);
    assert.ok(result.value);
    assert.equal(result.value.source, "ts");
    assert.equal(result.value.path, join(skillDir, "SKILL.ts"));
  });
});

test("findSkillFile returns SKILL.md when only SKILL.md exists", async () => {
  await withSkillSandbox({ skillMd: SKILL_MD_BARE }, async (skillDir) => {
    const result = await findSkillFile(skillDir);
    if (!result.ok) assert.fail(`expected ok, got error: ${JSON.stringify(result.error)}`);
    assert.ok(result.value);
    assert.equal(result.value.source, "md");
    assert.equal(result.value.path, join(skillDir, "SKILL.md"));
  });
});

test("findSkillFile, when both SKILL.ts and SKILL.md exist, returns ambiguous-source error", async () => {
  await withSkillSandbox(
    { skillTs: SKILL_TS_BARE, skillMd: SKILL_MD_BARE, bodyMd: "# body\n" },
    async (skillDir) => {
      const result = await findSkillFile(skillDir);
      if (result.ok) assert.fail("expected error, got ok");
      assert.equal(result.error.tag, "ambiguous-source");
      assert.equal(result.error.skillDir, skillDir);
    },
  );
});

test("loadSkill returns parsed skill + body for a TS source", async () => {
  await withSkillSandbox(
    { skillTs: SKILL_TS_BARE, bodyMd: "# Bar\nbody from body.md\n" },
    async (skillDir) => {
      const result = await loadSkill(skillDir);
      if (!result.ok) assert.fail(`expected ok, got error: ${JSON.stringify(result.error)}`);
      const loaded = result.value;
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
    const result = await loadSkill(skillDir);
    if (!result.ok) assert.fail(`expected ok, got error: ${JSON.stringify(result.error)}`);
    const loaded = result.value;
    assert.equal(loaded.source, "md");
    assert.equal(loaded.skill.name, "bar");
    assert.equal(loaded.skill.description, "fixture skill");
    assert.equal(loaded.body, "# Bar\ninline body\n");
    assert.ok(loaded.bodyOffset > 0, "MD body offset must point past the frontmatter");
    assert.equal(loaded.skillFilePath, join(skillDir, "SKILL.md"));
  });
});

test("loadSkill, when MD source is accompanied by a body.md, returns forbidden-body error", async () => {
  await withSkillSandbox({ skillMd: SKILL_MD_BARE, bodyMd: "# rogue body\n" }, async (skillDir) => {
    const result = await loadSkill(skillDir);
    if (result.ok) assert.fail("expected error, got ok");
    assert.equal(result.error.tag, "forbidden-body");
  });
});

test("loadSkill, when TS source is missing body.md, returns missing-body error", async () => {
  await withSkillSandbox({ skillTs: SKILL_TS_BARE }, async (skillDir) => {
    const result = await loadSkill(skillDir);
    if (result.ok) assert.fail("expected error, got ok");
    assert.equal(result.error.tag, "missing-body");
  });
});

test("loadSkill, when MD frontmatter violates SkillSchema, returns schema-violation error with issues", async () => {
  const badFrontmatter = `---
name: BAR
description: x
---

body
`;
  await withSkillSandbox({ skillMd: badFrontmatter }, async (skillDir) => {
    const result = await loadSkill(skillDir);
    if (result.ok) assert.fail("expected error, got ok");
    assert.equal(result.error.tag, "schema-violation");
    if (result.error.tag !== "schema-violation") return;
    assert.ok(result.error.issues.some((i) => i.includes("name")));
  });
});

test("loadSkill, when neither source file is present, returns no-source error", async () => {
  await withSkillSandbox({}, async (skillDir) => {
    const result = await loadSkill(skillDir);
    if (result.ok) assert.fail("expected error, got ok");
    assert.equal(result.error.tag, "no-source");
  });
});
