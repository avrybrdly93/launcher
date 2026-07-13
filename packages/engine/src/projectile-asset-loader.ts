import { parseWithSchema, SchemaValidationError } from "./schema.js";
import { ProjectileSpecSchema, type ProjectileSpec } from "./projectile-spec.js";

/**
 * Validates raw (e.g. deserialized-JSON) data as a `ProjectileSpec` (§3.9),
 * throwing `SchemaValidationError` with a useful, path-qualified message on
 * failure. `projectile-assets.ts` runs every shipped asset through this at
 * module-evaluation time — i.e. the moment the catalog is imported, which in
 * practice is build/test time, not first simulation use — so a corrupt
 * fixture fails loudly and immediately rather than surfacing downstream as a
 * confusing runtime NaN.
 */
export function loadProjectileSpec(data: unknown): ProjectileSpec {
  return parseWithSchema(ProjectileSpecSchema, data);
}

export { SchemaValidationError };
