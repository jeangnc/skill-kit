import { test } from "node:test";
import { strict as assert } from "node:assert";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { validateReadme } from "./index.js";

interface ReadmeFixture {
  readonly filename?: string;
  readonly content: string;
  readonly siblings?: Readonly<Record<string, string>>;
}

async function withReadme<T>(
  fixture: ReadmeFixture,
  fn: (filePath: string, dir: string) => Promise<T>,
): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), "skill-kit-readme-"));
  const filePath = join(dir, fixture.filename ?? "README.md");
  writeFileSync(filePath, fixture.content);
  for (const [rel, content] of Object.entries(fixture.siblings ?? {})) {
    const target = join(dir, rel);
    mkdirSync(join(target, ".."), { recursive: true });
    writeFileSync(target, content);
  }
  return fn(filePath, dir).finally(() => rmSync(dir, { recursive: true, force: true }));
}

const emptyLocalIds = {
  skills: new Set<string>(),
  commands: new Set<string>(),
  agents: new Set<string>(),
};

test("validateReadme returns no violations when the sentinel is absent, even with broken refs", async () => {
  await withReadme(
    { content: "# Title\n\nsee {{skill:foo:ghost}} and [broken](./nope.md)\n" },
    async (filePath) => {
      const violations = await validateReadme({ filePath, localIds: emptyLocalIds });
      assert.deepEqual([...violations], []);
    },
  );
});

test("validateReadme returns no violations for a sentinel-bearing README with a valid {{skill:...}}", async () => {
  await withReadme(
    {
      content: "<!-- skill-kit:validate -->\nsee {{skill:foo:bar}} for details\n",
    },
    async (filePath) => {
      const violations = await validateReadme({
        filePath,
        localIds: {
          skills: new Set(["foo:bar"]),
          commands: new Set(),
          agents: new Set(),
        },
      });
      assert.deepEqual([...violations], []);
    },
  );
});

test("validateReadme reports an unknown {{skill:...}} id when the sentinel is present", async () => {
  await withReadme(
    {
      content: "<!-- skill-kit:validate -->\nsee {{skill:foo:ghost}}\n",
    },
    async (filePath) => {
      const violations = await validateReadme({ filePath, localIds: emptyLocalIds });
      assert.equal(violations.length, 1);
      assert.match(violations[0]!.message, /foo:ghost/);
      assert.equal(violations[0]!.kind, "placeholder");
    },
  );
});

test("validateReadme reports a malformed {{ext:...}} placeholder", async () => {
  await withReadme(
    {
      content: "<!-- skill-kit:validate -->\nsee {{ext:lonelyid}}\n",
    },
    async (filePath) => {
      const violations = await validateReadme({ filePath, localIds: emptyLocalIds });
      assert.equal(violations.length, 1);
      assert.equal(violations[0]!.kind, "placeholder");
      assert.match(violations[0]!.message, /<plugin>:<skill>/);
    },
  );
});

test("validateReadme accepts a relative markdown link to a file that exists", async () => {
  await withReadme(
    {
      content: "<!-- skill-kit:validate -->\nsee [docs](./docs.md) for more\n",
      siblings: { "docs.md": "# Docs\n" },
    },
    async (filePath) => {
      const violations = await validateReadme({ filePath, localIds: emptyLocalIds });
      assert.deepEqual([...violations], []);
    },
  );
});

test("validateReadme reports a broken relative markdown link", async () => {
  await withReadme(
    {
      content: "<!-- skill-kit:validate -->\nsee [docs](./ghost.md)\n",
    },
    async (filePath) => {
      const violations = await validateReadme({ filePath, localIds: emptyLocalIds });
      assert.equal(violations.length, 1);
      assert.equal(violations[0]!.kind, "link");
      assert.match(violations[0]!.message, /ghost\.md/);
    },
  );
});

test("validateReadme reports line:col into the README source", async () => {
  await withReadme(
    {
      content: "<!-- skill-kit:validate -->\n\nline three\nsee [broken](./ghost.md) here\n",
    },
    async (filePath) => {
      const violations = await validateReadme({ filePath, localIds: emptyLocalIds });
      assert.equal(violations.length, 1);
      assert.equal(violations[0]!.line, 4);
      assert.ok(violations[0]!.column > 1);
    },
  );
});

test("validateReadme ignores absolute URLs in markdown links", async () => {
  await withReadme(
    {
      content:
        "<!-- skill-kit:validate -->\nsee [site](https://example.com) and [mail](mailto:x@y.z)\n",
    },
    async (filePath) => {
      const violations = await validateReadme({ filePath, localIds: emptyLocalIds });
      assert.deepEqual([...violations], []);
    },
  );
});

test("validateReadme ignores in-page anchor links", async () => {
  await withReadme(
    {
      content: "<!-- skill-kit:validate -->\nsee [top](#title)\n",
    },
    async (filePath) => {
      const violations = await validateReadme({ filePath, localIds: emptyLocalIds });
      assert.deepEqual([...violations], []);
    },
  );
});

test("validateReadme strips a trailing #anchor before resolving a relative link", async () => {
  await withReadme(
    {
      content: "<!-- skill-kit:validate -->\nsee [docs](./docs.md#section)\n",
      siblings: { "docs.md": "# Docs\n" },
    },
    async (filePath) => {
      const violations = await validateReadme({ filePath, localIds: emptyLocalIds });
      assert.deepEqual([...violations], []);
    },
  );
});

test("validateReadme validates image links the same as text links", async () => {
  await withReadme(
    {
      content: "<!-- skill-kit:validate -->\n![logo](./missing.png)\n",
    },
    async (filePath) => {
      const violations = await validateReadme({ filePath, localIds: emptyLocalIds });
      assert.equal(violations.length, 1);
      assert.equal(violations[0]!.kind, "link");
    },
  );
});

test("validateReadme treats a cross-plugin {{skill:other:foo}} as a violation when owner has no dependencies", async () => {
  await withReadme(
    {
      content: "<!-- skill-kit:validate -->\nsee {{skill:other:foo}}\n",
    },
    async (filePath) => {
      const violations = await validateReadme({
        filePath,
        owner: { name: "self", dependencies: new Set() },
        localIds: {
          skills: new Set(["other:foo"]),
          commands: new Set(),
          agents: new Set(),
        },
      });
      assert.equal(violations.length, 1);
      assert.match(violations[0]!.message, /cross-plugin.*other.*dependencies/i);
    },
  );
});

test("validateReadme accepts a cross-plugin {{skill:other:foo}} when owner declares the dependency", async () => {
  await withReadme(
    {
      content: "<!-- skill-kit:validate -->\nsee {{skill:other:foo}}\n",
    },
    async (filePath) => {
      const violations = await validateReadme({
        filePath,
        owner: { name: "self", dependencies: new Set(["other"]) },
        localIds: {
          skills: new Set(["other:foo"]),
          commands: new Set(),
          agents: new Set(),
        },
      });
      assert.deepEqual([...violations], []);
    },
  );
});
