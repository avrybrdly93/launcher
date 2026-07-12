import { parseWithSchema } from "./schema.js";
import { ProjectileSpecSchema, type ProjectileSpec } from "./projectile-spec.js";

/** Validates one raw asset record against `ProjectileSpecSchema`. */
export function loadProjectileAsset(data: unknown): ProjectileSpec {
  return parseWithSchema(ProjectileSpecSchema, data);
}

/**
 * Validates a batch of raw asset records — the "build-time schema
 * validation" of P1.26: run over the data-asset source list at module load
 * (see `projectile-assets.ts`) so a corrupt asset fails the build/test run
 * immediately rather than surfacing as a runtime bug in the UI. On failure,
 * folds the offending index and `id` (if present) into the error message so
 * a corrupt fixture is easy to locate, rather than surfacing a bare zod
 * issue list with no indication of which asset it came from.
 */
export function loadProjectileAssets(rawAssets: readonly unknown[]): ProjectileSpec[] {
  return rawAssets.map((raw, index) => {
    try {
      return loadProjectileAsset(raw);
    } catch (error) {
      const id =
        typeof raw === "object" && raw !== null && "id" in raw
          ? String((raw as { id: unknown }).id)
          : undefined;
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Projectile asset at index ${index}${id !== undefined ? ` (id: "${id}")` : ""} failed validation: ${reason}`,
      );
    }
  });
}
