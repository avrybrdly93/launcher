import { ConstantCd, TabulatedReynoldsCd } from "./drag-coefficient.js";
import { SaturatingLiftCoefficient } from "./lift-coefficient.js";
import { createSphericalProjectileParams, type ProjectileParams } from "./projectile-params.js";
import { projectileSpecSchema, type ProjectileSpec } from "./projectile-spec.js";
import { PROJECTILE_ASSETS } from "./projectile-assets.js";
import { parseWithSchema, SchemaValidationError } from "./schema.js";

/**
 * Validates one raw asset record against `projectileSpecSchema` (§3.9),
 * throwing a `SchemaValidationError` with a field-level message on failure.
 */
export function loadProjectileSpec(data: unknown): ProjectileSpec {
  return parseWithSchema(projectileSpecSchema, data);
}

/**
 * Validates a list of raw asset records — the build-time gate the blueprint
 * calls for (§3.9: "the asset loader validates schemas at build time").
 * Re-throws with the offending index prefixed so a corrupt fixture is easy
 * to locate in a large asset table.
 */
export function loadProjectileSpecs(data: readonly unknown[]): ProjectileSpec[] {
  return data.map((item, index) => {
    try {
      return loadProjectileSpec(item);
    } catch (err) {
      if (err instanceof SchemaValidationError) {
        throw new SchemaValidationError(`asset[${index}]: ${err.message}`, err.issues);
      }
      throw err;
    }
  });
}

/** Builds a live `ProjectileParams` from a validated `ProjectileSpec` (spin decay is not yet wired — P1.37+). */
export function projectileParamsFromSpec(spec: ProjectileSpec): ProjectileParams {
  const dragCoefficient =
    spec.dragModel.kind === "constant"
      ? new ConstantCd(spec.dragModel.value)
      : new TabulatedReynoldsCd();
  const liftCoefficient =
    spec.liftModel.kind === "saturating" ? new SaturatingLiftCoefficient() : undefined;

  return createSphericalProjectileParams({
    mass: spec.mass,
    radius: spec.radius,
    dragCoefficient,
    ...(liftCoefficient !== undefined ? { liftCoefficient } : {}),
  });
}

/** `PROJECTILE_ASSETS`, validated at import time — a build fails if any asset is malformed. */
export const VALIDATED_PROJECTILE_ASSETS: readonly ProjectileSpec[] =
  loadProjectileSpecs(PROJECTILE_ASSETS);
