import type { EvalContext } from "./eval-context.js";
import type { Model } from "./model.js";

/**
 * Reusable scratch buffers for `finiteDifferenceJacobian`, sized once to
 * `model.dim` and passed in by the caller so repeated calls (e.g. Newton
 * iterations, P2.38) stay allocation-free (ADR-004).
 */
export interface JacobianScratch {
  readonly yPlus: Float64Array;
  readonly yMinus: Float64Array;
  readonly outPlus: Float64Array;
  readonly outMinus: Float64Array;
}

export function createJacobianScratch(dim: number): JacobianScratch {
  return {
    yPlus: new Float64Array(dim),
    yMinus: new Float64Array(dim),
    outPlus: new Float64Array(dim),
    outMinus: new Float64Array(dim),
  };
}

/**
 * Generic central-difference Jacobian, usable on any `Model` regardless of
 * whether it supplies an analytic `jacobian` (P1.22) — the fallback for
 * models/force combinations (e.g. Magnus) without a closed form. Row-major
 * `out[row*dim+col] = d f_row / d y_col` (§3.7), matching `Model.jacobian`'s
 * contract exactly so callers can use either interchangeably.
 *
 * Steps are scaled per component, `h_j = relativeStep * max(1, |y_j|)`, so
 * that both near-zero and large state components get a well-conditioned
 * step (a single absolute step would underflow relative precision for large
 * |y_j| and be too coarse for small |y_j|).
 */
export function finiteDifferenceJacobian(
  model: Model,
  t: number,
  y: Float64Array,
  ctx: EvalContext,
  out: Float64Array,
  scratch: JacobianScratch,
  relativeStep = 1e-6,
): void {
  const dim = model.dim;
  scratch.yPlus.set(y);
  scratch.yMinus.set(y);

  for (let col = 0; col < dim; col++) {
    const yCol = y[col]!;
    const h = relativeStep * Math.max(1, Math.abs(yCol));

    scratch.yPlus[col] = yCol + h;
    scratch.yMinus[col] = yCol - h;
    model.rhs(t, scratch.yPlus, scratch.outPlus, ctx);
    model.rhs(t, scratch.yMinus, scratch.outMinus, ctx);

    const invTwoH = 1 / (2 * h);
    for (let row = 0; row < dim; row++) {
      out[row * dim + col] = (scratch.outPlus[row]! - scratch.outMinus[row]!) * invTwoH;
    }

    scratch.yPlus[col] = yCol;
    scratch.yMinus[col] = yCol;
  }
}
