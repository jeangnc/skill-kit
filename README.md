# Skill Kit

Typed framework for authoring Claude Code skills. Skills are declared as a tiny TypeScript metadata file plus a sibling `body.md` written in plain Markdown. The compiler validates references, expands placeholders, and emits the `SKILL.md` files Claude Code expects.

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
          SKILL.ts
          body.md
          <companion>.md         # optional
```

Skills are auto-discovered by walking `<srcRoot>/plugins/<plugin>/skills/<name>/SKILL.ts`. The `name` field must match the skill's folder name.

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
For TDD discipline, see {{external:superpowers:test-driven-development}}.
For details, see {{companion:details.md}}.

{{companions}}
```

Compiles to:

```md
<!-- dist/plugins/<plugin>/skills/my-skill/SKILL.md -->
---
name: my-skill
description: What the skill does — single line.
---

# My Skill

For type safety conventions, see `dev-tools:typescript`.
For TDD discipline, see `superpowers:test-driven-development`.
For details, see `details.md`.

## Companion files (read on demand)

- `details.md` — Deeper notes.
```

## Building

The package ships a `skill-kit` CLI bin with three subcommands:

```sh
skill-kit build      # compile typed sources to dist/ (default)
skill-kit install    # install dist/ plugins into Claude + Codex
skill-kit uninstall  # remove them
```

In your `package.json`:

```json
{
  "scripts": {
    "build": "skill-kit build",
    "install:plugins": "skill-kit install",
    "uninstall:plugins": "skill-kit uninstall"
  },
  "dependencies": {
    "@jean.gnc/skill-kit": "^0.3.2"
  }
}
```

`build` defaults: `./src` → `./dist`. Override with `--src` and `--out`.

`install` / `uninstall` defaults: reads `./dist`, targets both Claude and Codex. Filter with `--targets claude` or `--targets codex`. The marketplace name is read from `./dist/.claude-plugin/marketplace.json`, and the `claude` / `codex` CLIs must be on `$PATH`.

For programmatic use:

```ts
import {
  build,
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
    /* (body) => string[] — extra checks to run on every body.md */
  ],
});

await install({ targets: ["claude", "codex"] });
```

`bodyInvariants` are consumer-supplied predicates of type `(body: string) => string[]`. Each runs on every `body.md` during compile; any returned strings are reported as invariant violations and fail the build.

## Placeholder reference

Local skills are auto-discovered by walking `<srcRoot>/plugins/<plugin>/skills/<name>/SKILL.ts`. Use `{{skill:...}}` for local references (build fails on typos) and `{{external:...}}` for cross-plugin references (rendered as-is, no validation).

| Placeholder | Renders to | Validation |
| --- | --- | --- |
| `{{skill:<plugin>:<name>}}` | `` `<plugin>:<name>` `` | Must be a discovered local skill |
| `{{external:<id>}}` | `` `<id>` `` | None — opaque external reference |
| `{{companion:<file>.md}}` | `` `<file>.md` `` | Must be a declared companion |
| `{{companions}}` | Companion files section | Required iff companions are declared |

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md).

## License

MIT
