import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type CommandRunner = (cmd: string, args: readonly string[]) => Promise<void>;

export const defaultRunner: CommandRunner = async (cmd, args) => {
  await execFileAsync(cmd, [...args]);
};

export async function runIgnoreFailure(
  run: CommandRunner,
  cmd: string,
  args: readonly string[],
): Promise<void> {
  try {
    await run(cmd, args);
  } catch {
    /* ignore */
  }
}
