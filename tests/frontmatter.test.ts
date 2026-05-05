import { test } from "node:test";
import { strict as assert } from "node:assert";

import { parseFrontmatter } from "../src/frontmatter.js";

test("parseFrontmatter parses scalar fields and exposes the body below", () => {
  const raw = `---
name: bar
description: A tiny test skill.
---

# Bar
body content
`;
  const result = parseFrontmatter(raw, "/fake/SKILL.md");
  assert.deepEqual(result.data, { name: "bar", description: "A tiny test skill." });
  assert.equal(result.body, "# Bar\nbody content\n");
});

test("parseFrontmatter exposes the byte offset of the body within the original source", () => {
  const raw = `---
name: bar
description: x
---

body line
`;
  const result = parseFrontmatter(raw, "/fake/SKILL.md");
  assert.equal(raw.slice(result.bodyOffset), result.body);
});

test("parseFrontmatter parses nested arrays of objects (companions)", () => {
  const raw = `---
name: bar
description: x
companions:
  - file: a.md
    summary: First
  - file: b.md
    summary: Second
---

body
`;
  const result = parseFrontmatter(raw, "/fake/SKILL.md") as {
    data: { companions: Array<{ file: string; summary: string }> };
    body: string;
    bodyOffset: number;
  };
  assert.deepEqual(result.data.companions, [
    { file: "a.md", summary: "First" },
    { file: "b.md", summary: "Second" },
  ]);
});

test("parseFrontmatter rejects a file that does not start with --- fence", () => {
  assert.throws(
    () => parseFrontmatter("# heading\nno frontmatter here\n", "/fake/SKILL.md"),
    /frontmatter/i,
  );
});

test("parseFrontmatter rejects a file with an opening fence but no closing fence", () => {
  assert.throws(
    () => parseFrontmatter("---\nname: bar\ndescription: x\n# rest\n", "/fake/SKILL.md"),
    /frontmatter/i,
  );
});

test("parseFrontmatter does not treat --- inside the body as a closing fence", () => {
  const raw = `---
name: bar
description: x
---

before

---

after
`;
  const result = parseFrontmatter(raw, "/fake/SKILL.md");
  assert.deepEqual(result.data, { name: "bar", description: "x" });
  assert.ok(result.body.includes("before"));
  assert.ok(result.body.includes("after"));
  assert.ok(result.body.includes("---"));
});

test("parseFrontmatter strips a leading UTF-8 BOM before parsing", () => {
  const raw = "﻿---\nname: bar\ndescription: x\n---\n\nbody\n";
  const result = parseFrontmatter(raw, "/fake/SKILL.md");
  assert.deepEqual(result.data, { name: "bar", description: "x" });
  assert.equal(result.body, "body\n");
});

test("parseFrontmatter handles empty body", () => {
  const raw = `---
name: bar
description: x
---
`;
  const result = parseFrontmatter(raw, "/fake/SKILL.md");
  assert.equal(result.body, "");
});

test("parseFrontmatter surfaces YAML parse errors with the source path", () => {
  const raw = `---
name: bar
description: [unclosed
---

body
`;
  assert.throws(
    () => parseFrontmatter(raw, "/fake/SKILL.md"),
    (err: Error) => err.message.includes("/fake/SKILL.md"),
  );
});
