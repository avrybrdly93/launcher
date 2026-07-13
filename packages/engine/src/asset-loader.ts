import { SchemaValidationError, parseWithSchema } from "./schema.js";
import { ProjectileSpecSchema, type ProjectileSpec } from "./projectile-spec.js";

function assetLabel(raw: unknown, index: number): string {
  if (typeof raw === "object" && raw !== null && "id" in raw && typeof raw.id === "string") {
    return `"${raw.id}" (index ${index})`;
  }
  return `index ${index}`;
}

/**
 * Validates a raw asset catalog (e.g. parsed from JSON) against
 * `ProjectileSpecSchema`, one entry at a time, so a single corrupt fixture
 * fails with a message naming *which* asset and *why* rather than a generic
 * "invalid data" (§3.9: "the asset loader validates schemas at build time").
 * Throws the first `SchemaValidationError` encountered, re-thrown with the
 * offending asset's id/index prefixed onto the message.
 */
export function loadProjectileAssets(rawAssets: readonly unknown[]): ProjectileSpec[] {
  return rawAssets.map((raw, index) => {
    try {
      return parseWithSchema(ProjectileSpecSchema, raw);
    } catch (err) {
      if (err instanceof SchemaValidationError) {
        throw new SchemaValidationError(
          `Asset ${assetLabel(raw, index)} failed validation: ${err.message}`,
          err.issues,
        );
      }
      throw err;
    }
  });
}
