import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";

import { offsetToLineCol, parsePlaceholders } from "./placeholders/index.js";
import { findSkillFile, formatLoadSkillError, loadSkill } from "./skill/index.js";
import {
  collectLocalIds,
  loadLayout,
  type LayoutAdapter,
  type LocalIds,
  type ResolvedPlugin,
} from "./layout/index.js";
import {
  defaultSources,
  discoverInstalled,
  indexInstalled,
  type InstalledIndex,
  type PluginSource,
} from "./installed.js";

export type CheckMode = "local" | "installed" | "all";

export interface CheckOptions {
  readonly srcRoot: string;
  readonly mode?: CheckMode;
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

const ID_PATTERN = /^[a-z0-9-]+:[a-z0-9-]+$/;
const SUGGESTION_DISTANCE_FLOOR = 2;
const SUGGESTION_DISTANCE_DIVISOR = 3;

interface KindConfig {
  readonly noun: string;
  readonly missingHint: string;
  readonly malformedHint: string;
  readonly haystack: ReadonlySet<string>;
}

interface BodySource {
  readonly body: string;
  readonly bodyOffset: number;
  readonly fileText: string;
  readonly filePath: string;
}

export async function check(options: CheckOptions): Promise<CheckResult> {
  const mode: CheckMode = options.mode ?? "installed";
  const kinds = new Map<string, KindConfig>();
  let indexedSources: readonly SourceSummary[] = [];
  let localAdapter: LayoutAdapter | null = null;

  if (mode === "installed" || mode === "all") {
    const sources = options.sources ?? defaultSources();
    const artifacts = await discoverInstalled(sources);
    const index = indexInstalled(artifacts);
    indexedSources = sources.map<SourceSummary>((s) => ({
      source: s.name,
      skillCount: artifacts.skills.filter((i) => i.source === s.name).length,
    }));
    for (const [prefix, cfg] of installedKindConfigs(index)) kinds.set(prefix, cfg);
  }

  if (mode === "local" || mode === "all") {
    const loaded = await loadLayout(options.srcRoot);
    if (!loaded.ok) throw new Error(`failed to load layout: ${loaded.error.kind}`);
    localAdapter = loaded.value;
    const ids = await collectLocalIds(localAdapter);
    for (const [prefix, cfg] of localKindConfigs(ids)) kinds.set(prefix, cfg);
  }

  const sources = await collectBodySources({
    srcRoot: options.srcRoot,
    mode,
    adapter: localAdapter,
  });
  const violations: ExtViolation[] = [];
  for (const source of sources) {
    for (const violation of validateBody(source, kinds)) {
      violations.push(violation);
    }
  }

  return { violations, checkedFiles: sources.length, indexedSources };
}

interface CollectOptions {
  readonly srcRoot: string;
  readonly mode: CheckMode;
  readonly adapter: LayoutAdapter | null;
}

async function collectBodySources(opts: CollectOptions): Promise<readonly BodySource[]> {
  const seen = new Set<string>();
  const out: BodySource[] = [];
  const push = async (filePath: string, body: string, bodyOffset: number): Promise<void> => {
    if (seen.has(filePath)) return;
    seen.add(filePath);
    const fileText = await readFile(filePath, "utf8");
    out.push({ body, bodyOffset, fileText, filePath });
  };

  if (opts.mode === "installed" || opts.mode === "all") {
    for await (const skillDir of findSkillDirs(opts.srcRoot)) {
      const loaded = await loadSkill(skillDir);
      if (!loaded.ok) {
        throw new Error(
          `failed to load skill at ${skillDir}:\n  - ${formatLoadSkillError(loaded.error).join("\n  - ")}`,
        );
      }
      await push(loaded.value.bodyFilePath, loaded.value.body, loaded.value.bodyOffset);
    }
  }

  if ((opts.mode === "local" || opts.mode === "all") && opts.adapter) {
    for (const plugin of opts.adapter.plugins) {
      for (const file of await collectPluginBodies(plugin)) {
        await push(file.filePath, file.body, file.bodyOffset);
      }
    }
  }

  return out;
}

interface PluginBody {
  readonly filePath: string;
  readonly body: string;
  readonly bodyOffset: number;
}

async function collectPluginBodies(plugin: ResolvedPlugin): Promise<readonly PluginBody[]> {
  const out: PluginBody[] = [];
  if (await pathExists(plugin.skillsDir)) {
    for (const entry of await readdir(plugin.skillsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const skillDir = join(plugin.skillsDir, entry.name);
      const found = await findSkillFile(skillDir);
      if (!found.ok || !found.value) continue;
      const loaded = await loadSkill(skillDir);
      if (!loaded.ok) {
        throw new Error(
          `failed to load skill at ${skillDir}:\n  - ${formatLoadSkillError(loaded.error).join("\n  - ")}`,
        );
      }
      out.push({
        filePath: loaded.value.bodyFilePath,
        body: loaded.value.body,
        bodyOffset: loaded.value.bodyOffset,
      });
    }
  }
  for (const dir of [plugin.commandsDir, plugin.agentsDir]) {
    if (!(await pathExists(dir))) continue;
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
      const filePath = join(dir, entry.name);
      const body = await readFile(filePath, "utf8");
      out.push({ filePath, body, bodyOffset: 0 });
    }
  }
  return out;
}

function validateBody(
  source: BodySource,
  kinds: ReadonlyMap<string, KindConfig>,
): readonly ExtViolation[] {
  const violations: ExtViolation[] = [];
  for (const token of parsePlaceholders(source.body)) {
    const kind = kinds.get(token.prefix);
    if (!kind) continue;
    const { line, column } = offsetToLineCol(source.fileText, source.bodyOffset + token.start);
    const at = { token: token.raw, file: source.filePath, line, column };

    if (token.value === null || !ID_PATTERN.test(token.value)) {
      violations.push({ ...at, kind: "malformed", message: kind.malformedHint });
      continue;
    }

    if (kind.haystack.has(token.value)) continue;

    const suggestion = closestMatch(token.value, [...kind.haystack]);
    violations.push({
      ...at,
      kind: "unresolved",
      message: suggestion
        ? `\`${token.value}\` ${kind.noun} ${kind.missingHint} (did you mean \`${suggestion}\`?)`
        : `\`${token.value}\` ${kind.noun} ${kind.missingHint}`,
    });
  }
  return violations;
}

const INSTALLED_MISSING = "not installed";
const LOCAL_MISSING = "not found in this marketplace";

function installedKindConfigs(index: InstalledIndex): ReadonlyMap<string, KindConfig> {
  return new Map<string, KindConfig>([
    [
      "ext",
      {
        noun: "skill",
        missingHint: INSTALLED_MISSING,
        malformedHint: "expected `{{ext:<plugin>:<skill>}}` in kebab-case",
        haystack: new Set(index.skills.keys()),
      },
    ],
    [
      "ext-command",
      {
        noun: "command",
        missingHint: INSTALLED_MISSING,
        malformedHint: "expected `{{ext-command:<plugin>:<command>}}` in kebab-case",
        haystack: new Set(index.commands.keys()),
      },
    ],
    [
      "ext-agent",
      {
        noun: "agent",
        missingHint: INSTALLED_MISSING,
        malformedHint: "expected `{{ext-agent:<plugin>:<agent>}}` in kebab-case",
        haystack: new Set(index.agents.keys()),
      },
    ],
  ]);
}

function localKindConfigs(ids: LocalIds): ReadonlyMap<string, KindConfig> {
  return new Map<string, KindConfig>([
    [
      "skill",
      {
        noun: "skill",
        missingHint: LOCAL_MISSING,
        malformedHint: "expected `{{skill:<plugin>:<skill>}}` in kebab-case",
        haystack: ids.skills,
      },
    ],
    [
      "command",
      {
        noun: "command",
        missingHint: LOCAL_MISSING,
        malformedHint: "expected `{{command:<plugin>:<command>}}` in kebab-case",
        haystack: ids.commands,
      },
    ],
    [
      "agent",
      {
        noun: "agent",
        missingHint: LOCAL_MISSING,
        malformedHint: "expected `{{agent:<plugin>:<agent>}}` in kebab-case",
        haystack: ids.agents,
      },
    ],
  ]);
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
