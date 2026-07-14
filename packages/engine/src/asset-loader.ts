import { ProjectileSpecSchema, type ProjectileSpec } from "./projectile-spec.js";
import { SchemaValidationError } from "./schema.js";

/**
 * Validates a raw (e.g. deserialized-JSON) array of projectile asset
 * fixtures against `ProjectileSpecSchema`, run eagerly wherever the asset
 * list is imported so a corrupt fixture fails fast with a useful,
 * per-element error rather than surfacing as a confusing runtime NaN deep
 * in the physics (§3.9 asset loader).
 */
export function loadProjectileAssets(raw: unknown): readonly ProjectileSpec[] {
  if (!Array.isArray(raw)) {
    throw new SchemaValidationError("Projectile asset list must be an array", []);
  }

  const specs: ProjectileSpec[] = [];
  for (let i = 0; i < raw.length; i++) {
    const result = ProjectileSpecSchema.safeParse(raw[i]);
    if (!result.success) {
      const idHint = isRecordWithId(raw[i]) ? ` (id: ${JSON.stringify(raw[i].id)})` : "";
      throw new SchemaValidationError(
        `Projectile asset at index ${i}${idHint} failed validation: ${result.error.issues
          .map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`)
          .join("; ")}`,
        result.error.issues,
      );
    }
    specs.push(result.data);
  }

  const seenIds = new Set<string>();
  for (const spec of specs) {
    if (seenIds.has(spec.id)) {
      throw new SchemaValidationError(`Duplicate projectile asset id: ${spec.id}`, []);
    }
    seenIds.add(spec.id);
  }

  return specs;
}

function isRecordWithId(value: unknown): value is { id: unknown } {
  return typeof value === "object" && value !== null && "id" in value;
}
