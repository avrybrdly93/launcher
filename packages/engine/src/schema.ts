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
 * Parses a serialized (JSON-string) asset fixture against `schema` (P1.26) —
 * the loader §3.9 refers to when it says "the asset loader validates schemas
 * (zod) at build time." Malformed JSON and schema violations both surface as
 * a `SchemaValidationError` with a field-level, human-readable message,
 * rather than a bare `SyntaxError` or a generic zod dump.
 */
export function loadJsonAsset<T>(schema: Schema<T>, json: string): T {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch (err) {
    throw new SchemaValidationError(
      `Asset fixture is not valid JSON: ${(err as Error).message}`,
      [],
    );
  }
  return parseWithSchema(schema, raw);
}
