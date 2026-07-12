import { ConstantCd, type DragCoefficientModel } from "./drag-coefficient.js";
import { SaturatingLiftCoefficient, type LiftCoefficientModel } from "./lift-coefficient.js";
import { createSphericalProjectileParams, type ProjectileParams } from "./projectile-params.js";
import {
  parseProjectileSpec,
  type DragCoefficientSpec,
  type LiftCoefficientSpec,
  type ProjectileSpec,
} from "./projectile-spec.js";

function resolveDragCoefficient(spec: DragCoefficientSpec): DragCoefficientModel {
  switch (spec.kind) {
    case "constant":
      return new ConstantCd(spec.cd);
  }
}

function resolveLiftCoefficient(
  spec: LiftCoefficientSpec | undefined,
): LiftCoefficientModel | undefined {
  if (!spec) return undefined;
  switch (spec.kind) {
    case "saturating":
      return new SaturatingLiftCoefficient(spec.maxCl, spec.slope);
  }
}

/**
 * Parses and validates a raw projectile asset — e.g. a JSON fixture read at
 * build time — against `ProjectileSpecSchema` (P1.26). Throws
 * `SchemaValidationError` with a field-level message on a corrupt fixture;
 * this is also what runs at module-eval time for every entry in
 * `PROJECTILE_ASSETS` (P1.25), so a broken built-in asset fails the build
 * immediately rather than surfacing as a runtime bug.
 */
export function loadProjectileSpec(data: unknown): ProjectileSpec {
  return parseProjectileSpec(data);
}

/** Resolves a validated `ProjectileSpec`'s declarative model choices into live `ProjectileParams`. */
export function resolveProjectileParams(spec: ProjectileSpec): ProjectileParams {
  const liftCoefficient = resolveLiftCoefficient(spec.liftCoefficient);
  return createSphericalProjectileParams({
    mass: spec.mass,
    radius: spec.radius,
    dragCoefficient: resolveDragCoefficient(spec.dragCoefficient),
    ...(liftCoefficient !== undefined ? { liftCoefficient } : {}),
  });
}

/** Validates a raw asset and resolves it straight through to `ProjectileParams` in one step. */
export function loadProjectileParams(data: unknown): ProjectileParams {
  return resolveProjectileParams(loadProjectileSpec(data));
}
