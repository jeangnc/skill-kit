# @jean.gnc/skill-kit

Typed framework for authoring Claude Code skills. Skills are declared as a tiny TypeScript metadata file plus a sibling `body.md` written in plain Markdown. The compiler validates references, expands placeholders, and emits the `SKILL.md` files Claude Code expects.

## Install

```sh
pnpm add @jean.gnc/skill-kit
```

## Authoring a skill

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
    "@jean.gnc/skill-kit": "^0.3.0"
  }
}
```

`build` defaults: `./src` → `./dist`. Override with `--src` and `--out`.

`install` / `uninstall` defaults: reads `./dist`, targets both Claude and Codex. Filter with `--targets claude` or `--targets codex`. The marketplace name is read from `./dist/.claude-plugin/marketplace.json`.

For programmatic use:

```ts
import { build, install, uninstall } from "@jean.gnc/skill-kit";

await build({
  srcRoot: "./src",
  outRoot: "./dist",
  bodyInvariants: [
    /* consumer-supplied (body) => string[] checks */
  ],
});

await install({ targets: ["claude", "codex"] });
```

## Placeholder reference

Local skills are auto-discovered by walking `<srcRoot>/plugins/<plugin>/skills/<name>/SKILL.ts`. Use `{{skill:...}}` for local references (build fails on typos) and `{{external:...}}` for cross-plugin references (rendered as-is, no validation).

| Placeholder | Renders to | Validation |
| --- | --- | --- |
| `{{skill:<plugin>:<name>}}` | `` `<plugin>:<name>` `` | Must be a discovered local skill |
| `{{external:<id>}}` | `` `<id>` `` | None — opaque external reference |
| `{{companion:<file>.md}}` | `` `<file>.md` `` | Must be a declared companion |
| `{{companions}}` | Companion files section | Required iff companions are declared |

## License

MIT
