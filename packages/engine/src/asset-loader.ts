import { SchemaValidationError, parseWithSchema, type Schema } from "./schema.js";

/** Wraps a `SchemaValidationError` with which asset (and data source) it came from. */
export class AssetLoadError extends Error {
  constructor(
    message: string,
    readonly validationError: SchemaValidationError,
  ) {
    super(message);
    this.name = "AssetLoadError";
  }
}

function describeEntry(raw: unknown, index: number): string {
  if (typeof raw === "object" && raw !== null && "id" in raw) {
    return `'${String((raw as { id: unknown }).id)}' (position ${index})`;
  }
  return `at position ${index}`;
}

/**
 * Validates every entry of `rawAssets` against `schema`, throwing on the
 * first failure with the offending entry's id/position and the underlying
 * issue folded in (§3.9: "the asset loader validates schemas at build
 * time"). Called at module scope over static data (as `projectile-assets.ts`
 * does), a corrupt fixture fails the build/test run immediately with enough
 * context to find and fix it, rather than surfacing as a mysterious runtime
 * NaN deep inside a simulation.
 */
export function loadAssets<T>(
  schema: Schema<T>,
  rawAssets: readonly unknown[],
  sourceLabel: string,
): readonly T[] {
  return rawAssets.map((raw, index) => {
    try {
      return parseWithSchema(schema, raw);
    } catch (error) {
      if (error instanceof SchemaValidationError) {
        throw new AssetLoadError(
          `${sourceLabel}: asset ${describeEntry(raw, index)} failed validation: ${error.message}`,
          error,
        );
      }
      throw error;
    }
  });
}
