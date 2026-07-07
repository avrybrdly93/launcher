import { ConstantCd, TabulatedReynoldsCd, type DragCoefficientModel } from "./drag-coefficient.js";
import { SaturatingLiftCoefficient, type LiftCoefficientModel } from "./lift-coefficient.js";
import { createSphericalProjectileParams, type ProjectileParams } from "./projectile-params.js";
import { PROJECTILE_ASSETS } from "./projectile-assets.js";
import {
  ProjectileSpecSchema,
  type DragCoefficientSpec,
  type LiftCoefficientSpec,
  type ProjectileSpec,
} from "./projectile-spec.js";
import { parseWithSchema } from "./schema.js";

function instantiateDragCoefficient(spec: DragCoefficientSpec): DragCoefficientModel {
  switch (spec.type) {
    case "constant":
      return new ConstantCd(spec.value);
    case "tabulatedReynolds":
      return new TabulatedReynoldsCd(spec.table);
  }
}

function instantiateLiftCoefficient(spec: LiftCoefficientSpec): LiftCoefficientModel {
  // Only one lift-coefficient model exists so far (§3.6); the switch shape is
  // kept so a second entry in the discriminated union fails to compile here
  // rather than silently falling through.
  switch (spec.type) {
    case "saturating":
      return new SaturatingLiftCoefficient(spec.maxCl, spec.slope);
  }
}

/**
 * Converts an already-validated `ProjectileSpec` into runtime
 * `ProjectileParams` by instantiating the drag/lift model classes it names
 * (P1.26). `spinDecayTau` is not consumed here — spin decay is a
 * model-dimension feature (dim 5, `planarProjectileSpinModel`) landing in
 * P4.07, not a `ProjectileParams` field.
 */
export function projectileParamsFromSpec(spec: ProjectileSpec): ProjectileParams {
  return createSphericalProjectileParams({
    mass: spec.mass,
    radius: spec.radius,
    dragCoefficient: instantiateDragCoefficient(spec.dragCoefficient),
    liftCoefficient: spec.liftCoefficient
      ? instantiateLiftCoefficient(spec.liftCoefficient)
      : undefined,
  });
}

/**
 * Validates raw (e.g. JSON-parsed) data against `ProjectileSpecSchema` and
 * converts it into runtime `ProjectileParams`, throwing a
 * `SchemaValidationError` with a useful message on invalid data (P1.26's
 * "corrupt fixture rejected with useful error" criterion).
 */
export function loadProjectileAsset(data: unknown): ProjectileParams {
  const spec = parseWithSchema(ProjectileSpecSchema, data);
  return projectileParamsFromSpec(spec);
}

/**
 * Every shipped `PROJECTILE_ASSETS` entry, loaded and validated eagerly at
 * module-evaluation time rather than on first use — a corrupt asset fails
 * any build/test that imports this module, not just the user flow that
 * happens to select it (P1.26's "build-time" validation).
 */
export const PROJECTILE_LIBRARY: ReadonlyMap<string, ProjectileParams> = new Map(
  PROJECTILE_ASSETS.map((spec) => [spec.name, loadProjectileAsset(spec)]),
);
