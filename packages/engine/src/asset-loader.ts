import type { Schema } from "./schema.js";
import { parseWithSchema, SchemaValidationError } from "./schema.js";

/**
 * Validates a list of raw asset fixtures against `schema`, throwing on the
 * first invalid entry with the fixture's id (or index, if it has none)
 * folded into the message (P1.26). Asset modules call this at module scope
 * so a corrupt fixture fails as soon as the module is imported/bundled —
 * "build-time" validation — rather than surfacing as a runtime surprise
 * deep in a simulation.
 */
export function loadAssets<T>(
  schema: Schema<T>,
  fixtures: readonly unknown[],
  kind: string,
): readonly T[] {
  return fixtures.map((fixture, index) => {
    try {
      return parseWithSchema(schema, fixture);
    } catch (err) {
      if (err instanceof SchemaValidationError) {
        const label =
          typeof fixture === "object" && fixture !== null && "id" in fixture
            ? String((fixture as Record<string, unknown>).id)
            : `index ${index}`;
        throw new SchemaValidationError(
          `Invalid ${kind} asset (${label}): ${err.message}`,
          err.issues,
        );
      }
      throw err;
    }
  });
}
