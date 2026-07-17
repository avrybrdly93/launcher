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

/** Thrown by {@link parseWithSchema} when data fails validation; carries the raw zod issues. */
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
