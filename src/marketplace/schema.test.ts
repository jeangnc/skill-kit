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

test("MarketplaceSchema rejects unknown top-level fields", () => {
  const result = MarketplaceSchema.safeParse({
    name: "my-marketplace",
    owner: { name: "Jean" },
    plugins: [{ name: "foo", source: "./plugins/foo" }],
    extra: true,
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

test("PluginEntrySchema rejects unknown top-level fields", () => {
  const result = PluginEntrySchema.safeParse({
    name: "foo",
    source: "./plugins/foo",
    extra: true,
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
