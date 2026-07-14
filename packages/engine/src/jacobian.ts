import type { EvalContext } from "./eval-context.js";
import type { ForceModel } from "./forces.js";

const X = 0;
const Y = 1;
const VX = 2;
const VY = 3;
const DIM = 4;

/**
 * Below this relative speed, drag's contribution to J is treated as exactly
 * zero rather than 0/0: F_drag ~ O(|v_rel|^2) near v_rel=0, so its true
 * derivative there is 0, matching what a central difference measures.
 */
const SPEED_EPS = 1e-9;

/**
 * Analytic J = df/dy (row-major, dim*dim) for the gravity + quadratic-drag
 * rhs (eq. 3.18 with the Magnus term dropped): f = (vx, vy, -kd*u*ux, -g -
 * kd*u*uy) with u_rel = v - w, u = |u_rel|, kd = rho*Cd*A/(2m).
 *
 * Valid whenever the environment is spatially uniform (constant atmosphere,
 * non-altitude-dependent gravity, wind independent of position) and Cd does
 * not vary with Re/Mach at the evaluated point — i.e. the platform's default
 * scenario configuration. Under that assumption the position rows are
 * exactly zero; P1.23's finite-difference fallback covers the general case
 * (altitude-dependent gravity, tabulated Cd(Re), position-dependent wind).
 *
 * Writes into `out` in place — no allocation, so this stays safe to call
 * from an implicit stepper's Newton hot path (ADR-004).
 */
export function gravityQuadraticDragJacobian(
  t: number,
  y: Float64Array,
  out: Float64Array,
  ctx: EvalContext,
): void {
  const x = y[X]!;
  const yPos = y[Y]!;
  const vx = y[VX]!;
  const vy = y[VY]!;

  ctx.environment.sample(t, x, yPos, ctx.env);

  const ux = vx - ctx.env.wx;
  const uy = vy - ctx.env.wy;
  const u = Math.hypot(ux, uy);
  const re = (ctx.env.rho * u * (2 * ctx.params.radius)) / ctx.env.eta;
  const mach = ctx.env.c > 0 ? u / ctx.env.c : 0;
  const cd = ctx.params.dragCoefficient.cd(re, mach);
  const kd = (ctx.env.rho * cd * ctx.params.area) / (2 * ctx.params.mass);

  out.fill(0, 0, DIM * DIM);
  out[X * DIM + VX] = 1;
  out[Y * DIM + VY] = 1;

  if (u > SPEED_EPS) {
    out[VX * DIM + VX] = -kd * (u + (ux * ux) / u);
    out[VX * DIM + VY] = -kd * ((ux * uy) / u);
    out[VY * DIM + VX] = -kd * ((ux * uy) / u);
    out[VY * DIM + VY] = -kd * (u + (uy * uy) / u);
  }
}

/** True iff `registry` (sorted per createForceRegistry) is exactly gravity+quadratic-drag. */
export function isGravityQuadraticDragOnly(registry: readonly ForceModel[]): boolean {
  return (
    registry.length === 2 && registry[0]!.id === "drag-quadratic" && registry[1]!.id === "gravity"
  );
}
