import { test } from "node:test";
import { strict as assert } from "node:assert";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  defaultSources,
  discoverInstalledSkills,
  indexSkills,
  type PluginSource,
} from "./installed.js";

async function withInstalledSourceFixture<T>(fn: (root: string) => Promise<T>): Promise<T> {
  const root = mkdtempSync(join(tmpdir(), "skill-kit-sources-"));
  return fn(root).finally(() => rmSync(root, { recursive: true, force: true }));
}

interface FlatSkillSpec {
  readonly layout: "flat";
  readonly marketplace: string;
  readonly plugin: string;
  readonly skill: string;
}

interface VersionedSkillSpec {
  readonly layout: "versioned";
  readonly marketplace: string;
  readonly plugin: string;
  readonly version: string;
  readonly skill: string;
}

type SkillSpec = FlatSkillSpec | VersionedSkillSpec;

function pluginRootSegments(spec: SkillSpec): readonly string[] {
  return spec.layout === "flat"
    ? [spec.marketplace, spec.plugin]
    : [spec.marketplace, spec.plugin, spec.version];
}

function placeSkill(root: string, spec: SkillSpec): string {
  const pluginRoot = join(root, ...pluginRootSegments(spec));
  const skillDir = join(pluginRoot, "skills", spec.skill);
  mkdirSync(skillDir, { recursive: true });
  mkdirSync(join(pluginRoot, ".claude-plugin"), { recursive: true });
  writeFileSync(
    join(pluginRoot, ".claude-plugin/plugin.json"),
    JSON.stringify({ name: spec.plugin, version: "version" in spec ? spec.version : "1.0.0" }),
  );
  writeFileSync(
    join(skillDir, "SKILL.md"),
    `---\nname: ${spec.skill}\ndescription: x\n---\n\nbody\n`,
  );
  return join(skillDir, "SKILL.md");
}

test("discoverInstalledSkills finds skills in a flat <marketplace>/<plugin>/skills/<skill>/SKILL.md layout", async () => {
  await withInstalledSourceFixture(async (root) => {
    placeSkill(root, {
      layout: "flat",
      marketplace: "market-a",
      plugin: "plugin-x",
      skill: "skill-1",
    });
    placeSkill(root, {
      layout: "flat",
      marketplace: "market-a",
      plugin: "plugin-x",
      skill: "skill-2",
    });
    placeSkill(root, {
      layout: "flat",
      marketplace: "market-a",
      plugin: "plugin-y",
      skill: "lone",
    });
    const result = await discoverInstalledSkills([{ name: "claude", root }]);
    const ids = result.map((s) => `${s.plugin}:${s.skill}`).sort();
    assert.deepEqual(ids, ["plugin-x:skill-1", "plugin-x:skill-2", "plugin-y:lone"]);
  });
});

test("discoverInstalledSkills finds skills in a versioned <marketplace>/<plugin>/<version>/skills/<skill>/SKILL.md layout", async () => {
  await withInstalledSourceFixture(async (root) => {
    placeSkill(root, {
      layout: "versioned",
      marketplace: "market-b",
      plugin: "plugin-z",
      version: "1.0.0",
      skill: "main",
    });
    placeSkill(root, {
      layout: "versioned",
      marketplace: "market-b",
      plugin: "plugin-z",
      version: "1.0.0",
      skill: "helper",
    });
    const result = await discoverInstalledSkills([{ name: "codex", root }]);
    const ids = result.map((s) => `${s.plugin}:${s.skill}`).sort();
    assert.deepEqual(ids, ["plugin-z:helper", "plugin-z:main"]);
  });
});

test("discoverInstalledSkills tags each skill with its source name", async () => {
  await withInstalledSourceFixture(async (root) => {
    const skillFile = placeSkill(root, {
      layout: "flat",
      marketplace: "m",
      plugin: "p",
      skill: "s",
    });
    const [skill] = await discoverInstalledSkills([{ name: "claude", root }]);
    assert.ok(skill);
    assert.equal(skill.source, "claude");
    assert.equal(skill.plugin, "p");
    assert.equal(skill.skill, "s");
    assert.equal(skill.path, skillFile);
  });
});

test("discoverInstalledSkills returns empty when source root does not exist (e.g. user has no codex install)", async () => {
  const result = await discoverInstalledSkills([
    { name: "codex", root: "/this/path/definitely/does/not/exist" },
  ]);
  assert.deepEqual(result, []);
});

test("discoverInstalledSkills returns empty when source root exists but has no skills", async () => {
  await withInstalledSourceFixture(async (root) => {
    const result = await discoverInstalledSkills([{ name: "claude", root }]);
    assert.deepEqual(result, []);
  });
});

test("discoverInstalledSkills aggregates skills across multiple sources", async () => {
  await withInstalledSourceFixture(async (claudeRoot) => {
    await withInstalledSourceFixture(async (codexRoot) => {
      placeSkill(claudeRoot, { layout: "flat", marketplace: "m", plugin: "shared", skill: "main" });
      placeSkill(codexRoot, {
        layout: "versioned",
        marketplace: "m",
        plugin: "shared",
        version: "1.0.0",
        skill: "main",
      });
      placeSkill(codexRoot, {
        layout: "versioned",
        marketplace: "m",
        plugin: "codex-only",
        version: "1.0.0",
        skill: "exclusive",
      });
      const result = await discoverInstalledSkills([
        { name: "claude", root: claudeRoot },
        { name: "codex", root: codexRoot },
      ]);
      const ids = result.map((s) => `${s.source}/${s.plugin}:${s.skill}`).sort();
      assert.deepEqual(ids, [
        "claude/shared:main",
        "codex/codex-only:exclusive",
        "codex/shared:main",
      ]);
    });
  });
});

test("discoverInstalledSkills skips symlinked directories to avoid loops", async () => {
  await withInstalledSourceFixture(async (root) => {
    placeSkill(root, { layout: "flat", marketplace: "m", plugin: "p", skill: "real" });
    symlinkSync(join(root, "m"), join(root, "loop"));
    const result = await discoverInstalledSkills([{ name: "claude", root }]);
    const ids = result.map((s) => `${s.plugin}:${s.skill}`);
    assert.deepEqual(ids, ["p:real"]);
  });
});

test("indexSkills groups installed skills by <plugin>:<skill> id", async () => {
  await withInstalledSourceFixture(async (root) => {
    placeSkill(root, {
      layout: "flat",
      marketplace: "market-a",
      plugin: "plugin-x",
      skill: "skill-1",
    });
    placeSkill(root, {
      layout: "flat",
      marketplace: "market-b",
      plugin: "plugin-x",
      skill: "skill-1",
    });
    const skills = await discoverInstalledSkills([{ name: "claude", root }]);
    const index = indexSkills(skills);
    assert.equal(index.get("plugin-x:skill-1")?.length, 2);
    assert.equal(index.has("plugin-x:other"), false);
  });
});

test("defaultSources returns a claude source and a codex source", () => {
  const names = defaultSources()
    .map((s: PluginSource) => s.name)
    .sort();
  assert.deepEqual(names, ["claude", "codex"]);
});

test("defaultSources roots resolve under the user's home directory", () => {
  for (const source of defaultSources()) {
    assert.match(source.root, /\.(claude|codex)\/plugins\/cache$/);
  }
});
