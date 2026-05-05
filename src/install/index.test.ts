import { test } from "node:test";
import { strict as assert } from "node:assert";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { installWithRunner, uninstallWithRunner, type InstallOptions } from "./index.js";

type CommandRunner = (cmd: string, args: readonly string[]) => Promise<void>;
type OldOpts = InstallOptions & { readonly runCommand: CommandRunner };
const install = async ({ runCommand, ...opts }: OldOpts): Promise<void> =>
  installWithRunner(opts, runCommand);
const uninstall = async ({ runCommand, ...opts }: OldOpts): Promise<void> =>
  uninstallWithRunner(opts, runCommand);

interface CommandCall {
  readonly cmd: string;
  readonly args: readonly string[];
}

function recordingRunner(): {
  readonly run: (cmd: string, args: readonly string[]) => Promise<void>;
  readonly calls: CommandCall[];
} {
  const calls: CommandCall[] = [];
  return {
    calls,
    run: async (cmd, args) => {
      calls.push({ cmd, args });
    },
  };
}

interface FixtureOptions {
  readonly marketplaceName: string;
  readonly plugins: ReadonlyArray<{
    readonly name: string;
    readonly claudeManifest?: { readonly version: string };
    readonly codexManifest?: { readonly version: string };
    readonly extraFiles?: Readonly<Record<string, string>>;
  }>;
}

async function withInstallFixture<T>(
  options: FixtureOptions,
  fn: (paths: {
    readonly distRoot: string;
    readonly claudeHome: string;
    readonly codexHome: string;
  }) => Promise<T>,
): Promise<T> {
  const sandbox = mkdtempSync(join(tmpdir(), "skill-kit-install-"));
  const distRoot = join(sandbox, "dist");
  const claudeHome = join(sandbox, "claude");
  const codexHome = join(sandbox, "codex");
  mkdirSync(join(distRoot, ".claude-plugin"), { recursive: true });
  writeFileSync(
    join(distRoot, ".claude-plugin/marketplace.json"),
    JSON.stringify({ name: options.marketplaceName }),
  );
  for (const plugin of options.plugins) {
    const pluginPath = join(distRoot, "plugins", plugin.name);
    mkdirSync(pluginPath, { recursive: true });
    if (plugin.claudeManifest) {
      mkdirSync(join(pluginPath, ".claude-plugin"), { recursive: true });
      writeFileSync(
        join(pluginPath, ".claude-plugin/plugin.json"),
        JSON.stringify({ name: plugin.name, version: plugin.claudeManifest.version }),
      );
    }
    if (plugin.codexManifest) {
      mkdirSync(join(pluginPath, ".codex-plugin"), { recursive: true });
      writeFileSync(
        join(pluginPath, ".codex-plugin/plugin.json"),
        JSON.stringify({ name: plugin.name, version: plugin.codexManifest.version }),
      );
    }
    for (const [name, content] of Object.entries(plugin.extraFiles ?? {})) {
      writeFileSync(join(pluginPath, name), content);
    }
  }
  return fn({ distRoot, claudeHome, codexHome }).finally(() =>
    rmSync(sandbox, { recursive: true, force: true }),
  );
}

test("install copies codex plugins into <codexHome>/plugins/cache/<marketplace>/<plugin>/<version>/", async () => {
  await withInstallFixture(
    {
      marketplaceName: "test-marketplace",
      plugins: [
        {
          name: "alpha",
          codexManifest: { version: "1.2.3" },
          extraFiles: { "AGENTS.md": "alpha agents\n" },
        },
      ],
    },
    async ({ distRoot, claudeHome, codexHome }) => {
      const recorder = recordingRunner();
      await install({
        distRoot,
        claudeHome,
        codexHome,
        targets: ["codex"],
        silent: true,
        runCommand: recorder.run,
      });
      const dest = join(codexHome, "plugins/cache/test-marketplace/alpha/1.2.3");
      assert.ok(existsSync(dest), `expected cached plugin at ${dest}`);
      assert.equal(readFileSync(join(dest, "AGENTS.md"), "utf8"), "alpha agents\n");
    },
  );
});

test("install registers the codex marketplace pointing at distRoot", async () => {
  await withInstallFixture(
    {
      marketplaceName: "test-marketplace",
      plugins: [{ name: "alpha", codexManifest: { version: "1.0.0" } }],
    },
    async ({ distRoot, claudeHome, codexHome }) => {
      const recorder = recordingRunner();
      await install({
        distRoot,
        claudeHome,
        codexHome,
        targets: ["codex"],
        silent: true,
        runCommand: recorder.run,
      });
      const marketplaceAdd = recorder.calls.find(
        (c) => c.cmd === "codex" && c.args[0] === "plugin" && c.args[1] === "marketplace",
      );
      assert.ok(marketplaceAdd, "expected `codex plugin marketplace add` call");
      assert.deepEqual([...marketplaceAdd.args], ["plugin", "marketplace", "add", distRoot]);
    },
  );
});

test("install skips plugins without a codex manifest when target is codex", async () => {
  await withInstallFixture(
    {
      marketplaceName: "test-marketplace",
      plugins: [
        { name: "alpha", claudeManifest: { version: "1.0.0" } },
        { name: "beta", codexManifest: { version: "2.0.0" } },
      ],
    },
    async ({ distRoot, claudeHome, codexHome }) => {
      const recorder = recordingRunner();
      await install({
        distRoot,
        claudeHome,
        codexHome,
        targets: ["codex"],
        silent: true,
        runCommand: recorder.run,
      });
      assert.ok(!existsSync(join(codexHome, "plugins/cache/test-marketplace/alpha")));
      assert.ok(existsSync(join(codexHome, "plugins/cache/test-marketplace/beta/2.0.0")));
    },
  );
});

test("install runs `claude plugin install` for each plugin with a claude manifest", async () => {
  await withInstallFixture(
    {
      marketplaceName: "shop",
      plugins: [
        { name: "alpha", claudeManifest: { version: "1.0.0" } },
        { name: "beta", claudeManifest: { version: "2.0.0" } },
        { name: "gamma", codexManifest: { version: "3.0.0" } },
      ],
    },
    async ({ distRoot, claudeHome, codexHome }) => {
      const recorder = recordingRunner();
      await install({
        distRoot,
        claudeHome,
        codexHome,
        targets: ["claude"],
        silent: true,
        runCommand: recorder.run,
      });
      const installCalls = recorder.calls.filter(
        (c) => c.cmd === "claude" && c.args[0] === "plugin" && c.args[1] === "install",
      );
      const installed = installCalls.map((c) => c.args[2]);
      assert.deepEqual(installed.sort(), ["alpha@shop", "beta@shop"]);
    },
  );
});

test("install force-refreshes claude plugin caches before installing", async () => {
  await withInstallFixture(
    {
      marketplaceName: "shop",
      plugins: [{ name: "alpha", claudeManifest: { version: "1.0.0" } }],
    },
    async ({ distRoot, claudeHome, codexHome }) => {
      const stalePath = join(claudeHome, "plugins/cache/shop/alpha");
      mkdirSync(stalePath, { recursive: true });
      writeFileSync(join(stalePath, "stale.txt"), "stale\n");
      const recorder = recordingRunner();
      await install({
        distRoot,
        claudeHome,
        codexHome,
        targets: ["claude"],
        silent: true,
        runCommand: recorder.run,
      });
      assert.ok(!existsSync(stalePath), "stale claude cache should be removed");
      const uninstalls = recorder.calls.filter(
        (c) => c.cmd === "claude" && c.args[0] === "plugin" && c.args[1] === "uninstall",
      );
      assert.equal(uninstalls.length, 1);
      assert.equal(uninstalls[0]!.args[2], "alpha@shop");
    },
  );
});

test("install does both targets by default", async () => {
  await withInstallFixture(
    {
      marketplaceName: "shop",
      plugins: [
        {
          name: "alpha",
          claudeManifest: { version: "1.0.0" },
          codexManifest: { version: "1.0.0" },
        },
      ],
    },
    async ({ distRoot, claudeHome, codexHome }) => {
      const recorder = recordingRunner();
      await install({ distRoot, claudeHome, codexHome, silent: true, runCommand: recorder.run });
      assert.ok(
        existsSync(join(codexHome, "plugins/cache/shop/alpha/1.0.0")),
        "codex install should have happened",
      );
      const claudeInstall = recorder.calls.find(
        (c) => c.cmd === "claude" && c.args[0] === "plugin" && c.args[1] === "install",
      );
      assert.ok(claudeInstall, "claude install should have happened");
    },
  );
});

test("uninstall removes claude plugins and the marketplace registration", async () => {
  await withInstallFixture(
    {
      marketplaceName: "shop",
      plugins: [{ name: "alpha", claudeManifest: { version: "1.0.0" } }],
    },
    async ({ distRoot, claudeHome, codexHome }) => {
      const recorder = recordingRunner();
      await uninstall({
        distRoot,
        claudeHome,
        codexHome,
        targets: ["claude"],
        silent: true,
        runCommand: recorder.run,
      });
      const uninstallCall = recorder.calls.find(
        (c) =>
          c.cmd === "claude" &&
          c.args[0] === "plugin" &&
          c.args[1] === "uninstall" &&
          c.args[2] === "alpha@shop",
      );
      assert.ok(uninstallCall, "expected per-plugin uninstall");
      const marketplaceRemove = recorder.calls.find(
        (c) =>
          c.cmd === "claude" &&
          c.args[0] === "plugin" &&
          c.args[1] === "marketplace" &&
          c.args[2] === "remove",
      );
      assert.ok(marketplaceRemove, "expected marketplace removal");
    },
  );
});

test("uninstall removes the codex marketplace cache and registration", async () => {
  await withInstallFixture(
    {
      marketplaceName: "shop",
      plugins: [{ name: "alpha", codexManifest: { version: "1.0.0" } }],
    },
    async ({ distRoot, claudeHome, codexHome }) => {
      const cachePath = join(codexHome, "plugins/cache/shop/alpha/1.0.0");
      mkdirSync(cachePath, { recursive: true });
      writeFileSync(join(cachePath, "marker.txt"), "x\n");
      const recorder = recordingRunner();
      await uninstall({
        distRoot,
        claudeHome,
        codexHome,
        targets: ["codex"],
        silent: true,
        runCommand: recorder.run,
      });
      assert.ok(!existsSync(cachePath), "codex cache should be removed");
      const marketplaceRemove = recorder.calls.find(
        (c) =>
          c.cmd === "codex" &&
          c.args[0] === "plugin" &&
          c.args[1] === "marketplace" &&
          c.args[2] === "remove",
      );
      assert.ok(marketplaceRemove, "expected codex marketplace removal");
    },
  );
});

test("install rejects a marketplace.json missing the required `name` field", async () => {
  const sandbox = mkdtempSync(join(tmpdir(), "skill-kit-install-"));
  const distRoot = join(sandbox, "dist");
  const claudeHome = join(sandbox, "claude");
  const codexHome = join(sandbox, "codex");
  mkdirSync(join(distRoot, ".claude-plugin"), { recursive: true });
  writeFileSync(join(distRoot, ".claude-plugin/marketplace.json"), JSON.stringify({}));
  mkdirSync(join(distRoot, "plugins"), { recursive: true });
  try {
    const recorder = recordingRunner();
    await assert.rejects(
      install({ distRoot, claudeHome, codexHome, silent: true, runCommand: recorder.run }),
      /name/i,
    );
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
});

test("install rejects a plugin.json missing the required `version` field", async () => {
  const sandbox = mkdtempSync(join(tmpdir(), "skill-kit-install-"));
  const distRoot = join(sandbox, "dist");
  const claudeHome = join(sandbox, "claude");
  const codexHome = join(sandbox, "codex");
  mkdirSync(join(distRoot, ".claude-plugin"), { recursive: true });
  writeFileSync(
    join(distRoot, ".claude-plugin/marketplace.json"),
    JSON.stringify({ name: "shop" }),
  );
  const pluginPath = join(distRoot, "plugins/alpha");
  mkdirSync(join(pluginPath, ".codex-plugin"), { recursive: true });
  writeFileSync(join(pluginPath, ".codex-plugin/plugin.json"), JSON.stringify({ name: "alpha" }));
  try {
    const recorder = recordingRunner();
    await assert.rejects(
      install({
        distRoot,
        claudeHome,
        codexHome,
        targets: ["codex"],
        silent: true,
        runCommand: recorder.run,
      }),
      /version/i,
    );
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
});

test("install ignores plugin folders without any plugin manifest", async () => {
  await withInstallFixture(
    {
      marketplaceName: "shop",
      plugins: [{ name: "rogue" }],
    },
    async ({ distRoot, claudeHome, codexHome }) => {
      const recorder = recordingRunner();
      await install({ distRoot, claudeHome, codexHome, silent: true, runCommand: recorder.run });
      const installCalls = recorder.calls.filter(
        (c) => c.cmd === "claude" && c.args[0] === "plugin" && c.args[1] === "install",
      );
      assert.equal(installCalls.length, 0);
      assert.ok(!existsSync(join(codexHome, "plugins/cache/shop/rogue")));
    },
  );
});
