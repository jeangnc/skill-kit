import { z } from "zod";

const RESERVED_COMPANION_FILENAMES = new Set(["body.md", "SKILL.md"]);

export const CompanionSchema = z.object({
  file: z
    .string()
    .regex(/^[a-z0-9-]+\.md$/, "companion file must be a kebab-case .md filename")
    .refine(
      (f) => !RESERVED_COMPANION_FILENAMES.has(f),
      (f) => ({ message: `"${f}" is reserved and cannot be used as a companion filename` }),
    ),
  summary: z
    .string()
    .min(1)
    .refine((s) => !s.includes("\n"), "companion summary cannot contain newlines"),
});

export type Companion = z.infer<typeof CompanionSchema>;

export const SkillSchema = z.object({
  name: z
    .string()
    .min(1)
    .regex(/^[a-z0-9-]+$/, "name must be lowercase kebab-case"),
  description: z
    .string()
    .min(1)
    .max(1024)
    .refine((s) => !s.includes("\n"), "description cannot contain newlines"),
  companions: z
    .array(CompanionSchema)
    .optional()
    .refine(
      (arr) => !arr || new Set(arr.map((c) => c.file)).size === arr.length,
      "companion files must be unique",
    ),
});

export type Skill = z.infer<typeof SkillSchema>;

export function defineSkill(skill: Skill): Skill {
  return SkillSchema.parse(skill);
}
