import type { DragCoefficientModel } from "./drag-coefficient.js";
import type { LiftCoefficientModel } from "./lift-coefficient.js";

/**
 * Static, per-run physical properties of the projectile (§3.9). Unlike
 * EnvSample/EvalContext scratch buffers, these never change during an
 * integration and so are safe to read (never mutate) from any ForceModel.
 */
export interface ProjectileParams {
  readonly mass: number; // kg
  readonly radius: number; // m
  readonly area: number; // m^2, cross-sectional (pi*R^2 for spheres)
  readonly volume: number; // m^3 ((4/3)*pi*R^3 for spheres)
  readonly dragCoefficient: DragCoefficientModel;
  readonly liftCoefficient?: LiftCoefficientModel;
  /** Constant spin, rad/s. Positive = backspin for rightward motion (§3.6). Omit or 0 to disable Magnus. */
  readonly spin?: number;
}

/** Input to {@link createSphericalProjectileParams}: mass/radius plus the coefficient models. */
export interface SphericalProjectileInput {
  readonly mass: number;
  readonly radius: number;
  readonly dragCoefficient: DragCoefficientModel;
  readonly liftCoefficient?: LiftCoefficientModel | undefined;
  readonly spin?: number | undefined;
}

/** Derives area/volume for a spherical projectile from mass + radius. */
export function createSphericalProjectileParams(input: SphericalProjectileInput): ProjectileParams {
  const area = Math.PI * input.radius * input.radius;
  const volume = (4 / 3) * Math.PI * input.radius * input.radius * input.radius;
  return {
    mass: input.mass,
    radius: input.radius,
    area,
    volume,
    dragCoefficient: input.dragCoefficient,
    ...(input.liftCoefficient !== undefined ? { liftCoefficient: input.liftCoefficient } : {}),
    ...(input.spin !== undefined ? { spin: input.spin } : {}),
  };
}
