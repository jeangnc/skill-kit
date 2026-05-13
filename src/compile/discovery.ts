export function throwInvariantViolations(srcPath: string, errors: readonly string[]): never {
  throw new Error(`invariant violations in ${srcPath}:\n  - ${errors.join("\n  - ")}`);
}
