import { parseWithSchema, SchemaValidationError, type Schema } from "./schema.js";

/**
 * Validates a raw (e.g. JSON-sourced) array of asset records against
 * `schema` and returns the typed, parsed array. Every entry is validated
 * eagerly — a caller module that runs this at top-level module-eval time
 * (as `projectile-spec.ts` does for `PROJECTILE_ASSETS`) gets build-time
 * validation: a corrupt fixture fails as soon as the module is imported,
 * not on first use.
 */
export function loadAssetArray<T>(
  schema: Schema<T>,
  raw: readonly unknown[],
  kind: string,
): readonly T[] {
  return raw.map((entry, i) => {
    try {
      return parseWithSchema(schema, entry);
    } catch (e) {
      if (e instanceof SchemaValidationError) {
        const id =
          typeof entry === "object" && entry !== null && "id" in entry
            ? String((entry as { id: unknown }).id)
            : "?";
        throw new SchemaValidationError(`${kind}[${i}] (id=${id}): ${e.message}`, e.issues);
      }
      throw e;
    }
  });
}
