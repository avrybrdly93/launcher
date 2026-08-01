import type { DragCoefficientModel } from "./drag-coefficient.js";
import type { LiftCoefficientModel } from "./lift-coefficient.js";
import type { Vec3 } from "./vec3.js";

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
  /**
   * Spin axis direction ω̂ (§3.6, eq. 3.15), read only by the dim-6 spatial
   * model's full 3D Magnus term (P4.24) -- the 2D `MagnusForce` in
   * `forces.ts` ignores this field entirely and always uses the implicit
   * ê_z axis. Need not be pre-normalized (the consumer normalizes it).
   * Omit to default to ê_z = (0,0,1), which reduces the 3D term exactly to
   * the 2D formula (backspin/topspin only, no sidespin).
   */
  readonly spinAxis?: Vec3;
}

/** Input to {@link createSphericalProjectileParams}: mass/radius plus the coefficient models. */
export interface SphericalProjectileInput {
  readonly mass: number;
  readonly radius: number;
  readonly dragCoefficient: DragCoefficientModel;
  readonly liftCoefficient?: LiftCoefficientModel | undefined;
  readonly spin?: number | undefined;
  readonly spinAxis?: Vec3 | undefined;
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
    ...(input.spinAxis !== undefined ? { spinAxis: input.spinAxis } : {}),
  };
}
