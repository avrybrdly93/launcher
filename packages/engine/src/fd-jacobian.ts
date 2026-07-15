import type { EvalContext } from "./eval-context.js";
import type { Model } from "./model.js";

/** cbrt(machine epsilon): the standard step-size balance point for a central difference (O(h^2) truncation vs O(eps/h) roundoff). */
const FD_STEP_SCALE = Math.cbrt(Number.EPSILON);

/** Caller-owned scratch reused across calls so repeated use (e.g. inside a Newton loop) stays allocation-free. */
export interface FdJacobianScratch {
  readonly yPerturbed: Float64Array;
  readonly fPlus: Float64Array;
  readonly fMinus: Float64Array;
}

export function createFdJacobianScratch(dim: number): FdJacobianScratch {
  return {
    yPerturbed: new Float64Array(dim),
    fPlus: new Float64Array(dim),
    fMinus: new Float64Array(dim),
  };
}

/**
 * Generic central-difference Jacobian J = df/dy for any `Model`, used as the
 * fallback when `model.jacobian` is not supplied (§3.7; consumed by the
 * Backward Euler Newton loop of P2.38). Step sizes are scaled per component
 * (Dennis & Schnabel convention): h_j = cbrt(eps) * max(|y_j|, 1), so
 * near-zero components still get a numerically meaningful perturbation while
 * large components get a step proportional to their own magnitude.
 *
 * `out` is row-major, dim*dim entries: out[i*dim+j] = df_i/dy_j, matching
 * the layout of `gravityQuadraticDragJacobian` (P1.22). `scratch` (see
 * `createFdJacobianScratch`) must have length >= model.dim in each buffer.
 */
export function finiteDifferenceJacobian(
  model: Model,
  t: number,
  y: Float64Array,
  ctx: EvalContext,
  out: Float64Array,
  scratch: FdJacobianScratch,
): void {
  const dim = model.dim;
  const { yPerturbed, fPlus, fMinus } = scratch;
  yPerturbed.set(y.subarray(0, dim));

  for (let j = 0; j < dim; j++) {
    const yj = y[j]!;
    const h = FD_STEP_SCALE * Math.max(Math.abs(yj), 1);

    yPerturbed[j] = yj + h;
    model.rhs(t, yPerturbed, fPlus, ctx);
    yPerturbed[j] = yj - h;
    model.rhs(t, yPerturbed, fMinus, ctx);
    yPerturbed[j] = yj;

    const inv2h = 1 / (2 * h);
    for (let i = 0; i < dim; i++) {
      out[i * dim + j] = (fPlus[i]! - fMinus[i]!) * inv2h;
    }
  }
}
