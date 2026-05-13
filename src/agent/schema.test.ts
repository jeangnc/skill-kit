import { test } from "node:test";
import { strict as assert } from "node:assert";

import { AgentSchema, defineAgent } from "./schema.js";

test("AgentSchema accepts a minimal valid agent", () => {
  const result = AgentSchema.safeParse({ name: "code-reviewer", description: "Reviews PRs" });
  assert.equal(result.success, true);
});

test("AgentSchema rejects a non-kebab-case name", () => {
  const result = AgentSchema.safeParse({ name: "CodeReviewer", description: "x" });
  assert.equal(result.success, false);
});

test("AgentSchema rejects a multi-line description", () => {
  const result = AgentSchema.safeParse({
    name: "code-reviewer",
    description: "line one\nline two",
  });
  assert.equal(result.success, false);
});

test("AgentSchema rejects a description over 1024 chars", () => {
  const result = AgentSchema.safeParse({
    name: "code-reviewer",
    description: "x".repeat(1025),
  });
  assert.equal(result.success, false);
});

test("AgentSchema accepts tools as a string", () => {
  const result = AgentSchema.safeParse({
    name: "code-reviewer",
    description: "Reviews PRs",
    tools: "Bash, Read",
  });
  assert.equal(result.success, true);
});

test("AgentSchema accepts tools as an array", () => {
  const result = AgentSchema.safeParse({
    name: "code-reviewer",
    description: "Reviews PRs",
    tools: ["Bash", "Read"],
  });
  assert.equal(result.success, true);
});

test("AgentSchema accepts optional model", () => {
  const result = AgentSchema.safeParse({
    name: "code-reviewer",
    description: "Reviews PRs",
    model: "claude-opus-4-7",
  });
  assert.equal(result.success, true);
});

test("AgentSchema rejects unknown top-level fields", () => {
  const result = AgentSchema.safeParse({
    name: "code-reviewer",
    description: "Reviews PRs",
    subSkills: ["foo:bar"],
  });
  assert.equal(result.success, false);
});

test("defineAgent returns the parsed agent on valid input", () => {
  const a = defineAgent({ name: "code-reviewer", description: "x" });
  assert.equal(a.name, "code-reviewer");
});

test("defineAgent throws on invalid input", () => {
  assert.throws(() => defineAgent({ name: "Bad", description: "x" }));
});
