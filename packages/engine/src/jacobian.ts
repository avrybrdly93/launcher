import type { EvalContext } from "./eval-context.js";
import type { Model } from "./model.js";

const DIM = 4;
const X = 0;
const Y = 1;
const VX = 2;
const VY = 3;

/**
 * Analytic J = df/dy (row-major 4x4) for the planar projectile under gravity
 * + quadratic drag only (no Magnus, no buoyancy), per eq. (3.18) with the
 * Magnus term dropped. Valid when the environment is spatially uniform
 * (constant atmosphere, non-altitude-dependent gravity, spatially uniform
 * wind) so kd = rho*Cd*A/(2m) has no y-dependence and rows 1-2 (position)
 * contribute only the identity block from dPos/dVel.
 *
 * Singular at v_rel = 0: u*|u| is C1 but not C2 there (SS3.8), so the
 * direction-dependent limit makes the Jacobian undefined at that exact
 * state. Callers must not evaluate at v_rel = 0.
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

  const ux = y[VX]! - ctx.env.wx;
  const uy = y[VY]! - ctx.env.wy;
  const u = Math.hypot(ux, uy);
  const re = (ctx.env.rho * u * (2 * ctx.params.radius)) / ctx.env.eta;
  const mach = ctx.env.c > 0 ? u / ctx.env.c : 0;
  const cd = ctx.params.dragCoefficient.cd(re, mach);
  const kd = (ctx.env.rho * cd * ctx.params.area) / (2 * ctx.params.mass);

  out.fill(0);
  out[X * DIM + VX] = 1;
  out[Y * DIM + VY] = 1;
  out[VX * DIM + VX] = -kd * ((ux * ux) / u + u);
  out[VX * DIM + VY] = (-kd * (ux * uy)) / u;
  out[VY * DIM + VX] = (-kd * (ux * uy)) / u;
  out[VY * DIM + VY] = -kd * ((uy * uy) / u + u);
}

/** Preallocated buffers for `finiteDifferenceJacobian`, reused across calls to stay allocation-free. */
export interface FiniteDifferenceScratch {
  readonly outPlus: Float64Array;
  readonly outMinus: Float64Array;
  readonly yPerturbed: Float64Array;
}

export function createFiniteDifferenceScratch(dim: number): FiniteDifferenceScratch {
  return {
    outPlus: new Float64Array(dim),
    outMinus: new Float64Array(dim),
    yPerturbed: new Float64Array(dim),
  };
}

const SQRT_EPS = Math.sqrt(Number.EPSILON);

/**
 * Generic central-difference J = df/dy (row-major dim x dim) fallback for
 * any `Model`, used where an analytic `jacobian` (like P1.22's) isn't
 * available -- e.g. backward Euler's Newton solver (P2.38) against models
 * with Magnus/buoyancy/non-uniform environments. Per-component step
 * h_j = sqrt(eps_mach) * max(|y_j|, 1) balances truncation error (~h^2)
 * against rounding error (~eps/h). Pass `scratch` to avoid allocating on
 * repeated calls (e.g. once per Newton iteration).
 */
export function finiteDifferenceJacobian(
  model: Model,
  t: number,
  y: Float64Array,
  out: Float64Array,
  ctx: EvalContext,
  scratch: FiniteDifferenceScratch = createFiniteDifferenceScratch(model.dim),
): void {
  const dim = model.dim;
  scratch.yPerturbed.set(y);

  for (let col = 0; col < dim; col++) {
    const h = SQRT_EPS * Math.max(Math.abs(y[col]!), 1);

    scratch.yPerturbed[col] = y[col]! + h;
    model.rhs(t, scratch.yPerturbed, scratch.outPlus, ctx);

    scratch.yPerturbed[col] = y[col]! - h;
    model.rhs(t, scratch.yPerturbed, scratch.outMinus, ctx);

    scratch.yPerturbed[col] = y[col]!;

    const inv2h = 1 / (2 * h);
    for (let row = 0; row < dim; row++) {
      out[row * dim + col] = (scratch.outPlus[row]! - scratch.outMinus[row]!) * inv2h;
    }
  }
}
