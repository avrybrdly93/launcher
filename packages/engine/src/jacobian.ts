import type { EvalContext } from "./eval-context.js";
import type { Model } from "./model.js";
import { norm } from "./vec2.js";

const X = 0;
const Y = 1;
const VX = 2;
const VY = 3;
const DIM = 4;

const SPEED_EPS = 1e-9;

/**
 * Analytic Jacobian J = df/dy (eq. 3.18, gravity + quadratic drag only, no
 * Magnus) for the planar projectile state y=(x,y,vx,vy). `out` is row-major,
 * length dim*dim=16: out[i*4+j] = d(f_i)/d(y_j).
 *
 * Assumes a position/time-independent environment (constant atmosphere,
 * non-altitude-dependent gravity, uniform-or-zero wind) and a speed-independent
 * drag coefficient, so d(rho)/dr = dg/dy = dw/dr = dCd/dRe = 0 — the only
 * nonzero block is d(acceleration)/d(velocity), since u*u_i is homogeneous
 * degree 2 in v_rel. As |v_rel| -> 0 that block's analytic limit is exactly
 * zero (matching the C^1-but-not-C^2 kink at v_rel=0, §3.8), so speeds below
 * SPEED_EPS take the zero branch rather than dividing by a near-zero norm.
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
  ctx.vRel[0] = vx - ctx.env.wx;
  ctx.vRel[1] = vy - ctx.env.wy;
  const ux = ctx.vRel[0];
  const uy = ctx.vRel[1];
  const u = norm(ctx.vRel);
  ctx.speedRel = u;
  ctx.re = (ctx.env.rho * u * (2 * ctx.params.radius)) / ctx.env.eta;
  ctx.mach = ctx.env.c > 0 ? u / ctx.env.c : 0;

  const cd = ctx.params.dragCoefficient.cd(ctx.re, ctx.mach);
  const kd = (0.5 * ctx.env.rho * cd * ctx.params.area) / ctx.params.mass;

  out.fill(0);
  out[X * DIM + VX] = 1;
  out[Y * DIM + VY] = 1;

  if (u > SPEED_EPS) {
    const dUxDvx = u + (ux * ux) / u;
    const dUxDvy = (ux * uy) / u;
    const dUyDvy = u + (uy * uy) / u;
    out[VX * DIM + VX] = -kd * dUxDvx;
    out[VX * DIM + VY] = -kd * dUxDvy;
    out[VY * DIM + VX] = -kd * dUxDvy;
    out[VY * DIM + VY] = -kd * dUyDvy;
  }
}

/** Preallocated scratch for {@link finiteDifferenceJacobian}, sized once per model.dim (P1.23). */
export interface FiniteDifferenceJacobianScratch {
  readonly yPerturbed: Float64Array;
  readonly fPlus: Float64Array;
  readonly fMinus: Float64Array;
}

export function createFiniteDifferenceJacobianScratch(
  dim: number,
): FiniteDifferenceJacobianScratch {
  return {
    yPerturbed: new Float64Array(dim),
    fPlus: new Float64Array(dim),
    fMinus: new Float64Array(dim),
  };
}

/** cbrt(machine epsilon): the step size minimizing central-difference error O(h^2*f''' + eps/h). */
const CBRT_EPS = Math.cbrt(Number.EPSILON);

/**
 * Generic central-difference Jacobian, applicable to any Model via `rhs`
 * alone — the fallback for models (or force combinations) that don't
 * implement an analytic `jacobian` (P1.23; used e.g. by backward Euler's
 * Newton solves, P2.38). Per-component step is scaled by the state's own
 * magnitude, `h_j = cbrt(eps) * max(1, |y_j|)`, the standard compromise
 * between truncation error (shrinks with h^2) and cancellation error (grows
 * as eps/h). `out` is row-major, length dim*dim: out[i*n+j] = d(f_i)/d(y_j).
 * `scratch` must be sized for `model.dim` (see {@link createFiniteDifferenceJacobianScratch})
 * so the hot path allocates nothing (ADR-004).
 */
export function finiteDifferenceJacobian(
  model: Model,
  t: number,
  y: Float64Array,
  ctx: EvalContext,
  out: Float64Array,
  scratch: FiniteDifferenceJacobianScratch,
): void {
  const n = model.dim;
  const { yPerturbed, fPlus, fMinus } = scratch;
  yPerturbed.set(y);

  for (let j = 0; j < n; j++) {
    const yj = y[j]!;
    const step = CBRT_EPS * Math.max(1, Math.abs(yj));

    yPerturbed[j] = yj + step;
    model.rhs(t, yPerturbed, fPlus, ctx);
    yPerturbed[j] = yj - step;
    model.rhs(t, yPerturbed, fMinus, ctx);
    yPerturbed[j] = yj;

    const invTwoStep = 1 / (2 * step);
    for (let i = 0; i < n; i++) {
      out[i * n + j] = (fPlus[i]! - fMinus[i]!) * invTwoStep;
    }
  }
}
