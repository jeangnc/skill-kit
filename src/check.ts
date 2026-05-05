import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";

import { offsetToLineCol, parsePlaceholders } from "./placeholders/index.js";
import { findSkillFile, formatLoadSkillError, loadSkill } from "./skill/index.js";
import {
  defaultSources,
  discoverInstalledSkills,
  indexSkills,
  type InstalledSkill,
  type PluginSource,
} from "./installed.js";

export interface CheckOptions {
  readonly srcRoot: string;
  readonly sources?: readonly PluginSource[];
}

export type ExtViolationKind = "malformed" | "unresolved";

export interface ExtViolation {
  readonly kind: ExtViolationKind;
  readonly token: string;
  readonly file: string;
  readonly line: number;
  readonly column: number;
  readonly message: string;
}

export interface SourceSummary {
  readonly source: string;
  readonly skillCount: number;
}

export interface CheckResult {
  readonly violations: readonly ExtViolation[];
  readonly checkedFiles: number;
  readonly indexedSources: readonly SourceSummary[];
}

const EXT_ID_PATTERN = /^[a-z0-9-]+:[a-z0-9-]+$/;
const SUGGESTION_DISTANCE_FLOOR = 2;
const SUGGESTION_DISTANCE_DIVISOR = 3;

interface BodySource {
  readonly body: string;
  readonly bodyOffset: number;
  readonly fileText: string;
  readonly filePath: string;
}

export async function check(options: CheckOptions): Promise<CheckResult> {
  const sources = options.sources ?? defaultSources();
  const installed = await discoverInstalledSkills(sources);
  const index = indexSkills(installed);
  const indexedSources = sources.map<SourceSummary>((s) => ({
    source: s.name,
    skillCount: installed.filter((i) => i.source === s.name).length,
  }));

  const violations: ExtViolation[] = [];
  let checkedFiles = 0;
  for await (const skillDir of findSkillDirs(options.srcRoot)) {
    const loaded = await loadSkill(skillDir);
    if (!loaded.ok) {
      throw new Error(
        `failed to load skill at ${skillDir}:\n  - ${formatLoadSkillError(loaded.error).join("\n  - ")}`,
      );
    }
    checkedFiles += 1;
    const fileText = await readFile(loaded.value.bodyFilePath, "utf8");
    const source: BodySource = {
      body: loaded.value.body,
      bodyOffset: loaded.value.bodyOffset,
      fileText,
      filePath: loaded.value.bodyFilePath,
    };
    for (const violation of validateBody(source, index)) {
      violations.push(violation);
    }
  }

  return { violations, checkedFiles, indexedSources };
}

function validateBody(
  source: BodySource,
  index: ReadonlyMap<string, readonly InstalledSkill[]>,
): readonly ExtViolation[] {
  const violations: ExtViolation[] = [];
  for (const token of parsePlaceholders(source.body)) {
    if (token.prefix !== "ext") continue;
    const { line, column } = offsetToLineCol(source.fileText, source.bodyOffset + token.start);
    const at = { token: token.raw, file: source.filePath, line, column };

    if (token.value === null || !EXT_ID_PATTERN.test(token.value)) {
      violations.push({
        ...at,
        kind: "malformed",
        message: "expected `{{ext:<plugin>:<skill>}}` in kebab-case",
      });
      continue;
    }

    if (index.has(token.value)) continue;

    const suggestion = closestMatch(token.value, [...index.keys()]);
    violations.push({
      ...at,
      kind: "unresolved",
      message: suggestion
        ? `\`${token.value}\` not installed (did you mean \`${suggestion}\`?)`
        : `\`${token.value}\` not installed`,
    });
  }
  return violations;
}

async function* findSkillDirs(srcRoot: string): AsyncGenerator<string> {
  if (!(await pathExists(srcRoot))) return;
  for await (const dir of walkDirs(srcRoot)) {
    const found = await findSkillFile(dir);
    if (!found.ok || found.value) yield dir;
  }
}

async function* walkDirs(dir: string): AsyncGenerator<string> {
  yield dir;
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.isDirectory() && !entry.isSymbolicLink()) {
      yield* walkDirs(join(dir, entry.name));
    }
  }
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

function closestMatch(needle: string, haystack: readonly string[]): string | null {
  let best: { value: string; distance: number } | null = null;
  const threshold = Math.max(
    SUGGESTION_DISTANCE_FLOOR,
    Math.floor(needle.length / SUGGESTION_DISTANCE_DIVISOR),
  );
  for (const candidate of haystack) {
    const distance = levenshtein(needle, candidate);
    if (distance > threshold) continue;
    if (!best || distance < best.distance) best = { value: candidate, distance };
  }
  return best?.value ?? null;
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  let curr = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i += 1) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const deletion = (curr[j - 1] ?? 0) + 1;
      const insertion = (prev[j] ?? 0) + 1;
      const substitution = (prev[j - 1] ?? 0) + cost;
      curr[j] = Math.min(deletion, insertion, substitution);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[b.length] ?? 0;
}
