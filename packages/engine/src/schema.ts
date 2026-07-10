import { z } from "zod";

/**
 * Declarative metadata for one component of a Model's state/derived output
 * (§2.4a). Viz consumes only this plus recorded channel data — it never
 * computes physics.
 */
export interface ChannelMeta {
  readonly name: string;
  readonly unit: string;
  readonly color?: string;
}

/** A named, numeric parameter bag (projectile/environment/solver params). */
export type Params = Readonly<Record<string, number>>;

/** A zod schema is the runtime validator for any serializable Ballista type. */
export type Schema<T> = z.ZodType<T>;

export class SchemaValidationError extends Error {
  constructor(
    message: string,
    readonly issues: z.ZodIssue[],
  ) {
    super(message);
    this.name = "SchemaValidationError";
  }
}

/** Parse `data` against `schema`, throwing a `SchemaValidationError` with a useful message on failure. */
export function parseWithSchema<T>(schema: Schema<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new SchemaValidationError(
      `Schema validation failed: ${result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
      result.error.issues,
    );
  }
  return result.data;
}

/**
 * Parses an array of raw records against `schema`, one entry at a time, so a
 * defect is reported against the specific entry it belongs to (via
 * `labelOf`) rather than a bare array index — the backbone of any asset
 * loader that needs a useful error on a corrupt fixture (§3.9/P1.26).
 */
export function parseArrayWithSchema<T>(
  schema: Schema<T>,
  data: readonly unknown[],
  labelOf: (item: unknown, index: number) => string = (_item, index) => `#${index}`,
): T[] {
  return data.map((entry, index) => {
    const result = schema.safeParse(entry);
    if (!result.success) {
      throw new SchemaValidationError(
        `Item "${labelOf(entry, index)}" (position ${index}) failed validation: ${result.error.issues
          .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
          .join("; ")}`,
        result.error.issues,
      );
    }
    return result.data;
  });
}
