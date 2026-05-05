import type { ZodError } from "zod";

export function formatZodIssues(error: ZodError): string[] {
  return error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`);
}
