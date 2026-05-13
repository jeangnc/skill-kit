import { test } from "node:test";
import { strict as assert } from "node:assert";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { loadLayout } from "./index.js";

interface PluginManifest {
  readonly name: string;
  readonly version?: string;
  readonly description?: string;
  readonly commands?: string;
  readonly agents?: string;
  readonly hooks?: string;
  readonly skills?: string;
}

interface MarketplaceManifest {
  readonly name: string;
  readonly owner: { readonly name: string; readonly email?: string };
  readonly metadata?: { readonly pluginRoot?: string; readonly version?: string };
  readonly plugins: ReadonlyArray<{
    readonly name: string;
    readonly source: string | Record<string, unknown>;
  }>;
}

interface PluginSpec {
  readonly slug: string;
  readonly dir: string;
  readonly manifest: PluginManifest;
  readonly manifestFormat?: "json" | "ts" | "both";
}

interface FixtureOptions {
  readonly marketplace: MarketplaceManifest;
  readonly plugins: readonly PluginSpec[];
}

async function withFixture<T>(
  options: FixtureOptions,
  fn: (srcRoot: string) => Promise<T>,
): Promise<T> {
  const srcRoot = mkdtempSync(join(tmpdir(), "harness-kit-layout-"));
  try {
    mkdirSync(join(srcRoot, ".claude-plugin"), { recursive: true });
    writeFileSync(
      join(srcRoot, ".claude-plugin/marketplace.json"),
      JSON.stringify(options.marketplace, null, 2),
    );
    for (const plugin of options.plugins) {
      const pluginDir = join(srcRoot, plugin.dir);
      mkdirSync(pluginDir, { recursive: true });
      const format = plugin.manifestFormat ?? "json";
      if (format === "json" || format === "both") {
        mkdirSync(join(pluginDir, ".claude-plugin"), { recursive: true });
        writeFileSync(
          join(pluginDir, ".claude-plugin/plugin.json"),
          JSON.stringify(plugin.manifest, null, 2),
        );
      }
      if (format === "ts" || format === "both") {
        const body = JSON.stringify(plugin.manifest, null, 2);
        writeFileSync(join(pluginDir, "PLUGIN.ts"), `export default ${body};\n`);
      }
    }
    return await fn(srcRoot);
  } finally {
    rmSync(srcRoot, { recursive: true, force: true });
  }
}

const minimalMarketplace = (
  plugins: ReadonlyArray<{ name: string; source: string | Record<string, unknown> }>,
  extra: Partial<MarketplaceManifest> = {},
): MarketplaceManifest => ({
  name: "test-marketplace",
  owner: { name: "Jean" },
  ...extra,
  plugins,
});

test("loadLayout resolves a default-layout plugin", async () => {
  await withFixture(
    {
      marketplace: minimalMarketplace([{ name: "foo", source: "./plugins/foo" }]),
      plugins: [
        {
          slug: "foo",
          dir: "plugins/foo",
          manifest: { name: "foo", version: "1.0.0", description: "demo" },
        },
      ],
    },
    async (srcRoot) => {
      const result = await loadLayout(srcRoot);
      assert.equal(result.ok, true);
      if (!result.ok) return;
      assert.equal(result.value.marketplace.name, "test-marketplace");
      assert.equal(result.value.plugins.length, 1);
      const plugin = result.value.plugins[0];
      assert.ok(plugin);
      assert.equal(plugin.name, "foo");
      assert.equal(plugin.pluginDir, join(srcRoot, "plugins/foo"));
      assert.equal(plugin.skillsDir, join(srcRoot, "plugins/foo/skills"));
      assert.equal(plugin.commandsDir, join(srcRoot, "plugins/foo/commands"));
      assert.equal(plugin.agentsDir, join(srcRoot, "plugins/foo/agents"));
      assert.equal(plugin.hooksDir, join(srcRoot, "plugins/foo/hooks"));
    },
  );
});

test("loadLayout honors metadata.pluginRoot with a bare-name source", async () => {
  await withFixture(
    {
      marketplace: minimalMarketplace([{ name: "foo", source: "foo" }], {
        metadata: { pluginRoot: "./plugins" },
      }),
      plugins: [
        {
          slug: "foo",
          dir: "plugins/foo",
          manifest: { name: "foo", version: "1.0.0", description: "demo" },
        },
      ],
    },
    async (srcRoot) => {
      const result = await loadLayout(srcRoot);
      assert.equal(result.ok, true);
      if (!result.ok) return;
      const plugin = result.value.plugins[0];
      assert.ok(plugin);
      assert.equal(plugin.pluginDir, join(srcRoot, "plugins/foo"));
    },
  );
});

test("loadLayout resolves a self-plugin marketplace (source: './')", async () => {
  const srcRoot = mkdtempSync(join(tmpdir(), "harness-kit-layout-"));
  try {
    mkdirSync(join(srcRoot, ".claude-plugin"), { recursive: true });
    writeFileSync(
      join(srcRoot, ".claude-plugin/marketplace.json"),
      JSON.stringify(minimalMarketplace([{ name: "self", source: "./" }]), null, 2),
    );
    writeFileSync(
      join(srcRoot, ".claude-plugin/plugin.json"),
      JSON.stringify({ name: "self", version: "1.0.0", description: "demo" }),
    );

    const result = await loadLayout(srcRoot);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const plugin = result.value.plugins[0];
    assert.ok(plugin);
    assert.equal(plugin.name, "self");
    assert.equal(plugin.pluginDir, srcRoot);
    assert.equal(plugin.skillsDir, join(srcRoot, "skills"));
  } finally {
    rmSync(srcRoot, { recursive: true, force: true });
  }
});

test("loadLayout honors plugin.json commands/agents/hooks path overrides", async () => {
  await withFixture(
    {
      marketplace: minimalMarketplace([{ name: "foo", source: "./plugins/foo" }]),
      plugins: [
        {
          slug: "foo",
          dir: "plugins/foo",
          manifest: {
            name: "foo",
            version: "1.0.0",
            description: "demo",
            commands: "cmds",
            agents: "ai/agents",
            hooks: "wiring/hooks",
          },
        },
      ],
    },
    async (srcRoot) => {
      const result = await loadLayout(srcRoot);
      assert.equal(result.ok, true);
      if (!result.ok) return;
      const plugin = result.value.plugins[0];
      assert.ok(plugin);
      assert.equal(plugin.commandsDir, join(srcRoot, "plugins/foo/cmds"));
      assert.equal(plugin.agentsDir, join(srcRoot, "plugins/foo/ai/agents"));
      assert.equal(plugin.hooksDir, join(srcRoot, "plugins/foo/wiring/hooks"));
      assert.equal(plugin.skillsDir, join(srcRoot, "plugins/foo/skills"));
    },
  );
});

test("loadLayout errors when marketplace.json is missing", async () => {
  const srcRoot = mkdtempSync(join(tmpdir(), "harness-kit-layout-"));
  try {
    const result = await loadLayout(srcRoot);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.error.kind, "marketplace-missing");
  } finally {
    rmSync(srcRoot, { recursive: true, force: true });
  }
});

test("loadLayout errors when marketplace.json fails schema validation", async () => {
  const srcRoot = mkdtempSync(join(tmpdir(), "harness-kit-layout-"));
  try {
    mkdirSync(join(srcRoot, ".claude-plugin"), { recursive: true });
    writeFileSync(join(srcRoot, ".claude-plugin/marketplace.json"), JSON.stringify({ name: "x" }));
    const result = await loadLayout(srcRoot);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.error.kind, "marketplace-invalid");
  } finally {
    rmSync(srcRoot, { recursive: true, force: true });
  }
});

test("loadLayout errors when a relative-source plugin directory is missing", async () => {
  const srcRoot = mkdtempSync(join(tmpdir(), "harness-kit-layout-"));
  try {
    mkdirSync(join(srcRoot, ".claude-plugin"), { recursive: true });
    writeFileSync(
      join(srcRoot, ".claude-plugin/marketplace.json"),
      JSON.stringify(minimalMarketplace([{ name: "foo", source: "./plugins/foo" }])),
    );
    const result = await loadLayout(srcRoot);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.error.kind, "plugin-missing");
  } finally {
    rmSync(srcRoot, { recursive: true, force: true });
  }
});

test("loadLayout errors when both PLUGIN.ts and .claude-plugin/plugin.json exist", async () => {
  await withFixture(
    {
      marketplace: minimalMarketplace([{ name: "foo", source: "./plugins/foo" }]),
      plugins: [
        {
          slug: "foo",
          dir: "plugins/foo",
          manifest: { name: "foo", version: "1.0.0", description: "demo" },
          manifestFormat: "both",
        },
      ],
    },
    async (srcRoot) => {
      const result = await loadLayout(srcRoot);
      assert.equal(result.ok, false);
      if (result.ok) return;
      assert.equal(result.error.kind, "manifest-collision");
    },
  );
});

test("loadLayout errors when a plugin folder has no manifest", async () => {
  const srcRoot = mkdtempSync(join(tmpdir(), "harness-kit-layout-"));
  try {
    mkdirSync(join(srcRoot, ".claude-plugin"), { recursive: true });
    writeFileSync(
      join(srcRoot, ".claude-plugin/marketplace.json"),
      JSON.stringify(minimalMarketplace([{ name: "foo", source: "./plugins/foo" }])),
    );
    mkdirSync(join(srcRoot, "plugins/foo"), { recursive: true });
    const result = await loadLayout(srcRoot);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.error.kind, "manifest-missing");
  } finally {
    rmSync(srcRoot, { recursive: true, force: true });
  }
});

test("loadLayout errors when plugin.json name does not match the marketplace entry", async () => {
  await withFixture(
    {
      marketplace: minimalMarketplace([{ name: "foo", source: "./plugins/foo" }]),
      plugins: [
        {
          slug: "foo",
          dir: "plugins/foo",
          manifest: { name: "bar", version: "1.0.0", description: "demo" },
        },
      ],
    },
    async (srcRoot) => {
      const result = await loadLayout(srcRoot);
      assert.equal(result.ok, false);
      if (result.ok) return;
      assert.equal(result.error.kind, "plugin-name-mismatch");
    },
  );
});

test("loadLayout carries non-relative plugin sources as opaque entries", async () => {
  const srcRoot = mkdtempSync(join(tmpdir(), "harness-kit-layout-"));
  try {
    mkdirSync(join(srcRoot, ".claude-plugin"), { recursive: true });
    writeFileSync(
      join(srcRoot, ".claude-plugin/marketplace.json"),
      JSON.stringify(
        minimalMarketplace([{ name: "remote", source: { source: "github", repo: "owner/repo" } }]),
      ),
    );
    const result = await loadLayout(srcRoot);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.value.plugins.length, 0);
    assert.equal(result.value.opaquePlugins.length, 1);
    const opaque = result.value.opaquePlugins[0];
    assert.ok(opaque);
    assert.equal(opaque.name, "remote");
    assert.equal(opaque.source.kind, "github");
  } finally {
    rmSync(srcRoot, { recursive: true, force: true });
  }
});

test("loadLayout parses a plugin via PLUGIN.ts when no plugin.json exists", async () => {
  await withFixture(
    {
      marketplace: minimalMarketplace([{ name: "foo", source: "./plugins/foo" }]),
      plugins: [
        {
          slug: "foo",
          dir: "plugins/foo",
          manifest: { name: "foo", version: "1.0.0", description: "demo" },
          manifestFormat: "ts",
        },
      ],
    },
    async (srcRoot) => {
      const result = await loadLayout(srcRoot);
      assert.equal(result.ok, true);
      if (!result.ok) return;
      const plugin = result.value.plugins[0];
      assert.ok(plugin);
      assert.equal(plugin.name, "foo");
      assert.equal(plugin.manifest.version, "1.0.0");
    },
  );
});
