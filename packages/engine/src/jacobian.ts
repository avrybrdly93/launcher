import type { EvalContext } from "./eval-context.js";
import { norm } from "./vec2.js";

const X = 0;
const Y = 1;
const VX = 2;
const VY = 3;
const DIM = 4;

/**
 * Below this relative-velocity magnitude, every drag partial derivative is
 * treated as exactly zero rather than evaluated. The true limit as u -> 0 is
 * zero either way (each term is O(u), e.g. (u^2+vx^2)/u <= 2u), so this isn't
 * an approximation — it just avoids dividing by a near-zero u in floating
 * point (mirrors the drag-force guard, P1.09).
 */
const SPEED_EPS = 1e-9;

/**
 * Analytic Jacobian J = df/dy for the gravity + quadratic-drag rhs (eq. 3.18
 * with the Magnus and buoyancy terms switched off), row-major:
 * `out[i*DIM+j] = d(f_i)/d(y_j)` for y = (x, y, vx, vy).
 *
 * Exact only when the environment sample and drag coefficient are themselves
 * independent of the state: a state-independent atmosphere/gravity/wind
 * (true of every registered Environment as of P1.22 — altitude-dependent
 * gravity and position-dependent wind are not yet implemented) and a Cd that
 * doesn't vary with (Re, Mach) at the evaluation point (true of `ConstantCd`,
 * the platform default; using a Reynolds-dependent Cd model here silently
 * drops the d(Cd)/dv term).
 */
export function gravityQuadraticDragJacobian(
  t: number,
  y: Float64Array,
  out: Float64Array,
  ctx: EvalContext,
): void {
  const x = y[X]!;
  const yPos = y[Y]!;

  ctx.environment.sample(t, x, yPos, ctx.env);

  ctx.vRel[0] = y[VX]! - ctx.env.wx;
  ctx.vRel[1] = y[VY]! - ctx.env.wy;
  const u = norm(ctx.vRel);
  const vx = ctx.vRel[0];
  const vy = ctx.vRel[1];

  out.fill(0);
  out[X * DIM + VX] = 1;
  out[Y * DIM + VY] = 1;
  if (u < SPEED_EPS) return;

  const re = (ctx.env.rho * u * (2 * ctx.params.radius)) / ctx.env.eta;
  const mach = ctx.env.c > 0 ? u / ctx.env.c : 0;
  const cd = ctx.params.dragCoefficient.cd(re, mach);
  const kd = (0.5 * ctx.env.rho * cd * ctx.params.area) / ctx.params.mass;

  out[VX * DIM + VX] = -kd * (u + (vx * vx) / u);
  out[VX * DIM + VY] = (-kd * (vx * vy)) / u;
  out[VY * DIM + VX] = (-kd * (vx * vy)) / u;
  out[VY * DIM + VY] = -kd * (u + (vy * vy) / u);
}
