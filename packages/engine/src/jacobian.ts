import type { EvalContext } from "./eval-context.js";

const X = 0;
const Y = 1;
const VX = 2;
const VY = 3;
const DIM = 4;

/**
 * Below this relative speed the drag Jacobian block is set to exactly zero.
 * This matches the true analytic limit: ax = -k*u*ux is homogeneous of
 * degree 2 in (ux, uy), so its gradient -- homogeneous of degree 1 -- is
 * continuous and vanishes at u=0 from every direction (the same C1-but-not-C2
 * kink documented in §3.8). The guard only avoids a 0/0 division; it does not
 * change the value the formula would otherwise produce.
 */
const DRAG_SPEED_EPS = 1e-9;

/**
 * Analytic J = df/dy for the planar projectile model (eq. 3.17-3.18) driven
 * by gravity + quadratic drag only, i.e. no Magnus force. `out` is the
 * row-major flattened dim x dim matrix: out[i*dim+j] = d f_i / d y_j.
 *
 * The closed form assumes rho, Cd and wind are state-independent at the
 * sampled point -- true for the default Phase-1 environment
 * (ConstantAtmosphere + non-altitude UniformGravity + ZeroWind/uniform wind)
 * with a ConstantCd drag model. Position-dependent fields (log-profile wind,
 * altitude-dependent gravity, tabulated Cd(Re)) are out of scope here and
 * need the finite-difference fallback (P1.23) instead.
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
  const k = (0.5 * ctx.env.rho * cd * ctx.params.area) / ctx.params.mass;

  out.fill(0);

  // d(dx/dt)/dvx = 1, d(dy/dt)/dvy = 1
  out[0 * DIM + VX] = 1;
  out[1 * DIM + VY] = 1;

  // d(dvx/dt)/dvx, d(dvx/dt)/dvy, d(dvy/dt)/dvx, d(dvy/dt)/dvy -- the
  // gravity+quadratic-drag block; gravity contributes nothing here since
  // -g is constant w.r.t. y under the stated environment assumptions.
  if (u >= DRAG_SPEED_EPS) {
    out[2 * DIM + VX] = -k * (u + (ux * ux) / u);
    out[2 * DIM + VY] = -k * ((ux * uy) / u);
    out[3 * DIM + VX] = -k * ((ux * uy) / u);
    out[3 * DIM + VY] = -k * (u + (uy * uy) / u);
  }
}
