import { SchemaValidationError, parseWithSchema } from "./schema.js";
import { ProjectileSpecSchema, type ProjectileSpec } from "./projectile-assets.js";

/** Validates one raw asset payload against `ProjectileSpecSchema` (P1.26). */
export function loadProjectileAsset(raw: unknown): ProjectileSpec {
  return parseWithSchema(ProjectileSpecSchema, raw);
}

/**
 * Validates a list of raw asset payloads, e.g. the build-time asset bundle.
 * Re-throws with the offending index prefixed so a corrupt fixture in a
 * large bundle is easy to locate.
 */
export function loadProjectileAssets(raw: readonly unknown[]): ProjectileSpec[] {
  return raw.map((entry, index) => {
    try {
      return loadProjectileAsset(entry);
    } catch (err) {
      if (err instanceof SchemaValidationError) {
        throw new SchemaValidationError(
          `Projectile asset at index ${index}: ${err.message}`,
          err.issues,
        );
      }
      throw err;
    }
  });
}
