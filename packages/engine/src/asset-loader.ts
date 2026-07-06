import { ConstantCd, TabulatedReynoldsCd } from "./drag-coefficient.js";
import { SaturatingLiftCoefficient } from "./lift-coefficient.js";
import {
  PROJECTILE_ASSETS,
  PROJECTILE_SPEC_SCHEMA,
  type ProjectileSpec,
} from "./projectile-assets.js";
import { createSphericalProjectileParams, type ProjectileParams } from "./projectile-params.js";
import { parseWithSchema, SchemaValidationError } from "./schema.js";

/** Validates one raw asset against {@link PROJECTILE_SPEC_SCHEMA}, throwing a useful error on failure. */
export function loadProjectileSpec(raw: unknown): ProjectileSpec {
  return parseWithSchema(PROJECTILE_SPEC_SCHEMA, raw);
}

/**
 * Validates a whole batch of raw assets, tagging any failure with its index
 * so a corrupt fixture in a large table is easy to locate.
 */
export function loadProjectileSpecs(rawAssets: readonly unknown[]): readonly ProjectileSpec[] {
  return rawAssets.map((raw, index) => {
    try {
      return loadProjectileSpec(raw);
    } catch (err) {
      if (err instanceof SchemaValidationError) {
        throw new SchemaValidationError(
          `Projectile asset at index ${index} failed validation: ${err.message}`,
          err.issues,
        );
      }
      throw err;
    }
  });
}

/** Resolves a validated {@link ProjectileSpec} into the live `ProjectileParams` the engine consumes. */
export function resolveProjectileParams(spec: ProjectileSpec): ProjectileParams {
  const dragCoefficient =
    spec.dragCoefficient.kind === "constant"
      ? new ConstantCd(spec.dragCoefficient.value)
      : new TabulatedReynoldsCd();
  const liftCoefficient = spec.liftCoefficient
    ? new SaturatingLiftCoefficient(spec.liftCoefficient.maxCl, spec.liftCoefficient.slope)
    : undefined;

  return createSphericalProjectileParams({
    mass: spec.mass,
    radius: spec.radius,
    dragCoefficient,
    ...(liftCoefficient !== undefined ? { liftCoefficient } : {}),
  });
}

/**
 * `PROJECTILE_ASSETS` validated at build time (module load), rather than
 * lazily at first use — a corrupt bundled asset fails immediately with a
 * clear error instead of surfacing as a confusing runtime bug much later.
 */
export const VALIDATED_PROJECTILE_ASSETS: readonly ProjectileSpec[] =
  loadProjectileSpecs(PROJECTILE_ASSETS);
