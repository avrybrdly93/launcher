import { ProjectileSpecSchema, type ProjectileSpec } from "./projectile-spec.js";
import { parseWithSchema, SchemaValidationError } from "./schema.js";

/**
 * Raised when an asset fixture can't be turned into a valid `ProjectileSpec`
 * — either the text isn't JSON, or it doesn't conform to the schema. Always
 * carries `sourceName` so a build script validating many fixture files can
 * report *which* one is broken, and wraps the underlying JSON/schema error
 * in `message` rather than just rethrowing it bare (P1.26).
 */
export class AssetLoadError extends Error {
  constructor(
    message: string,
    readonly sourceName: string,
    override readonly cause?: unknown,
  ) {
    super(message);
    this.name = "AssetLoadError";
  }
}

/**
 * Validates already-parsed data as a `ProjectileSpec` (§3.9). This is the
 * "build-time schema validation" the blueprint calls for: a corrupt fixture
 * — missing provenance, negative mass, an unrecognized dragCoefficient kind
 * — is rejected here with a useful, field-level error rather than surfacing
 * downstream as a confusing runtime crash.
 */
export function loadProjectileSpec(sourceName: string, data: unknown): ProjectileSpec {
  try {
    return parseWithSchema(ProjectileSpecSchema, data);
  } catch (err) {
    if (err instanceof SchemaValidationError) {
      throw new AssetLoadError(
        `Invalid projectile asset "${sourceName}": ${err.message}`,
        sourceName,
        err,
      );
    }
    throw err;
  }
}

/** Like `loadProjectileSpec`, but for a raw JSON fixture file's text content. */
export function loadProjectileSpecFromJsonText(
  sourceName: string,
  jsonText: string,
): ProjectileSpec {
  let data: unknown;
  try {
    data = JSON.parse(jsonText);
  } catch (err) {
    throw new AssetLoadError(
      `Failed to parse "${sourceName}" as JSON: ${err instanceof Error ? err.message : String(err)}`,
      sourceName,
      err,
    );
  }
  return loadProjectileSpec(sourceName, data);
}
