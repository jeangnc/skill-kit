import type { Companion } from "./schema.js";

export function checkCompanionFiles(
  companions: readonly Companion[] | undefined,
  siblings: readonly string[],
): string[] {
  const declared = new Set((companions ?? []).map((c) => c.file));
  const onDisk = new Set(siblings);
  const errors: string[] = [];
  for (const c of companions ?? []) {
    if (!onDisk.has(c.file)) {
      errors.push(`companion "${c.file}" declared but not present in skill folder`);
    }
  }
  for (const file of siblings) {
    if (!declared.has(file)) {
      errors.push(`companion "${file}" exists in folder but is not declared in companions`);
    }
  }
  return errors;
}
