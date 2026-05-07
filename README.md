# Skill Kit

Typed framework for authoring Claude Code skills. A skill is a single `SKILL.md` file — frontmatter plus a Markdown body. The compiler validates references, expands placeholders, and emits the `SKILL.md` files Claude Code expects. A typed `SKILL.ts` form is also available when you want schema-checked metadata.

## Requirements

- Node ≥ 20
- A package manager (pnpm, npm, yarn — pnpm is what this repo uses)
- The `claude` and/or `codex` CLIs on `$PATH` — only needed to run `skill-kit install` / `uninstall`

## Install

```sh
pnpm add @jean.gnc/skill-kit
```

## Authoring a skill

Lay your sources out as a marketplace of plugins, each containing skills:

```
src/
  .claude-plugin/
    marketplace.json             # marketplace metadata, read by `install`
  plugins/
    <plugin>/
      .claude-plugin/plugin.json # claude target manifest
      .codex-plugin/plugin.json  # codex target manifest (optional)
      skills/
        <skill>/
          SKILL.md
          <companion>.md         # optional
```

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
import { defineSkill } from "@jean.gnc/skill-kit";

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

## Building

The package ships a `skill-kit` CLI bin:

```sh
skill-kit build      # compile typed sources to dist/
skill-kit lint       # lint compiled markdown under dist/ with default rules
skill-kit check      # validate {{ext:...}} refs against installed plugins
skill-kit install    # install dist/ plugins into Claude + Codex
skill-kit uninstall  # remove them
```

In your `package.json`:

```json
{
  "scripts": {
    "build": "skill-kit build",
    "lint": "skill-kit build && skill-kit lint",
    "install:plugins": "skill-kit install",
    "uninstall:plugins": "skill-kit uninstall"
  },
  "dependencies": {
    "@jean.gnc/skill-kit": "latest"
  }
}
```

`build` defaults: `./src` → `./dist`. Override with `--src` and `--out`.

`lint` defaults: `./dist`. Runs `markdownlint-cli2` against `plugins/**/*.md` with skill-kit's bundled rules — `MD013` (line length), `MD041` (first-line h1), and `MD033` (inline HTML) disabled; `MD024` scoped to `siblings_only`; `MD031` allows omitting blank lines around fences inside list items. Override with `--out`.

`install` / `uninstall` defaults: reads `./dist`, targets both Claude and Codex. Filter with `--targets claude` or `--targets codex`. The marketplace name is read from `./dist/.claude-plugin/marketplace.json`, and the `claude` / `codex` CLIs must be on `$PATH`.

For programmatic use:

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
} from "@jean.gnc/skill-kit";

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
