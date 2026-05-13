import { z } from "zod";

import { FQ_ID, PLUGIN_ID } from "../ids.js";

export const ContextEntrySchema = z.object({
  file: z.string().min(1).regex(/\.md$/, "file must be a .md path"),
  summary: z
    .string()
    .min(1)
    .refine((s) => !s.includes("\n"), "summary cannot contain newlines"),
});

export type ContextEntry = z.infer<typeof ContextEntrySchema>;

const AuthorSchema = z.object({
  name: z.string().min(1),
  email: z.string().min(1).optional(),
  url: z.string().min(1).optional(),
});

const contextListSchema = z
  .array(ContextEntrySchema)
  .optional()
  .refine(
    (arr) => !arr || new Set(arr.map((e) => e.file)).size === arr.length,
    "context files must be unique",
  );

const SLUG_REF = z.string().min(1).regex(FQ_ID, "must match <plugin>:<name> kebab-case");

const HookRequirementBase = z.object({
  event: z.string().min(1),
  skill: SLUG_REF.optional(),
  command: SLUG_REF.optional(),
  agent: SLUG_REF.optional(),
});

export const HookRequirementSchema = HookRequirementBase.strict().superRefine((value, ctx) => {
  const slugs = [value.skill, value.command, value.agent].filter((s) => s !== undefined);
  if (slugs.length !== 1) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "exactly one of skill | command | agent must be set",
      path: [],
    });
  }
});

export type HookRequirement = z.infer<typeof HookRequirementSchema>;

export const PluginSchema = z
  .object({
    name: z.string().min(1).regex(PLUGIN_ID, "name must be lowercase kebab-case"),
    version: z.string().min(1),
    description: z
      .string()
      .min(1)
      .max(1024)
      .refine((s) => !s.includes("\n"), "description cannot contain newlines"),
    author: AuthorSchema.optional(),
    homepage: z.string().min(1).optional(),
    repository: z.string().min(1).optional(),
    license: z.string().min(1).optional(),
    keywords: z.array(z.string().min(1)).optional(),
    dependencies: z.array(z.string().min(1)).optional(),
    context: contextListSchema,
    commands: z.string().min(1).optional(),
    agents: z.string().min(1).optional(),
    hooks: z.string().min(1).optional(),
    hookRequires: z.array(HookRequirementSchema).optional(),
  })
  .strict();

export type Plugin = z.infer<typeof PluginSchema>;

export function definePlugin(plugin: Plugin): Plugin {
  return PluginSchema.parse(plugin);
}
