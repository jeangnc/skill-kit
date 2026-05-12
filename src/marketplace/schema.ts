import { z } from "zod";

const SLUG = /^[a-z0-9-]+$/;

const OwnerSchema = z
  .object({
    name: z.string().min(1),
    email: z.string().min(1).optional(),
  })
  .strict();

const MetadataSchema = z
  .object({
    pluginRoot: z.string().min(1).optional(),
    version: z.string().min(1).optional(),
  })
  .strict();

const GithubSourceBody = z
  .object({
    source: z.literal("github"),
    repo: z.string().min(1),
    ref: z.string().min(1).optional(),
    sha: z.string().min(1).optional(),
  })
  .strict();

const UrlSourceBody = z
  .object({
    source: z.literal("url"),
    url: z.string().min(1),
    ref: z.string().min(1).optional(),
  })
  .strict();

const GitSubdirSourceBody = z
  .object({
    source: z.literal("git-subdir"),
    url: z.string().min(1),
    path: z.string().min(1),
    ref: z.string().min(1).optional(),
    sha: z.string().min(1).optional(),
  })
  .strict();

const NpmSourceBody = z
  .object({
    source: z.literal("npm"),
    package: z.string().min(1),
    version: z.string().min(1).optional(),
    registry: z.string().min(1).optional(),
  })
  .strict();

const ObjectSourceSchema = z
  .discriminatedUnion("source", [
    GithubSourceBody,
    UrlSourceBody,
    GitSubdirSourceBody,
    NpmSourceBody,
  ])
  .transform((value) => {
    switch (value.source) {
      case "github":
        return { kind: "github" as const, ...value };
      case "url":
        return { kind: "url" as const, ...value };
      case "git-subdir":
        return { kind: "git-subdir" as const, ...value };
      case "npm":
        return { kind: "npm" as const, ...value };
    }
  });

const RelativeSourceSchema = z
  .string()
  .min(1)
  .transform((path) => ({ kind: "relative" as const, path }));

const SourceSchema = z.union([RelativeSourceSchema, ObjectSourceSchema]);

export const PluginEntrySchema = z
  .object({
    name: z.string().min(1).regex(SLUG, "name must be lowercase kebab-case"),
    source: SourceSchema,
    strict: z.boolean().optional(),
  })
  .strict();

export type PluginEntry = z.infer<typeof PluginEntrySchema>;
export type PluginSource = PluginEntry["source"];

export const MarketplaceSchema = z
  .object({
    name: z.string().min(1).regex(SLUG, "name must be lowercase kebab-case"),
    owner: OwnerSchema,
    metadata: MetadataSchema.optional(),
    plugins: z
      .array(PluginEntrySchema)
      .min(1)
      .refine(
        (arr) => new Set(arr.map((p) => p.name)).size === arr.length,
        "plugin names must be unique",
      ),
  })
  .strict();

export type Marketplace = z.infer<typeof MarketplaceSchema>;

export function defineMarketplace(manifest: unknown): Marketplace {
  return MarketplaceSchema.parse(manifest);
}
