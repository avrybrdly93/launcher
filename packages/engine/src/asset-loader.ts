import { parseWithSchema, SchemaValidationError } from "./schema.js";
import { ProjectileSpecSchema, type ProjectileSpec } from "./projectile-spec.js";

/**
 * Loads and validates a raw (untyped) collection of projectile assets
 * against `ProjectileSpecSchema` (§3.9) — the same check a build-time asset
 * pipeline runs before assets reach the app bundle. `projectile-assets.ts`
 * calls this at module-evaluation time on its own literals, so a corrupt
 * asset fails the build immediately rather than surfacing as a runtime
 * crash deep in the UI. Fails loudly and specifically: which asset (by
 * index, and by id once the id field itself parses) and why.
 */
export function loadProjectileAssets(raw: readonly unknown[]): readonly ProjectileSpec[] {
  const specs: ProjectileSpec[] = [];
  const seenIds = new Set<string>();

  raw.forEach((entry, index) => {
    let spec: ProjectileSpec;
    try {
      spec = parseWithSchema(ProjectileSpecSchema, entry);
    } catch (err) {
      if (err instanceof SchemaValidationError) {
        throw new SchemaValidationError(
          `Projectile asset at index ${index} is invalid: ${err.message}`,
          err.issues,
        );
      }
      throw err;
    }
    if (seenIds.has(spec.id)) {
      throw new SchemaValidationError(
        `Projectile asset at index ${index} has duplicate id "${spec.id}"`,
        [],
      );
    }
    seenIds.add(spec.id);
    specs.push(spec);
  });

  return specs;
}
