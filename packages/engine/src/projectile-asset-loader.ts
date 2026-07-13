import type { DragCoefficientModel } from "./drag-coefficient.js";
import { ConstantCd, TabulatedReynoldsCd } from "./drag-coefficient.js";
import type { LiftCoefficientModel } from "./lift-coefficient.js";
import { SaturatingLiftCoefficient } from "./lift-coefficient.js";
import type { ProjectileParams } from "./projectile-params.js";
import { createSphericalProjectileParams } from "./projectile-params.js";
import type {
  DragCoefficientSpec,
  LiftCoefficientSpec,
  ProjectileSpec,
} from "./projectile-spec.js";
import { ProjectileSpecSchema } from "./projectile-spec.js";
import { parseWithSchema } from "./schema.js";

function buildDragCoefficient(spec: DragCoefficientSpec): DragCoefficientModel {
  switch (spec.kind) {
    case "constant":
      return new ConstantCd(spec.cd);
    case "tabulated-reynolds":
      return new TabulatedReynoldsCd();
  }
}

function buildLiftCoefficient(
  spec: LiftCoefficientSpec | undefined,
): LiftCoefficientModel | undefined {
  if (!spec) return undefined;
  switch (spec.kind) {
    case "saturating":
      return new SaturatingLiftCoefficient(spec.maxCl, spec.slope);
  }
}

/**
 * Validates `data` against `ProjectileSpecSchema` — throwing a
 * `SchemaValidationError` with a field-path-annotated message on failure —
 * then builds the runtime `ProjectileParams` (concrete
 * DragCoefficientModel/LiftCoefficientModel instances) it describes (P1.26).
 */
export function loadProjectileAsset(data: unknown): {
  spec: ProjectileSpec;
  params: ProjectileParams;
} {
  const spec = parseWithSchema(ProjectileSpecSchema, data);
  const params = createSphericalProjectileParams({
    mass: spec.mass,
    radius: spec.radius,
    dragCoefficient: buildDragCoefficient(spec.dragCoefficient),
    liftCoefficient: buildLiftCoefficient(spec.liftCoefficient),
    spin: spec.spin,
  });
  return { spec, params };
}
