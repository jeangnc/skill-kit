import { stat } from "node:fs/promises";

export async function pathExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

export function throwInvariantViolations(srcPath: string, errors: readonly string[]): never {
  throw new Error(`invariant violations in ${srcPath}:\n  - ${errors.join("\n  - ")}`);
}
