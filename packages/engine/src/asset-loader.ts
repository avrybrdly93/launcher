import { parseWithSchema, SchemaValidationError } from "./schema.js";
import { projectileSpecSchema, type ProjectileSpec } from "./projectile-spec.js";

function assetLabel(entry: unknown, index: number): string {
  if (
    typeof entry === "object" &&
    entry !== null &&
    "id" in entry &&
    typeof entry.id === "string"
  ) {
    return `"${entry.id}"`;
  }
  return `#${index}`;
}

/**
 * Validates a list of raw (JSON-sourced or otherwise untyped) projectile
 * records against `projectileSpecSchema` (§3.9). Every data asset module
 * runs its fixtures through this at import time, which is Ballista's
 * analog of "build-time" validation since assets ship as TS/JSON literals
 * rather than a separate compiled data step. Throws `SchemaValidationError`
 * naming the offending asset's id/index and the failing field(s) on the
 * first invalid or duplicate-id entry.
 */
export function loadProjectileAssets(raw: readonly unknown[]): ProjectileSpec[] {
  const specs: ProjectileSpec[] = [];
  const seenIds = new Set<string>();
  raw.forEach((entry, index) => {
    let spec: ProjectileSpec;
    try {
      spec = parseWithSchema(projectileSpecSchema, entry);
    } catch (err) {
      if (err instanceof SchemaValidationError) {
        throw new SchemaValidationError(
          `Invalid projectile asset ${assetLabel(entry, index)} (index ${index}): ${err.message}`,
          err.issues,
        );
      }
      throw err;
    }
    if (seenIds.has(spec.id)) {
      throw new SchemaValidationError(
        `Duplicate projectile asset id "${spec.id}" (index ${index})`,
        [],
      );
    }
    seenIds.add(spec.id);
    specs.push(spec);
  });
  return specs;
}
