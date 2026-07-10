import type { EvalContext } from "./eval-context.js";

const X = 0;
const Y = 1;
const VX = 2;
const VY = 3;
const DIM = 4;

const SPEED_EPS = 1e-9;

/**
 * Analytic Jacobian J = df/dy for the gravity + quadratic-drag-only planar
 * model (no Magnus), i.e. eq. (3.18) with the Magnus terms dropped. `out` is
 * `dim*dim` row-major: `out[i*DIM+j]` = d f_i / d y_j.
 *
 * Only the velocity block is nonzero: with every implemented Atmosphere and
 * WindField spatially uniform (constant or time-varying only), d(rho)/dr and
 * d(w)/dr are both zero, so drag depends on (vx, vy) alone, not (x, y).
 * Gravity contributes nothing (it's constant). This also assumes the drag
 * coefficient itself doesn't vary with the state — true for `ConstantCd`, but
 * NOT exact for a Reynolds-dependent Cd model (P1.12), which would need an
 * added dCd/dRe * dRe/dv term; use the finite-difference fallback (P1.23) for
 * that case.
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
  const ux = vx - ctx.env.wx;
  const uy = vy - ctx.env.wy;
  const u = Math.hypot(ux, uy);

  out.fill(0);
  out[X * DIM + VX] = 1;
  out[Y * DIM + VY] = 1;

  if (u < SPEED_EPS) return;

  const re = (ctx.env.rho * u * (2 * ctx.params.radius)) / ctx.env.eta;
  const mach = ctx.env.c > 0 ? u / ctx.env.c : 0;
  const cd = ctx.params.dragCoefficient.cd(re, mach);
  const kd = (ctx.env.rho * cd * ctx.params.area) / (2 * ctx.params.mass);

  out[VX * DIM + VX] = (-kd * (2 * ux * ux + uy * uy)) / u;
  out[VX * DIM + VY] = (-kd * (ux * uy)) / u;
  out[VY * DIM + VX] = (-kd * (ux * uy)) / u;
  out[VY * DIM + VY] = (-kd * (2 * uy * uy + ux * ux)) / u;
}
