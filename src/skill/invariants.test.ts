import { test } from "node:test";
import { strict as assert } from "node:assert";

import { checkCompanionFiles } from "./invariants.js";

test("checkCompanionFiles flags declared companions missing on disk", () => {
  const errors = checkCompanionFiles([{ file: "ghost.md", summary: "x" }], []);
  assert.equal(errors.length, 1);
  assert.match(errors[0]!, /ghost\.md/);
  assert.match(errors[0]!, /not present in skill folder/);
});

test("checkCompanionFiles flags on-disk siblings not declared (orphans)", () => {
  const errors = checkCompanionFiles([{ file: "a.md", summary: "x" }], ["a.md", "stray.md"]);
  assert.equal(errors.length, 1);
  assert.match(errors[0]!, /stray\.md/);
  assert.match(errors[0]!, /not declared in companions/);
});

test("checkCompanionFiles returns empty when declared and on-disk lists match", () => {
  const errors = checkCompanionFiles(
    [
      { file: "a.md", summary: "x" },
      { file: "b.md", summary: "y" },
    ],
    ["a.md", "b.md"],
  );
  assert.equal(errors.length, 0);
});

test("checkCompanionFiles returns empty when both lists are empty", () => {
  const errors = checkCompanionFiles(undefined, []);
  assert.equal(errors.length, 0);
});
