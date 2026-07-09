import type { DragCoefficientModel } from "./drag-coefficient.js";
import { ConstantCd, TabulatedReynoldsCd } from "./drag-coefficient.js";
import type { LiftCoefficientModel } from "./lift-coefficient.js";
import { SaturatingLiftCoefficient } from "./lift-coefficient.js";
import { createSphericalProjectileParams, type ProjectileParams } from "./projectile-params.js";
import type { DragModelSpec, LiftModelSpec } from "./projectile-spec.js";
import { ProjectileSpecSchema } from "./projectile-spec.js";
import { parseWithSchema } from "./schema.js";

function resolveDragModel(spec: DragModelSpec): DragCoefficientModel {
  switch (spec.kind) {
    case "constant":
      return new ConstantCd(spec.cd);
    case "tabulated-reynolds":
      return new TabulatedReynoldsCd();
  }
}

function resolveLiftModel(spec: LiftModelSpec): LiftCoefficientModel {
  switch (spec.kind) {
    case "saturating":
      return new SaturatingLiftCoefficient(spec.maxCl, spec.slope);
  }
}

/**
 * Validates `data` against `ProjectileSpecSchema` (throwing `SchemaValidationError`
 * with a per-field message on failure) and resolves the validated spec's
 * serializable drag/lift model choice into concrete `ProjectileParams` (P1.26).
 * This is the only place `ProjectileSpec` data becomes engine behavior.
 */
export function loadProjectileSpec(data: unknown): ProjectileParams {
  const spec = parseWithSchema(ProjectileSpecSchema, data);
  return createSphericalProjectileParams({
    mass: spec.mass,
    radius: spec.radius,
    dragCoefficient: resolveDragModel(spec.dragModel),
    ...(spec.liftModel ? { liftCoefficient: resolveLiftModel(spec.liftModel) } : {}),
  });
}
