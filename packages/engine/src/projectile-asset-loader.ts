import { parseWithSchema } from "./schema.js";
import { ProjectileSpecSchema, type ProjectileSpec } from "./projectile-spec.js";
import { ConstantCd, TabulatedReynoldsCd } from "./drag-coefficient.js";
import { SaturatingLiftCoefficient } from "./lift-coefficient.js";
import { createSphericalProjectileParams, type ProjectileParams } from "./projectile-params.js";

/** Validates raw (e.g. parsed-JSON) data as a `ProjectileSpec`, throwing `SchemaValidationError` with a useful message on failure. */
export function loadProjectileSpec(data: unknown): ProjectileSpec {
  return parseWithSchema(ProjectileSpecSchema, data);
}

/**
 * Resolves an already-valid `ProjectileSpec` into a runtime `ProjectileParams`
 * with live model instances. `spinDecayTau` has no home yet — it is consumed
 * once the spin-decay model dimension (P4.07) exists — so it is intentionally
 * dropped here rather than smuggled onto a field ProjectileParams doesn't have.
 */
export function resolveProjectileParams(spec: ProjectileSpec): ProjectileParams {
  const dragCoefficient =
    spec.dragModel === "constant" ? new ConstantCd(spec.constantCd) : new TabulatedReynoldsCd();
  const liftCoefficient =
    spec.liftModel === "saturating" ? new SaturatingLiftCoefficient() : undefined;

  return createSphericalProjectileParams({
    mass: spec.mass,
    radius: spec.radius,
    dragCoefficient,
    liftCoefficient,
  });
}

/** Validates and resolves raw data straight into a runtime `ProjectileParams` in one step. */
export function loadProjectileParams(data: unknown): ProjectileParams {
  return resolveProjectileParams(loadProjectileSpec(data));
}
