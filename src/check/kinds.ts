import type { InstalledIndex } from "../installed.js";
import type { LocalIds } from "../layout/index.js";

export interface KindConfig {
  readonly noun: string;
  readonly missingHint: string;
  readonly malformedHint: string;
  readonly haystack: ReadonlySet<string>;
}

const INSTALLED_MISSING = "not installed";
const LOCAL_MISSING = "not found in this marketplace";

export function installedKindConfigs(index: InstalledIndex): ReadonlyMap<string, KindConfig> {
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

export function localKindConfigs(ids: LocalIds): ReadonlyMap<string, KindConfig> {
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
