import type { z } from "zod";
import type { Schema } from "./schema.js";
import { SchemaValidationError } from "./schema.js";

/**
 * Validates a list of raw asset records against `schema`, throwing one
 * aggregated, useful error (which asset, which field, why) if any are
 * invalid, rather than each caller discovering a bad asset lazily deep in
 * the app (P1.26). Intended to run at module-load/build time over a
 * hard-coded asset list (see projectile-spec.ts), so a corrupt built-in
 * asset fails the build instead of shipping.
 */
export function loadAssets<T>(
  schema: Schema<T>,
  rawAssets: readonly unknown[],
  sourceLabel: string,
): readonly T[] {
  const parsed: T[] = [];
  const messages: string[] = [];
  const issues: z.ZodIssue[] = [];

  rawAssets.forEach((raw, index) => {
    const result = schema.safeParse(raw);
    if (result.success) {
      parsed.push(result.data);
      return;
    }
    const label =
      typeof raw === "object" && raw !== null && "id" in raw
        ? String((raw as { id: unknown }).id)
        : `#${index}`;
    for (const issue of result.error.issues) {
      messages.push(`${label}: ${issue.path.join(".") || "(root)"}: ${issue.message}`);
      issues.push(issue);
    }
  });

  if (messages.length > 0) {
    throw new SchemaValidationError(
      `${sourceLabel}: ${messages.length} validation issue(s) across ${rawAssets.length} asset(s):\n${messages.join("\n")}`,
      issues,
    );
  }

  return parsed;
}
