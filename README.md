# skill-kit

Typed framework for authoring Claude Code skills. Skills are declared as a tiny TypeScript metadata file plus a sibling `body.md` written in plain Markdown. The compiler validates references, expands placeholders, and emits the `SKILL.md` files Claude Code expects.

## Usage

```ts
// SKILL.ts
import { defineSkill } from "skill-kit";

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
import { compile } from "skill-kit";

await compile({
  srcRoot: "./src",
  outRoot: "./dist",
  validSkillIds: ["dev-tools:typescript", "my-plugin:my-skill"],
  bodyInvariants: [/* consumer-supplied (body) => string[] */],
});
```

## Placeholder reference

| Placeholder | Renders to | Validation |
| --- | --- | --- |
| `{{skill:<plugin>:<name>}}` | `` `<plugin>:<name>` `` | Must appear in `validSkillIds` |
| `{{companion:<file>.md}}` | `` `<file>.md` `` | Must be a declared companion |
| `{{companions}}` | Companion files section | Required iff companions are declared |
