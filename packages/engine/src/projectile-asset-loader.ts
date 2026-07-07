import { parseWithSchema, SchemaValidationError } from "./schema.js";
import { projectileSpecSchema, type ProjectileSpec } from "./projectile-spec.js";

/** Best-effort label for a corrupt fixture in error messages: its declared id, or its array index. */
function describeFixture(raw: unknown, index: number): string {
  if (typeof raw === "object" && raw !== null && "id" in raw && typeof raw.id === "string") {
    return `'${raw.id}'`;
  }
  return `at index ${index}`;
}

/**
 * Validates a raw list of projectile fixtures against `projectileSpecSchema`
 * (§3.9: "the asset loader validates schemas at build time"). Throws on the
 * first invalid fixture, with the fixture identified by id (or index, if it
 * doesn't even have one) and the underlying zod issues — a corrupt fixture
 * must fail loudly, not silently produce a broken ProjectileSpec.
 */
export function loadProjectileAssets(raw: readonly unknown[]): readonly ProjectileSpec[] {
  return raw.map((fixture, index) => {
    try {
      return parseWithSchema(projectileSpecSchema, fixture);
    } catch (err) {
      if (err instanceof SchemaValidationError) {
        throw new SchemaValidationError(
          `Projectile asset ${describeFixture(fixture, index)} failed validation: ${err.message}`,
          err.issues,
        );
      }
      throw err;
    }
  });
}
