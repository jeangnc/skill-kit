import { z } from "zod";

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

export const PluginSchema = z.object({
  name: z
    .string()
    .min(1)
    .regex(/^[a-z0-9-]+$/, "name must be lowercase kebab-case"),
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
});

export type Plugin = z.infer<typeof PluginSchema>;

export function definePlugin(plugin: Plugin): Plugin {
  return PluginSchema.parse(plugin);
}
