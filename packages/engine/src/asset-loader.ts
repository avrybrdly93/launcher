import { parseWithSchema, SchemaValidationError } from "./schema.js";
import { PROJECTILE_ASSETS, ProjectileSpecSchema, type ProjectileSpec } from "./projectile-spec.js";

/** Validates one candidate projectile asset (e.g. parsed from a JSON file) against `ProjectileSpecSchema`. */
export function loadProjectileAsset(raw: unknown): ProjectileSpec {
  return parseWithSchema(ProjectileSpecSchema, raw);
}

/**
 * Validates a batch of candidate projectile assets, tagging which entry
 * failed so a corrupt fixture produces a useful, locatable error rather than
 * a bare zod message.
 */
export function loadProjectileAssets(raw: readonly unknown[]): readonly ProjectileSpec[] {
  return raw.map((entry, i) => {
    try {
      return loadProjectileAsset(entry);
    } catch (err) {
      if (err instanceof SchemaValidationError) {
        throw new SchemaValidationError(`asset[${i}]: ${err.message}`, err.issues);
      }
      throw err;
    }
  });
}

/**
 * The built-in asset library, re-validated through the loader at import
 * time: a corrupt entry in `PROJECTILE_ASSETS` fails the build/test run
 * immediately instead of surfacing later at first use (§3.9's build-time
 * schema validation requirement).
 */
export const VALIDATED_PROJECTILE_ASSETS: readonly ProjectileSpec[] =
  loadProjectileAssets(PROJECTILE_ASSETS);
