import { z } from "zod";

export const CommandSchema = z
  .object({
    name: z
      .string()
      .min(1)
      .regex(/^[a-z0-9-]+$/, "name must be lowercase kebab-case"),
    description: z
      .string()
      .min(1)
      .max(1024)
      .refine((s) => !s.includes("\n"), "description cannot contain newlines"),
    "argument-hint": z.string().min(1).optional(),
    "allowed-tools": z.union([z.string().min(1), z.array(z.string().min(1))]).optional(),
    model: z.string().min(1).optional(),
  })
  .strict();

export type Command = z.infer<typeof CommandSchema>;

export function defineCommand(command: Command): Command {
  return CommandSchema.parse(command);
}
