import type { EvalContext } from "./eval-context.js";
import { norm } from "./vec2.js";

const X = 0;
const Y = 1;
const VX = 2;
const VY = 3;

const DRAG_JACOBIAN_SPEED_EPS = 1e-9;

/**
 * Analytic Jacobian J = df/dy (eq. 3.17-3.18) for the planar projectile
 * model restricted to gravity + quadratic drag only (no Magnus). Assumes
 * the environment (g, rho, wind) and Cd are locally constant w.r.t. state
 * — true for the base ConstantAtmosphere/UniformGravity(non-altitude)/
 * ZeroWind/ConstantCd configuration. Altitude-dependent gravity, Cd(Re)
 * dependence, and position-varying wind fields are out of scope here; those
 * fall back to the finite-difference Jacobian (P1.23).
 *
 * `out` is row-major dim x dim (dim=4): out[4*i+j] = df_i/dy_j. Reuses
 * `ctx`'s scratch buffers, so this is zero-allocation on repeat calls.
 */
export function gravityQuadraticDragJacobian(
  t: number,
  y: Float64Array,
  ctx: EvalContext,
  out: Float64Array,
): void {
  const x = y[X]!;
  const yPos = y[Y]!;
  const vx = y[VX]!;
  const vy = y[VY]!;

  ctx.environment.sample(t, x, yPos, ctx.env);
  ctx.vRel[0] = vx - ctx.env.wx;
  ctx.vRel[1] = vy - ctx.env.wy;
  ctx.speedRel = norm(ctx.vRel);
  ctx.re = (ctx.env.rho * ctx.speedRel * (2 * ctx.params.radius)) / ctx.env.eta;
  ctx.mach = ctx.env.c > 0 ? ctx.speedRel / ctx.env.c : 0;

  out.fill(0);
  out[4 * X + VX] = 1; // dx/dvx
  out[4 * Y + VY] = 1; // dy/dvy

  const u = ctx.speedRel;
  if (u < DRAG_JACOBIAN_SPEED_EPS) return; // drag term's derivative -> 0 as u -> 0 (C1 kink, S3.8)

  const ux = ctx.vRel[0];
  const uy = ctx.vRel[1];
  const cd = ctx.params.dragCoefficient.cd(ctx.re, ctx.mach);
  const kd = (0.5 * ctx.env.rho * cd * ctx.params.area) / ctx.params.mass;

  out[4 * VX + VX] = (-kd * (ux * ux)) / u - kd * u;
  out[4 * VX + VY] = (-kd * (ux * uy)) / u;
  out[4 * VY + VX] = (-kd * (ux * uy)) / u;
  out[4 * VY + VY] = (-kd * (uy * uy)) / u - kd * u;
}
