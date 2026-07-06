import { ConstantCd, TabulatedReynoldsCd, type DragCoefficientModel } from "./drag-coefficient.js";
import { SaturatingLiftCoefficient, type LiftCoefficientModel } from "./lift-coefficient.js";
import {
  ProjectileSpecSchema,
  type LiftModelSpec,
  type ProjectileSpec,
} from "./projectile-spec.js";
import { createSphericalProjectileParams, type ProjectileParams } from "./projectile-params.js";
import { parseWithSchema } from "./schema.js";

function buildDragCoefficient(spec: ProjectileSpec): DragCoefficientModel {
  return spec.dragModel.kind === "constant"
    ? new ConstantCd(spec.dragModel.cd)
    : new TabulatedReynoldsCd();
}

function buildLiftCoefficient(spec: LiftModelSpec | undefined): LiftCoefficientModel | undefined {
  if (!spec) return undefined;
  return new SaturatingLiftCoefficient();
}

/** Turns an already-validated `ProjectileSpec` into the live `ProjectileParams` a `Model` consumes. */
export function projectileParamsFromSpec(spec: ProjectileSpec): ProjectileParams {
  return createSphericalProjectileParams({
    mass: spec.mass,
    radius: spec.radius,
    dragCoefficient: buildDragCoefficient(spec),
    liftCoefficient: buildLiftCoefficient(spec.liftModel),
    spin: spec.spin,
  });
}

/**
 * The asset loader (P1.26): validates arbitrary (e.g. user-supplied or
 * on-disk) data against `ProjectileSpecSchema` and, on success, builds the
 * corresponding runtime `ProjectileParams`. Throws `SchemaValidationError`
 * (from `parseWithSchema`) with a field-path-qualified message on invalid
 * input, rather than failing later with a confusing NaN or undefined deep in
 * a physics computation.
 */
export function loadProjectileAsset(data: unknown): ProjectileParams {
  const spec = parseWithSchema(ProjectileSpecSchema, data);
  return projectileParamsFromSpec(spec);
}
