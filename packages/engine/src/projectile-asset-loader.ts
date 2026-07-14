import { parseWithSchema } from "./schema.js";
import { ProjectileSpecSchema, type ProjectileSpec } from "./projectile-spec.js";

/**
 * Validates one raw asset (e.g. parsed JSON) against `ProjectileSpecSchema`,
 * throwing a `SchemaValidationError` with a per-field message on failure
 * (P1.26). This is the single choke point every `ProjectileSpec` — built-in
 * or user-supplied — must pass through before the engine touches it.
 */
export function loadProjectileAsset(data: unknown): ProjectileSpec {
  return parseWithSchema(ProjectileSpecSchema, data);
}

/** Validates a batch of raw assets; fails on the first invalid entry (see its error's `issues` for detail). */
export function loadProjectileAssets(data: readonly unknown[]): ProjectileSpec[] {
  return data.map(loadProjectileAsset);
}
