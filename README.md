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
For details, see {{companion:details.md}}.

{{companions}}
```

## Compiling

```ts
import { compile } from "@jean.gnc/skill-kit";

await compile({
  srcRoot: "./src",
  outRoot: "./dist",
  bodyInvariants: [
    /* consumer-supplied (body) => string[] */
  ],
});
```

Local skills are auto-discovered by walking `<srcRoot>/plugins/<plugin>/skills/<name>/SKILL.ts`. Use `{{skill:...}}` for local references (validated, build fails on typos) and `{{ext:...}}` for cross-plugin references (rendered as-is, no validation).

`bodyInvariants` are project-specific checks (e.g. forbidden tokens, deprecated names) that run against each skill's body. The framework calls each function and aggregates returned error strings.

## Placeholder reference

| Placeholder | Renders to | Validation |
| --- | --- | --- |
| `{{skill:<plugin>:<name>}}` | `` `<plugin>:<name>` `` | Must be a discovered local skill |
| `{{ext:<id>}}` | `` `<id>` `` | None — opaque external reference |
| `{{companion:<file>.md}}` | `` `<file>.md` `` | Must be a declared companion |
| `{{companions}}` | Companion files section | Required iff companions are declared |

## License

MIT
