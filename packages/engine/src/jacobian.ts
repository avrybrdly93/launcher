import type { EvalContext } from "./eval-context.js";

const X = 0;
const Y = 1;
const VX = 2;
const VY = 3;
const DIM = 4;

/**
 * Below this relative-velocity magnitude, the drag-block Jacobian entries
 * are set to exactly 0 rather than evaluated through 1/speed. The formula
 * has a removable singularity there: |u|*u is C1 with a zero derivative at
 * u=0 (§3.8), so 0 is the analytically correct limit, not an approximation.
 */
const DRAG_JACOBIAN_SPEED_EPS = 1e-9;

/**
 * Analytic Jacobian ∂f/∂y (row-major 4x4, 16 entries) for the gravity +
 * quadratic-drag planar system (eq. 3.18 with Magnus omitted) — P1.22.
 *
 * Scope: the sampled environment (ρ, wind, g) is treated as *frozen* at the
 * evaluation point — differentiated only through its explicit appearance in
 * the drag term via v_rel, never through position/time dependence of the
 * atmosphere, gravity, or wind models themselves. This is exact whenever
 * those models are spatially uniform (the default `ConstantAtmosphere` +
 * non-altitude-dependent `UniformGravity` + steady/uniform wind); for
 * position- or time-varying environments use the finite-difference fallback
 * (P1.23) instead. `Cd` is likewise evaluated (not differentiated) at the
 * current Reynolds/Mach — exact for `ConstantCd`, an approximation for
 * Reynolds-dependent tables.
 *
 * Gravity and buoyancy (if present) contribute nothing to this Jacobian:
 * both are independent of state under the frozen-environment assumption, so
 * only the quadratic-drag term shapes the velocity block.
 */
export function gravityQuadraticDragJacobian(
  t: number,
  y: Float64Array,
  ctx: EvalContext,
  out: Float64Array,
): void {
  const vx = y[VX]!;
  const vy = y[VY]!;

  ctx.environment.sample(t, y[X]!, y[Y]!, ctx.env);

  const ux = vx - ctx.env.wx;
  const uy = vy - ctx.env.wy;
  const speed = Math.hypot(ux, uy);

  out.fill(0);
  out[X * DIM + VX] = 1; // d(dx/dt)/d(vx)
  out[Y * DIM + VY] = 1; // d(dy/dt)/d(vy)

  if (speed < DRAG_JACOBIAN_SPEED_EPS) {
    return;
  }

  const re = (ctx.env.rho * speed * (2 * ctx.params.radius)) / ctx.env.eta;
  const mach = ctx.env.c > 0 ? speed / ctx.env.c : 0;
  const cd = ctx.params.dragCoefficient.cd(re, mach);
  const kd = (0.5 * ctx.env.rho * cd * ctx.params.area) / ctx.params.mass;

  const dSpeedDVx = ux / speed;
  const dSpeedDVy = uy / speed;

  // Symmetric drag block: J = -kd*(speed*I + u⊗u/speed).
  out[VX * DIM + VX] = -kd * (ux * dSpeedDVx + speed);
  out[VX * DIM + VY] = -kd * ux * dSpeedDVy;
  out[VY * DIM + VX] = -kd * uy * dSpeedDVx;
  out[VY * DIM + VY] = -kd * (uy * dSpeedDVy + speed);
}

/**
 * Binds `gravityQuadraticDragJacobian` to a fixed `EvalContext`, matching
 * `Model.jacobian`'s `(t, y, out) => void` shape (§3.7) — that interface
 * carries no `ctx` parameter, unlike `rhs`, since a model's analytic
 * Jacobian (when it has one) is tied to one params/environment pair for the
 * whole integration rather than varying per call.
 */
export function createGravityQuadraticDragJacobian(
  ctx: EvalContext,
): (t: number, y: Float64Array, out: Float64Array) => void {
  return (t, y, out) => gravityQuadraticDragJacobian(t, y, ctx, out);
}
