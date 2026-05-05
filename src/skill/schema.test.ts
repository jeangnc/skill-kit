import { test } from "node:test";
import { strict as assert } from "node:assert";

import { SkillSchema, CompanionSchema } from "./schema.js";

test("SkillSchema rejects duplicate companion files", () => {
  const result = SkillSchema.safeParse({
    name: "bar",
    description: "duplicate-companions test",
    companions: [
      { file: "a.md", summary: "first" },
      { file: "a.md", summary: "second" },
    ],
  });
  assert.equal(result.success, false);
  if (!result.success) {
    assert.match(result.error.issues.map((i) => i.message).join(" | "), /unique|duplicate/i);
  }
});

test("SkillSchema accepts a single companion file", () => {
  const result = SkillSchema.safeParse({
    name: "bar",
    description: "single-companion test",
    companions: [{ file: "a.md", summary: "only" }],
  });
  assert.equal(result.success, true);
});

test("CompanionSchema rejects body.md as a companion filename", () => {
  const result = CompanionSchema.safeParse({ file: "body.md", summary: "nope" });
  assert.equal(result.success, false);
});

test("CompanionSchema rejects SKILL.md as a companion filename", () => {
  const result = CompanionSchema.safeParse({ file: "SKILL.md", summary: "nope" });
  assert.equal(result.success, false);
});
