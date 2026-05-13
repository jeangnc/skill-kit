import { test } from "node:test";
import { strict as assert } from "node:assert";

import { CommandSchema, defineCommand } from "./schema.js";

test("CommandSchema accepts a minimal valid command", () => {
  const result = CommandSchema.safeParse({ name: "open-pr", description: "Opens a PR" });
  assert.equal(result.success, true);
});

test("CommandSchema rejects a non-kebab-case name", () => {
  const result = CommandSchema.safeParse({ name: "OpenPR", description: "Opens a PR" });
  assert.equal(result.success, false);
});

test("CommandSchema rejects a multi-line description", () => {
  const result = CommandSchema.safeParse({
    name: "open-pr",
    description: "line one\nline two",
  });
  assert.equal(result.success, false);
});

test("CommandSchema rejects a description over 1024 chars", () => {
  const result = CommandSchema.safeParse({
    name: "open-pr",
    description: "x".repeat(1025),
  });
  assert.equal(result.success, false);
});

test("CommandSchema accepts optional argument-hint, allowed-tools, model", () => {
  const result = CommandSchema.safeParse({
    name: "open-pr",
    description: "Opens a PR",
    "argument-hint": "[branch]",
    "allowed-tools": ["Bash", "Read"],
    model: "claude-opus-4-7",
  });
  assert.equal(result.success, true);
});

test("CommandSchema rejects unknown top-level fields", () => {
  const result = CommandSchema.safeParse({
    name: "open-pr",
    description: "Opens a PR",
    bogus: true,
  });
  assert.equal(result.success, false);
});

test("CommandSchema accepts allowed-tools as a single string", () => {
  const result = CommandSchema.safeParse({
    name: "open-pr",
    description: "Opens a PR",
    "allowed-tools": "Bash(*)",
  });
  assert.equal(result.success, true);
});

test("defineCommand returns the parsed command on valid input", () => {
  const cmd = defineCommand({ name: "open-pr", description: "Opens a PR" });
  assert.equal(cmd.name, "open-pr");
});

test("defineCommand throws on invalid input", () => {
  assert.throws(() => defineCommand({ name: "Bad", description: "x" }));
});
