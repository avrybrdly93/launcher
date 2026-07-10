import type { EvalContext } from "./eval-context.js";

const DIM = 4;
/** Below this relative speed the drag Jacobian's direction is undefined; it is 0 in the limit anyway. */
const SPEED_EPS = 1e-12;

/**
 * Analytic Jacobian J = df/dy (row-major, out[i*4+j] = d(f_i)/d(y_j)) for the
 * planar projectile under gravity + quadratic drag only, i.e. no Magnus term
 * (P1.22). Matches §4.6's linearized-drag eigenvalues -kd*u*{1, 1/2} for the
 * streamwise/crosswise velocity directions.
 *
 * Treats Cd, rho, and wind as locally frozen at the evaluation point (not
 * differentiated w.r.t. state) — exact for `ConstantCd` with a
 * position-independent atmosphere/wind, an approximation (missing the
 * dCd/dRe term) for a Reynolds-dependent Cd model.
 */
export function analyticJacobianGravityQuadraticDrag(
  t: number,
  y: Float64Array,
  ctx: EvalContext,
  out: Float64Array,
): void {
  const vx = y[2]!;
  const vy = y[3]!;

  ctx.environment.sample(t, y[0]!, y[1]!, ctx.env);
  const ux = vx - ctx.env.wx;
  const uy = vy - ctx.env.wy;
  const u = Math.hypot(ux, uy);

  out.fill(0);
  out[0 * DIM + 2] = 1; // d(dx/dt)/d(vx)
  out[1 * DIM + 3] = 1; // d(dy/dt)/d(vy)

  if (u < SPEED_EPS) return; // drag Jacobian -> 0 as u -> 0, regardless of approach direction

  const re = (ctx.env.rho * u * (2 * ctx.params.radius)) / ctx.env.eta;
  const mach = ctx.env.c > 0 ? u / ctx.env.c : 0;
  const cd = ctx.params.dragCoefficient.cd(re, mach);
  const kd = (0.5 * ctx.env.rho * cd * ctx.params.area) / ctx.params.mass;

  const dAxDVx = -kd * ((u * u + ux * ux) / u);
  const cross = -kd * ((ux * uy) / u);
  const dAyDVy = -kd * ((u * u + uy * uy) / u);

  out[2 * DIM + 2] = dAxDVx; // d(dvx/dt)/d(vx)
  out[2 * DIM + 3] = cross; // d(dvx/dt)/d(vy)
  out[3 * DIM + 2] = cross; // d(dvy/dt)/d(vx)
  out[3 * DIM + 3] = dAyDVy; // d(dvy/dt)/d(vy)
}
