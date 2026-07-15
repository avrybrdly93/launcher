import { ConstantCd, TabulatedReynoldsCd } from "./drag-coefficient.js";
import { SaturatingLiftCoefficient } from "./lift-coefficient.js";
import { PROJECTILE_ASSETS } from "./projectile-assets.js";
import { createSphericalProjectileParams, type ProjectileParams } from "./projectile-params.js";
import { PROJECTILE_SPEC_SCHEMA, type ProjectileSpec } from "./projectile-spec.js";
import { parseWithSchema } from "./schema.js";

/** Validates one raw fixture as a `ProjectileSpec`, throwing `SchemaValidationError` on failure. */
export function loadProjectileSpec(data: unknown): ProjectileSpec {
  return parseWithSchema(PROJECTILE_SPEC_SCHEMA, data);
}

/** Validates a list of raw fixtures; throws on the first invalid one. */
export function loadProjectileSpecs(data: readonly unknown[]): readonly ProjectileSpec[] {
  return data.map(loadProjectileSpec);
}

/**
 * Materializes a validated `ProjectileSpec`'s drag/lift-coefficient specs
 * into live model instances and derives area/volume — the bridge from the
 * serialized asset to the `ProjectileParams` a `Model`/`ForceModel` reads.
 * `spinDecayTau` has no home in `ProjectileParams` yet (spin decay is an
 * unmodeled extra state dimension per §3.6, added when that phase lands),
 * so it is intentionally dropped here rather than threaded through.
 */
export function projectileParamsFromSpec(spec: ProjectileSpec): ProjectileParams {
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
    liftCoefficient,
  });
}

/**
 * `PROJECTILE_ASSETS` validated against `PROJECTILE_SPEC_SCHEMA` at module
 * load time (P1.26) — a corrupt fixture fails as soon as this module (and
 * therefore the engine build) is loaded, not on first use deep in a
 * scenario run.
 */
export const VALIDATED_PROJECTILE_ASSETS: readonly ProjectileSpec[] =
  loadProjectileSpecs(PROJECTILE_ASSETS);
