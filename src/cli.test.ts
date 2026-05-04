import { test } from "node:test";
import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const cliPath = fileURLToPath(new URL("./cli.ts", import.meta.url));

function runCli(args: readonly string[]): {
  status: number | null;
  stdout: string;
  stderr: string;
} {
  const result = spawnSync("npx", ["tsx", cliPath, ...args], { encoding: "utf8" });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

test("cli build --help exits 0 and mentions --src", () => {
  const { status, stdout } = runCli(["build", "--help"]);
  assert.equal(status, 0);
  assert.match(stdout, /--src/);
});

test("cli install --help exits 0 and mentions --targets", () => {
  const { status, stdout } = runCli(["install", "--help"]);
  assert.equal(status, 0);
  assert.match(stdout, /--targets/);
});

test("cli uninstall --help exits 0 and mentions --dist", () => {
  const { status, stdout } = runCli(["uninstall", "--help"]);
  assert.equal(status, 0);
  assert.match(stdout, /--dist/);
});

test("cli with unknown subcommand exits non-zero", () => {
  const { status } = runCli(["nonsense-subcommand"]);
  assert.notEqual(status, 0);
});
