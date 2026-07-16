import { SchemaValidationError, parseWithSchema } from "./schema.js";
import { ProjectileSpecSchema, type ProjectileSpec } from "./projectile-spec.js";

/**
 * Validates one raw asset record (typically an imported JSON fixture)
 * against `ProjectileSpecSchema`, re-throwing with `label` (e.g. the source
 * file name) prefixed so a corrupt fixture's error points at *which* asset
 * failed and *why* (§3.9's "build-time schema validation").
 */
export function loadProjectileSpec(raw: unknown, label: string): ProjectileSpec {
  try {
    return parseWithSchema(ProjectileSpecSchema, raw);
  } catch (err) {
    if (err instanceof SchemaValidationError) {
      throw new SchemaValidationError(
        `Invalid projectile asset "${label}": ${err.message}`,
        err.issues,
      );
    }
    throw err;
  }
}

/**
 * Validates a batch of raw asset records, failing on the first invalid one.
 * Assets are meant to be imported (JSON modules resolve at compile time via
 * `resolveJsonModule`) and validated eagerly at module load, so a corrupt
 * asset breaks the build/import rather than surfacing as a runtime surprise
 * deep in the UI.
 */
export function loadProjectileSpecs(
  entries: readonly { readonly label: string; readonly data: unknown }[],
): ProjectileSpec[] {
  return entries.map(({ label, data }) => loadProjectileSpec(data, label));
}
