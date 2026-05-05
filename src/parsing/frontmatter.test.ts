import { test } from "node:test";
import { strict as assert } from "node:assert";

import { parseFrontmatter } from "./frontmatter.js";

test("parseFrontmatter parses scalar fields and exposes the body below", () => {
  const raw = `---
name: bar
description: A tiny test skill.
---

# Bar
body content
`;
  const result = parseFrontmatter(raw);
  if (!result.ok) assert.fail(`expected ok, got error: ${JSON.stringify(result.error)}`);
  assert.deepEqual(result.value.data, { name: "bar", description: "A tiny test skill." });
  assert.equal(result.value.body, "# Bar\nbody content\n");
});

test("parseFrontmatter exposes the byte offset of the body within the original source", () => {
  const raw = `---
name: bar
description: x
---

body line
`;
  const result = parseFrontmatter(raw);
  if (!result.ok) assert.fail(`expected ok, got error: ${JSON.stringify(result.error)}`);
  assert.equal(raw.slice(result.value.bodyOffset), result.value.body);
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
  const result = parseFrontmatter(raw);
  if (!result.ok) assert.fail(`expected ok, got error: ${JSON.stringify(result.error)}`);
  const data = result.value.data as {
    companions: Array<{ file: string; summary: string }>;
  };
  assert.deepEqual(data.companions, [
    { file: "a.md", summary: "First" },
    { file: "b.md", summary: "Second" },
  ]);
});

test("parseFrontmatter, when input is missing the opening fence, returns missing-fence error tagged 'open'", () => {
  const result = parseFrontmatter("# heading\nno frontmatter here\n");
  if (result.ok) assert.fail("expected error, got ok");
  assert.equal(result.error.tag, "missing-fence");
  if (result.error.tag !== "missing-fence") return;
  assert.equal(result.error.position, "open");
});

test("parseFrontmatter, when no closing fence is found, returns missing-fence error tagged 'close'", () => {
  const result = parseFrontmatter("---\nname: bar\ndescription: x\n# rest\n");
  if (result.ok) assert.fail("expected error, got ok");
  assert.equal(result.error.tag, "missing-fence");
  if (result.error.tag !== "missing-fence") return;
  assert.equal(result.error.position, "close");
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
  const result = parseFrontmatter(raw);
  if (!result.ok) assert.fail(`expected ok, got error: ${JSON.stringify(result.error)}`);
  assert.deepEqual(result.value.data, { name: "bar", description: "x" });
  assert.ok(result.value.body.includes("before"));
  assert.ok(result.value.body.includes("after"));
  assert.ok(result.value.body.includes("---"));
});

test("parseFrontmatter strips a leading UTF-8 BOM before parsing", () => {
  const raw = "﻿---\nname: bar\ndescription: x\n---\n\nbody\n";
  const result = parseFrontmatter(raw);
  if (!result.ok) assert.fail(`expected ok, got error: ${JSON.stringify(result.error)}`);
  assert.deepEqual(result.value.data, { name: "bar", description: "x" });
  assert.equal(result.value.body, "body\n");
});

test("parseFrontmatter handles empty body", () => {
  const raw = `---
name: bar
description: x
---
`;
  const result = parseFrontmatter(raw);
  if (!result.ok) assert.fail(`expected ok, got error: ${JSON.stringify(result.error)}`);
  assert.equal(result.value.body, "");
});

test("parseFrontmatter, when YAML is malformed, returns invalid-yaml error carrying the parser message", () => {
  const raw = `---
name: bar
description: [unclosed
---

body
`;
  const result = parseFrontmatter(raw);
  if (result.ok) assert.fail("expected error, got ok");
  assert.equal(result.error.tag, "invalid-yaml");
  if (result.error.tag !== "invalid-yaml") return;
  assert.ok(result.error.message.length > 0, "expected non-empty parser message");
});
