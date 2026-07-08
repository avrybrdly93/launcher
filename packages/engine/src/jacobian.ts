import type { EvalContext } from "./eval-context.js";
import type { Model } from "./model.js";

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

/**
 * Reused buffers for `finiteDifferenceJacobian` (one per model dimension),
 * so the fallback stays allocation-free on repeated calls (ADR-004) — the
 * same pattern as EvalContext.
 */
export class FiniteDifferenceJacobianScratch {
  readonly yPerturbed: Float64Array;
  readonly outPlus: Float64Array;
  readonly outMinus: Float64Array;

  constructor(dim: number) {
    this.yPerturbed = new Float64Array(dim);
    this.outPlus = new Float64Array(dim);
    this.outMinus = new Float64Array(dim);
  }
}

/** Relative step size for the central difference, scaled per-component by max(1, |y_i|). */
const FD_STEP_RELATIVE = 1e-6;

/**
 * Generic central-difference Jacobian for any `Model` (P1.23), used as the
 * fallback when a model has no analytic `jacobian` (e.g. once Magnus or a
 * Re-dependent C_d model is in play). Steps are scaled per-component by
 * max(1, |y_i|) rather than a single fixed h, so position channels (O(1-100)
 * m) and velocity channels get comparably-conditioned steps. Matches
 * `gravityQuadraticDragJacobian` (P1.22) wherever that analytic form applies.
 */
export function finiteDifferenceJacobian(
  model: Model,
  t: number,
  y: Float64Array,
  ctx: EvalContext,
  out: Float64Array,
  scratch: FiniteDifferenceJacobianScratch,
): void {
  const dim = model.dim;
  const { yPerturbed, outPlus, outMinus } = scratch;
  yPerturbed.set(y);

  for (let col = 0; col < dim; col++) {
    const original = y[col]!;
    const h = FD_STEP_RELATIVE * Math.max(1, Math.abs(original));

    yPerturbed[col] = original + h;
    model.rhs(t, yPerturbed, outPlus, ctx);

    yPerturbed[col] = original - h;
    model.rhs(t, yPerturbed, outMinus, ctx);

    yPerturbed[col] = original;

    for (let row = 0; row < dim; row++) {
      out[row * dim + col] = (outPlus[row]! - outMinus[row]!) / (2 * h);
    }
  }
}
