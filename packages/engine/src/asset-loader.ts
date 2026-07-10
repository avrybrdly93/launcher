import type { Schema } from "./schema.js";
import { SchemaValidationError } from "./schema.js";

/**
 * Thrown by `loadAssets` on the first invalid record. Beyond the generic
 * `SchemaValidationError`, this names *which* asset failed (source label +
 * index + id, when the raw record has one) — essential once an asset list
 * grows past one or two entries and a bare "validation failed" is no longer
 * a useful error (P1.26).
 */
export class AssetLoadError extends Error {
  constructor(
    message: string,
    readonly source: string,
    readonly index: number,
    override readonly cause: SchemaValidationError,
  ) {
    super(message);
    this.name = "AssetLoadError";
  }
}

function idHint(raw: unknown): string {
  if (
    typeof raw === "object" &&
    raw !== null &&
    "id" in raw &&
    typeof (raw as { id: unknown }).id === "string"
  ) {
    return (raw as { id: string }).id;
  }
  return "<no id>";
}

/**
 * Validates every record in `rawAssets` against `schema`, throwing an
 * `AssetLoadError` naming the source/index/id of the first failure. Data
 * assets (e.g. `PROJECTILE_ASSETS`) call this at module load, so a corrupt
 * fixture is caught at import/build time rather than at first use.
 */
export function loadAssets<T>(
  schema: Schema<T>,
  rawAssets: readonly unknown[],
  source: string,
): readonly T[] {
  return rawAssets.map((raw, index) => {
    const result = schema.safeParse(raw);
    if (!result.success) {
      const issues = result.error.issues.map(
        (i) => `${i.path.join(".") || "<root>"}: ${i.message}`,
      );
      throw new AssetLoadError(
        `${source}[${index}] (id: ${idHint(raw)}) failed validation: ${issues.join("; ")}`,
        source,
        index,
        new SchemaValidationError(`${source}[${index}] failed validation`, result.error.issues),
      );
    }
    return result.data;
  });
}
