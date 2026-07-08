import type { EvalContext } from "./eval-context.js";

const X = 0;
const Y = 1;
const VX = 2;
const VY = 3;
const DIM = 4;

/**
 * Below this relative speed the drag Jacobian is left at exactly zero rather
 * than evaluated via u_i*u_j/u (P1.15-style guard). The true limit as
 * u -> 0 is 0 (|u_i| <= u for both components), so this is a continuous
 * extension, not an approximation.
 */
const DRAG_JACOBIAN_SPEED_EPS = 1e-9;

/**
 * Analytic J = df/dy (row-major, out[row*4+col] = d f_row / d y_col) for the
 * planar projectile restricted to gravity + quadratic drag (P1.22; no
 * Magnus, no buoyancy). Derived from (3.18) with kd = rho*Cd*A/(2m):
 *
 *   d(ax)/dvx = -kd*(u + ux^2/u),  d(ax)/dvy = -kd*ux*uy/u
 *   d(ay)/dvx = -kd*ux*uy/u,       d(ay)/dvy = -kd*(u + uy^2/u)
 *
 * with u = |v_rel|, (ux,uy) = v_rel. Position derivatives are zero because
 * every environment component wired up so far (ConstantAtmosphere,
 * default UniformGravity, ZeroWind/uniform wind) is position-independent;
 * C_d is evaluated at the current (Re, M) but not itself differentiated,
 * exact for `ConstantCd` and a frozen-coefficient approximation otherwise.
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

  out.fill(0);
  out[X * DIM + VX] = 1;
  out[Y * DIM + VY] = 1;

  if (u < DRAG_JACOBIAN_SPEED_EPS) return;

  const re = (ctx.env.rho * u * (2 * ctx.params.radius)) / ctx.env.eta;
  const mach = ctx.env.c > 0 ? u / ctx.env.c : 0;
  const cd = ctx.params.dragCoefficient.cd(re, mach);
  const kd = (ctx.env.rho * cd * ctx.params.area) / (2 * ctx.params.mass);

  const daxDvx = -kd * (u + (ux * ux) / u);
  const daxDvy = -kd * ((ux * uy) / u);
  const dayDvx = daxDvy;
  const dayDvy = -kd * (u + (uy * uy) / u);

  out[VX * DIM + VX] = daxDvx;
  out[VX * DIM + VY] = daxDvy;
  out[VY * DIM + VX] = dayDvx;
  out[VY * DIM + VY] = dayDvy;
}
