# Harness Kit

Build your own multi-agent harness. `harness-kit` is a typed toolkit for assembling a marketplace of plugins — skills, agents, commands, hooks — and shipping it to Claude Code and/or Codex from a single source tree.

You write plugins once, in a shape that round-trips through the upstream Claude Code marketplace schema. The compiler validates cross-references, expands placeholders, and emits the per-vendor manifests each CLI expects. The installer wires the result into the local Claude/Codex caches.

## Requirements

- Node ≥ 24
- A package manager (pnpm, npm, yarn — pnpm is what this repo uses)
- The `claude` and/or `codex` CLIs on `$PATH` — only needed to run `harness-kit install` / `uninstall`

## Install

```sh
pnpm add @jean.gnc/harness-kit
```

## Source layout

A harness is a marketplace of plugins. Each plugin can carry skills, agents, commands, and hooks — plus any upstream-schema fields (MCP servers, etc.) the plugin manifest passes through. Manifests are co-located per vendor so the same source compiles to both targets:

```
src/
  .claude-plugin/
    marketplace.json                 # marketplace metadata, read by `install`
  plugins/
    <plugin>/
      .claude-plugin/plugin.json     # claude target manifest
      .codex-plugin/plugin.json      # codex target manifest (optional)
      skills/<skill>/SKILL.md
      skills/<skill>/<companion>.md  # optional
      agents/<agent>.md              # optional
      commands/<command>.md          # optional
      hooks/<hook>.json              # optional
```

The marketplace manifest enumerates its plugins under `plugins[]` with a `source: { kind: "relative", path: "..." }` for each; folders not listed there are ignored. Set `metadata.pluginRoot` on the marketplace to rebase that lookup (e.g. `plugins/` lives next to a `packages/` tree).

Plugin manifests can also declare `context: [{ file }]` (files copied into the compiled plugin) and `hookRequires: [{ event, skill|command|agent }]` (hook requirements validated against discovered local IDs at build time).

The marketplace and plugin manifests accept the full upstream Claude Code shape — `homepage`, `repository`, `allowCrossMarketplaceDependenciesOn`, object-form dependencies (`{ name, marketplace }`), and any other documented fields pass through unchanged. Existing Claude marketplaces drop in without rewriting their manifests.

## Authoring a skill

Skills are auto-discovered by walking `<srcRoot>/plugins/<plugin>/skills/<name>/SKILL.md`. The `name` field in frontmatter must match the skill's folder name.

```md
<!-- SKILL.md -->
---
name: my-skill
description: What the skill does — single line.
companions:
  - file: details.md
    summary: Deeper notes.
---

# My Skill

For type safety conventions, see {{skill:dev-tools:typescript}}.
For TDD discipline, see {{ext:superpowers:test-driven-development}}.
For details, see {{ref:details.md}}.

{{companions}}
```

Compiles to:

```md
<!-- dist/plugins/<plugin>/skills/my-skill/SKILL.md -->
---
name: my-skill
description: What the skill does — single line.
companions:
  - file: details.md
    summary: Deeper notes.
---

# My Skill

For type safety conventions, see `dev-tools:typescript`.
For TDD discipline, see `superpowers:test-driven-development`.
For details, see `details.md`.

## Companion files (read on demand)

- `details.md` — Deeper notes.
```

### Composing with includes

Use `{{include:./fragment.md}}` to inline another Markdown file verbatim into the body. Includes expand recursively (an included file may itself contain `{{include:...}}`), and any other placeholders inside the inlined content are resolved against the **host skill**, not the include source.

Constraints:

- Path must be relative and stay inside the skill directory.
- Target must end in `.md`.
- Cycles are detected and fail the build.
- Included files are not copied into `dist/` and are not flagged as undeclared companions.

### Authoring with TypeScript (alternative)

If you prefer typed metadata, use `SKILL.ts` + sibling `body.md` instead of a single `SKILL.md`:

```ts
// SKILL.ts
import { defineSkill } from "@jean.gnc/harness-kit";

export default defineSkill({
  name: "my-skill",
  description: "What the skill does — single line.",
  companions: [{ file: "details.md", summary: "Deeper notes." }],
});
```

```md
<!-- body.md -->
# My Skill

For type safety conventions, see {{skill:dev-tools:typescript}}.
```

A skill folder must contain exactly one of `SKILL.md` or `SKILL.ts`. Both forms run through the same placeholder pipeline and produce identical `dist/` output.

## CLI

The package ships a `harness-kit` CLI bin:

```sh
harness-kit build      # compile typed sources to dist/
harness-kit lint       # lint compiled markdown under dist/ with default rules
harness-kit check      # validate {{ext:...}} refs against installed plugins
harness-kit install    # install dist/ plugins into Claude + Codex
harness-kit uninstall  # remove them
```

In your `package.json`:

```json
{
  "scripts": {
    "build": "harness-kit build",
    "lint": "harness-kit build && harness-kit lint",
    "install:plugins": "harness-kit install",
    "uninstall:plugins": "harness-kit uninstall"
  },
  "dependencies": {
    "@jean.gnc/harness-kit": "latest"
  }
}
```

`build` defaults: `./src` → `./dist`. Override with `--src` and `--out`.

`lint` defaults: `./dist`. Runs `markdownlint-cli2` against `plugins/**/*.md` with harness-kit's bundled rules — `MD013` (line length), `MD041` (first-line h1), and `MD033` (inline HTML) disabled; `MD024` scoped to `siblings_only`; `MD031` allows omitting blank lines around fences inside list items. Override with `--out`.

`install` / `uninstall` defaults: reads `./dist`, targets both Claude and Codex. Filter with `--targets claude` or `--targets codex`. The marketplace name is read from `./dist/.claude-plugin/marketplace.json`, and the `claude` / `codex` CLIs must be on `$PATH`.

## Programmatic API

```ts
import {
  build,
  lint,
  install,
  uninstall,
  compile,
  defineSkill,
  parsePlaceholders,
  substitute,
  checkCompanionFiles,
} from "@jean.gnc/harness-kit";

await build({
  srcRoot: "./src",
  outRoot: "./dist",
  bodyInvariants: [
    /* (body) => string[] — extra checks to run on every skill body */
  ],
});

await install({ targets: ["claude", "codex"] });
```

`bodyInvariants` are consumer-supplied predicates of type `(body: string) => string[]`. Each runs on every skill body (after `{{include:...}}` expansion, before placeholder substitution) during compile; any returned strings are reported as invariant violations and fail the build.

## Placeholder reference

Local skills are auto-discovered by walking `<srcRoot>/plugins/<plugin>/skills/<name>/`. Use `{{skill:...}}` for local references (build fails on typos) and `{{ext:...}}` for cross-plugin references (rendered as-is, no validation).

| Placeholder | Renders to | Validation |
| --- | --- | --- |
| `{{skill:<plugin>:<name>}}` | `` `<plugin>:<name>` `` | Must be a discovered local skill |
| `{{ext:<plugin>:<skill>}}` | `` `<plugin>:<skill>` `` | None — opaque external reference |
| `{{ref:<relative-path>}}` | `` `<relative-path>` `` | Must be a file under the skill directory |
| `{{include:<relative-path.md>}}` | Inlined content of the target file | Must be a `.md` file inside the skill, no cycles |
| `{{companions}}` | Companion files section | Required iff companions are declared |

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md).
