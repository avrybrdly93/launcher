import { parseWithSchema, SchemaValidationError, type Schema } from "./schema.js";

/** Thrown by `loadAssets` when a raw record fails schema validation, identifying which one and why. */
export class AssetLoadError extends Error {
  constructor(
    message: string,
    override readonly cause: SchemaValidationError,
  ) {
    super(message);
    this.name = "AssetLoadError";
  }
}

/**
 * Validates a batch of raw asset records against `schema`, in order. Any
 * data asset module (projectiles, presets, tables, ...) can call this at
 * module-load time -- effectively build time for a bundled app -- to fail
 * fast on a corrupt fixture, with a useful error naming which asset (by
 * index, and id if the record has one) and which field was invalid.
 */
export function loadAssets<T>(
  schema: Schema<T>,
  rawAssets: readonly unknown[],
  assetKind: string,
): readonly T[] {
  return rawAssets.map((raw, index) => {
    try {
      return parseWithSchema(schema, raw);
    } catch (err) {
      if (err instanceof SchemaValidationError) {
        throw new AssetLoadError(
          `Failed to load ${assetKind} ${describeAsset(raw, index)}: ${err.message}`,
          err,
        );
      }
      throw err;
    }
  });
}

function describeAsset(raw: unknown, index: number): string {
  if (raw && typeof raw === "object" && "id" in raw && typeof raw.id === "string") {
    return `#${index} (id="${raw.id}")`;
  }
  return `#${index}`;
}
