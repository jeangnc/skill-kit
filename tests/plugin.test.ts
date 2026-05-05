import { test } from "node:test";
import { strict as assert } from "node:assert";

import { PluginSchema, ContextEntrySchema, definePlugin } from "../src/plugin.js";

test("PluginSchema rejects non-kebab-case name", () => {
  const result = PluginSchema.safeParse({
    name: "Foo",
    version: "1.0.0",
    description: "demo",
  });
  assert.equal(result.success, false);
});

test("PluginSchema accepts a minimal valid plugin", () => {
  const result = PluginSchema.safeParse({
    name: "foo",
    version: "1.0.0",
    description: "demo",
  });
  assert.equal(result.success, true);
});

test("PluginSchema rejects multi-line description", () => {
  const result = PluginSchema.safeParse({
    name: "foo",
    version: "1.0.0",
    description: "line one\nline two",
  });
  assert.equal(result.success, false);
});

test("PluginSchema rejects description over 1024 chars", () => {
  const result = PluginSchema.safeParse({
    name: "foo",
    version: "1.0.0",
    description: "x".repeat(1025),
  });
  assert.equal(result.success, false);
});

test("PluginSchema accepts a plugin with all optional metadata", () => {
  const result = PluginSchema.safeParse({
    name: "foo",
    version: "1.0.0",
    description: "demo",
    author: { name: "A", email: "a@b.c", url: "https://example.com" },
    homepage: "https://example.com",
    repository: "https://example.com/repo",
    license: "MIT",
    keywords: ["claude", "plugin"],
    dependencies: ["bar"],
  });
  assert.equal(result.success, true);
});

test("ContextEntrySchema rejects file that is not a .md path", () => {
  const result = ContextEntrySchema.safeParse({
    file: "context/foo.txt",
    summary: "ok",
  });
  assert.equal(result.success, false);
});

test("ContextEntrySchema rejects multi-line summary", () => {
  const result = ContextEntrySchema.safeParse({
    file: "context/foo.md",
    summary: "line one\nline two",
  });
  assert.equal(result.success, false);
});

test("PluginSchema accepts context entries", () => {
  const result = PluginSchema.safeParse({
    name: "foo",
    version: "1.0.0",
    description: "demo",
    context: [{ file: "context/instructions.md", summary: "Always-on" }],
  });
  assert.equal(result.success, true);
});

test("PluginSchema rejects duplicate file path within context", () => {
  const result = PluginSchema.safeParse({
    name: "foo",
    version: "1.0.0",
    description: "demo",
    context: [
      { file: "context/x.md", summary: "first" },
      { file: "context/x.md", summary: "second" },
    ],
  });
  assert.equal(result.success, false);
});

test("definePlugin returns the parsed plugin on valid input", () => {
  const plugin = definePlugin({
    name: "foo",
    version: "1.0.0",
    description: "demo",
  });
  assert.equal(plugin.name, "foo");
  assert.equal(plugin.version, "1.0.0");
});

test("definePlugin throws on invalid input", () => {
  assert.throws(() =>
    definePlugin({
      name: "Bad",
      version: "1.0.0",
      description: "demo",
    }),
  );
});
