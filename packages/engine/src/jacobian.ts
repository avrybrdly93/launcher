import type { EvalContext } from "./eval-context.js";

const X = 0;
const Y = 1;
const VX = 2;
const VY = 3;
const N = 4;

const DRAG_SPEED_EPS = 1e-9;

/**
 * Analytic Jacobian J = df/dy (row-major N*N, `out[i*N+j]` = df_i/dy_j) for
 * the planar projectile RHS (3.17-3.18) restricted to gravity + quadratic
 * drag only (no Magnus, no linear drag, no buoyancy) — the P1.22 scope.
 *
 * F/m = -k_d*u*(vx,vy) with u=|v_rel|, k_d = rho*Cd*A/(2m), is the gradient
 * of the potential -(k_d/3)*u^3, so the drag block is symmetric; this is a
 * useful cross-check on the derivation, not something the guard below needs.
 * At u -> 0 each partial derivative's limit is 0 (F ~ O(u^2)), so u below
 * DRAG_SPEED_EPS short-circuits to the exact limiting (zero) drag block
 * rather than evaluating the removable 0/0 singularity in ux*ux/u.
 *
 * Assumes rho/g/wind are position- and time-independent at the evaluated
 * point, true of every Atmosphere/GravityModel/WindModel registered so far
 * (position-dependent variants land in P1.27/P1.29-33), and that the drag
 * coefficient model is evaluated (not differentiated) at the local Re/Mach —
 * exact whenever `dragCoefficient` doesn't vary with Re/Mach (e.g. ConstantCd).
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
  const u = Math.hypot(ux, uy);
  const re = (ctx.env.rho * u * (2 * ctx.params.radius)) / ctx.env.eta;
  const mach = ctx.env.c > 0 ? u / ctx.env.c : 0;
  const cd = ctx.params.dragCoefficient.cd(re, mach);
  const kd = (0.5 * ctx.env.rho * cd * ctx.params.area) / ctx.params.mass;

  out.fill(0);
  out[X * N + VX] = 1;
  out[Y * N + VY] = 1;

  if (u < DRAG_SPEED_EPS) {
    return;
  }

  out[VX * N + VX] = -kd * (u + (ux * ux) / u);
  out[VX * N + VY] = (-kd * (ux * uy)) / u;
  out[VY * N + VX] = (-kd * (ux * uy)) / u;
  out[VY * N + VY] = -kd * (u + (uy * uy) / u);
}
