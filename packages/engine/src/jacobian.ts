import type { EvalContext } from "./eval-context.js";
import { norm } from "./vec2.js";

const X = 0;
const Y = 1;
const VX = 2;
const VY = 3;
const DIM = 4;

/**
 * Analytic Jacobian J = df/dy (eq. 3.17) of the planar projectile rhs
 * restricted to gravity + quadratic drag, no Magnus (P1.22). `out` is a
 * flattened row-major DIM*DIM buffer: out[i*DIM+j] = df_i/dy_j.
 *
 * Two simplifications bound the scope to "analytic" rather than "general":
 * Cd is treated as locally constant in state (exact for ConstantCd, an
 * approximation once Cd depends on Re -- P1.23's finite-difference fallback
 * covers that general case), and environment fields (rho, g, wind) are
 * assumed independent of position/time over one evaluation, matching the
 * default ConstantAtmosphere + non-altitude UniformGravity + uniform/zero
 * wind setup. Neither assumption affects dx/dt=vx, dy/dt=vy, which are exact
 * regardless.
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
  const u = norm([ux, uy]);
  const re = (ctx.env.rho * u * (2 * ctx.params.radius)) / ctx.env.eta;
  const mach = ctx.env.c > 0 ? u / ctx.env.c : 0;
  const cd = ctx.params.dragCoefficient.cd(re, mach);
  const kd = (0.5 * ctx.env.rho * cd * ctx.params.area) / ctx.params.mass;

  out.fill(0);
  out[X * DIM + VX] = 1; // d(dx/dt)/dvx
  out[Y * DIM + VY] = 1; // d(dy/dt)/dvy

  // d(dv/dt)/dv of -kd*u*u, with u = |v - w| (guarded at u=0, where the
  // whole velocity block of J vanishes continuously -- see P1.09/P1.15's
  // treatment of the same u->0 kink).
  if (u > 0) {
    out[VX * DIM + VX] = -kd * (u + (ux * ux) / u);
    out[VX * DIM + VY] = (-kd * (ux * uy)) / u;
    out[VY * DIM + VX] = (-kd * (ux * uy)) / u;
    out[VY * DIM + VY] = -kd * (u + (uy * uy) / u);
  }
}
