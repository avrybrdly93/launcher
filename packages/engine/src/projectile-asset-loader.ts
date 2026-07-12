import { ProjectileSpecSchema, type ProjectileSpec } from "./projectile-spec.js";
import { parseWithSchema } from "./schema.js";

/**
 * Asset loader (P1.26): validates one candidate fixture against
 * `ProjectileSpecSchema` at build/import time, throwing a
 * `SchemaValidationError` naming every corrupt field rather than letting bad
 * data reach the physics engine silently.
 */
export function loadProjectileSpec(data: unknown): ProjectileSpec {
  return parseWithSchema(ProjectileSpecSchema, data);
}

/** Validates a batch of candidate fixtures, failing fast on the first corrupt one. */
export function loadProjectileAssets(data: readonly unknown[]): readonly ProjectileSpec[] {
  return data.map((entry) => loadProjectileSpec(entry));
}
