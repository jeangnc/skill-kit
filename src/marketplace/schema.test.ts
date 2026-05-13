import { test } from "node:test";
import { strict as assert } from "node:assert";

import { MarketplaceSchema, PluginEntrySchema, defineMarketplace } from "./schema.js";

test("MarketplaceSchema accepts a minimal manifest", () => {
  const result = MarketplaceSchema.safeParse({
    name: "my-marketplace",
    owner: { name: "Jean" },
    plugins: [{ name: "foo", source: "./plugins/foo" }],
  });
  assert.equal(result.success, true);
});

test("MarketplaceSchema accepts metadata.pluginRoot and version", () => {
  const result = MarketplaceSchema.safeParse({
    name: "my-marketplace",
    owner: { name: "Jean", email: "jean@example.com" },
    metadata: { pluginRoot: "./plugins", version: "0.0.1" },
    plugins: [{ name: "foo", source: "./plugins/foo" }],
  });
  assert.equal(result.success, true);
});

test("MarketplaceSchema rejects non-kebab-case name", () => {
  const result = MarketplaceSchema.safeParse({
    name: "MyMarketplace",
    owner: { name: "Jean" },
    plugins: [{ name: "foo", source: "./plugins/foo" }],
  });
  assert.equal(result.success, false);
});

test("MarketplaceSchema rejects duplicate plugin names", () => {
  const result = MarketplaceSchema.safeParse({
    name: "m",
    owner: { name: "Jean" },
    plugins: [
      { name: "foo", source: "./plugins/foo" },
      { name: "foo", source: "./plugins/foo-2" },
    ],
  });
  assert.equal(result.success, false);
  if (!result.success) {
    assert.match(result.error.issues.map((i) => i.message).join(" | "), /unique|duplicate/i);
  }
});

test("PluginEntrySchema accepts a relative-path source", () => {
  const result = PluginEntrySchema.safeParse({ name: "foo", source: "./plugins/foo" });
  assert.equal(result.success, true);
  if (result.success) assert.equal(result.data.source.kind, "relative");
});

test("PluginEntrySchema accepts a bare relative-path source (relies on pluginRoot)", () => {
  const result = PluginEntrySchema.safeParse({ name: "foo", source: "foo" });
  assert.equal(result.success, true);
  if (result.success) assert.equal(result.data.source.kind, "relative");
});

test("PluginEntrySchema accepts a github source object", () => {
  const result = PluginEntrySchema.safeParse({
    name: "foo",
    source: { source: "github", repo: "owner/repo", ref: "main" },
  });
  assert.equal(result.success, true);
  if (result.success) assert.equal(result.data.source.kind, "github");
});

test("PluginEntrySchema accepts a url source object", () => {
  const result = PluginEntrySchema.safeParse({
    name: "foo",
    source: { source: "url", url: "https://example.com/plugin.tgz" },
  });
  assert.equal(result.success, true);
  if (result.success) assert.equal(result.data.source.kind, "url");
});

test("PluginEntrySchema accepts a git-subdir source object", () => {
  const result = PluginEntrySchema.safeParse({
    name: "foo",
    source: { source: "git-subdir", url: "https://example.com/r.git", path: "plugins/foo" },
  });
  assert.equal(result.success, true);
  if (result.success) assert.equal(result.data.source.kind, "git-subdir");
});

test("PluginEntrySchema accepts an npm source object", () => {
  const result = PluginEntrySchema.safeParse({
    name: "foo",
    source: { source: "npm", package: "@scope/pkg" },
  });
  assert.equal(result.success, true);
  if (result.success) assert.equal(result.data.source.kind, "npm");
});

test("PluginEntrySchema rejects an unknown source discriminator", () => {
  const result = PluginEntrySchema.safeParse({
    name: "foo",
    source: { source: "ftp", url: "ftp://example.com" },
  });
  assert.equal(result.success, false);
});

test("defineMarketplace returns the parsed manifest on valid input", () => {
  const m = defineMarketplace({
    name: "shop",
    owner: { name: "Jean" },
    plugins: [{ name: "foo", source: "./plugins/foo" }],
  });
  assert.equal(m.name, "shop");
  assert.equal(m.plugins[0]?.name, "foo");
});

test("defineMarketplace throws on invalid input", () => {
  assert.throws(() =>
    defineMarketplace({
      name: "Bad",
      owner: { name: "Jean" },
      plugins: [{ name: "foo", source: "./plugins/foo" }],
    }),
  );
});

test("MarketplaceSchema accepts upstream Claude marketplace fields", () => {
  const result = MarketplaceSchema.safeParse({
    name: "gq-marketplace",
    owner: {
      name: "Great Question",
      email: "eng@greatquestion.co",
      url: "https://github.com/GreatQuestion",
    },
    homepage: "https://github.com/GreatQuestion/claude-marketplace",
    repository: "https://github.com/GreatQuestion/claude-marketplace",
    allowCrossMarketplaceDependenciesOn: ["claude-plugins-official"],
    plugins: [{ name: "foo", source: "./plugins/foo" }],
  });
  assert.equal(result.success, true);
});

test("PluginEntrySchema accepts upstream description field", () => {
  const result = PluginEntrySchema.safeParse({
    name: "gq-core",
    source: "./gq-core",
    description: "Shared MCP servers and session context",
  });
  assert.equal(result.success, true);
});

test("MarketplaceSchema preserves upstream passthrough fields on parse", () => {
  const result = MarketplaceSchema.safeParse({
    name: "gq-marketplace",
    owner: { name: "GQ", url: "https://github.com/GQ" },
    homepage: "https://example.com",
    plugins: [{ name: "foo", source: "./plugins/foo", description: "first" }],
  });
  assert.equal(result.success, true);
  if (!result.success) return;
  assert.equal((result.data as { homepage?: string }).homepage, "https://example.com");
  assert.equal((result.data.owner as { url?: string }).url, "https://github.com/GQ");
  assert.equal((result.data.plugins[0] as { description?: string }).description, "first");
});
