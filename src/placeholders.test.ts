import { test } from "node:test";
import { strict as assert } from "node:assert";

import { parsePlaceholders, substitute, type ValidatorRegistry } from "./placeholders.js";

test("parsePlaceholders extracts a single prefixed placeholder", () => {
  const tokens = parsePlaceholders("see {{skill:dev-tools:ruby}} for more");
  assert.equal(tokens.length, 1);
  assert.equal(tokens[0]!.prefix, "skill");
  assert.equal(tokens[0]!.value, "dev-tools:ruby");
  assert.equal(tokens[0]!.raw, "{{skill:dev-tools:ruby}}");
});

test("parsePlaceholders extracts a bare placeholder (no value)", () => {
  const tokens = parsePlaceholders("body\n\n{{companions}}\n\nmore");
  assert.equal(tokens.length, 1);
  assert.equal(tokens[0]!.prefix, "companions");
  assert.equal(tokens[0]!.value, null);
});

test("parsePlaceholders extracts multiple placeholders in order", () => {
  const tokens = parsePlaceholders("a {{skill:foo:bar}} b {{companion:x.md}} c {{companions}}");
  assert.deepEqual(
    tokens.map((t) => ({ prefix: t.prefix, value: t.value })),
    [
      { prefix: "skill", value: "foo:bar" },
      { prefix: "companion", value: "x.md" },
      { prefix: "companions", value: null },
    ],
  );
});

test("parsePlaceholders ignores non-placeholder braces", () => {
  const tokens = parsePlaceholders("nothing here {single} or {{ malformed");
  assert.equal(tokens.length, 0);
});

test("parsePlaceholders returns positions that bracket the raw token", () => {
  const body = "x {{skill:foo:bar}} y";
  const tokens = parsePlaceholders(body);
  assert.equal(tokens.length, 1);
  assert.equal(body.slice(tokens[0]!.start, tokens[0]!.end), "{{skill:foo:bar}}");
});

const okRegistry: ValidatorRegistry = {
  skill: (value) => ({ ok: true, rendered: `\`${value}\`` }),
  companions: () => ({ ok: true, rendered: "## Companion files\n\n- a.md" }),
};

test("substitute replaces placeholders with validator output", () => {
  const result = substitute("see {{skill:dev-tools:ruby}}", okRegistry);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.rendered, "see `dev-tools:ruby`");
  }
});

test("substitute handles bare placeholder", () => {
  const result = substitute("a\n{{companions}}\nb", okRegistry);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.rendered, "a\n## Companion files\n\n- a.md\nb");
  }
});

test("substitute returns errors for unknown prefix", () => {
  const result = substitute("{{nope:foo}}", okRegistry);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.errors.length, 1);
    assert.match(result.errors[0]!, /unknown placeholder prefix "nope"/);
    assert.match(result.errors[0]!, /companions, skill/);
  }
});

test("substitute aggregates multiple errors", () => {
  const registry: ValidatorRegistry = {
    skill: (value) =>
      value === "good:one"
        ? { ok: true, rendered: "ok" }
        : { ok: false, error: `unknown skill "${value}"` },
  };
  const result = substitute("{{skill:bad:one}} and {{skill:bad:two}}", registry);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.errors.length, 2);
    assert.match(result.errors[0]!, /bad:one/);
    assert.match(result.errors[1]!, /bad:two/);
  }
});

test("substitute reports validator errors with placeholder context", () => {
  const registry: ValidatorRegistry = {
    skill: () => ({ ok: false, error: "boom" }),
  };
  const result = substitute("see {{skill:foo:bar}}", registry);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.errors[0]!, /\{\{skill:foo:bar\}\}/);
    assert.match(result.errors[0]!, /boom/);
  }
});

test("substitute leaves body unchanged when no placeholders", () => {
  const result = substitute("plain markdown with no tokens", okRegistry);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.rendered, "plain markdown with no tokens");
  }
});

test("substitute calls bare-placeholder validator with null value", () => {
  let receivedValue: string | null = "untouched";
  const registry: ValidatorRegistry = {
    companions: (value) => {
      receivedValue = value;
      return { ok: true, rendered: "X" };
    },
  };
  const result = substitute("{{companions}}", registry);
  assert.equal(result.ok, true);
  assert.equal(receivedValue, null);
});
