import type { EvalContext } from "./eval-context.js";

const X = 0;
const Y = 1;
const VX = 2;
const VY = 3;
const DIM = 4;

/** Below this relative speed, treat u*u_i (and its derivative) as exactly zero (P1.09-style guard). */
const SPEED_EPS = 1e-9;

/**
 * Analytic Jacobian J = df/dy (row-major, `out[DIM*i+j] = df_i/dy_j`) of the
 * planar rhs restricted to gravity + quadratic drag (no Magnus, per P1.22).
 *
 * f = (vx, vy, ax, ay) with u = v - w(t,r), speedRel = |u|,
 * kd = rho*Cd*A/(2*mass):
 *   ax = -kd*speedRel*ux,  ay = -g - kd*speedRel*uy
 *
 * Rows 0-1 are the trivial [0 I] velocity-identity block. Rows 2-3 only have
 * nonzero d/dvx, d/dvy entries: gravity is constant (contributes nothing),
 * and this derivation treats rho, Cd, and wind as *locally frozen* at the
 * evaluation point — i.e. it does not differentiate through Cd(Re) (no
 * closed-form dCd/dRe for the tabulated model, P1.12) or through any spatial
 * dependence of rho(r)/w(t,r). This is exact whenever those are literally
 * constant (ConstantAtmosphere + ConstantCd + uniform wind, the P1.22
 * validation setup) and is the standard frozen-coefficient approximation
 * used elsewhere for Newton-Jacobian purposes (§5.1, P2.38).
 *
 * Samples the environment itself (like `rhs`), so `ctx.env`/`vRel`/`speedRel`
 * need not be pre-populated. Writes into `out` only — zero allocations.
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

  if (u < SPEED_EPS) {
    // f ~ u*u near u=0 (a C^1 kink, §3.8): the Jacobian vanishes there.
    return;
  }

  const re = (ctx.env.rho * u * (2 * ctx.params.radius)) / ctx.env.eta;
  const mach = ctx.env.c > 0 ? u / ctx.env.c : 0;
  const cd = ctx.params.dragCoefficient.cd(re, mach);
  const kd = (ctx.env.rho * cd * ctx.params.area) / (2 * ctx.params.mass);

  const dAxDvx = (-kd * (ux * ux + u * u)) / u;
  const dAxDvy = (-kd * (ux * uy)) / u;
  const dAyDvy = (-kd * (uy * uy + u * u)) / u;

  out[VX * DIM + VX] = dAxDvx;
  out[VX * DIM + VY] = dAxDvy;
  out[VY * DIM + VX] = dAxDvy; // symmetric: d(ay)/dvx == d(ax)/dvy
  out[VY * DIM + VY] = dAyDvy;
}
