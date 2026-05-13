import { z } from "zod";

export const AgentSchema = z
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
    tools: z.union([z.string().min(1), z.array(z.string().min(1))]).optional(),
    model: z.string().min(1).optional(),
  })
  .strict();

export type Agent = z.infer<typeof AgentSchema>;

export function defineAgent(agent: Agent): Agent {
  return AgentSchema.parse(agent);
}
