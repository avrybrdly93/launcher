import type { EvalContext } from "./eval-context.js";
import type { Model } from "./model.js";

/**
 * Generic central-difference J = ∂f/∂y fallback for any `Model`, used when
 * `model.jacobian` is absent (P1.22 attaches an analytic one only when every
 * composed force supports it). Column `i`'s step is scaled to the local
 * state magnitude, `h_i = cbrt(eps_mach) * max(|y_i|, 1)` — the standard
 * balance point for central differences, where truncation error (~h^2) and
 * cancellation error (~eps/h) are both minimized at h ~ eps^(1/3); a fixed
 * absolute step would either lose all precision to cancellation for small
 * |y_i| or blow past curvature scales for large |y_i|.
 */

const CENTRAL_DIFF_STEP_SCALE = Math.cbrt(Number.EPSILON);

/** Preallocated scratch for `finiteDifferenceJacobian`, reused across calls to stay allocation-free. */
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

/** Fills `out` (row-major dim×dim) with a central-difference approximation of `model`'s Jacobian at (t, y). */
export function finiteDifferenceJacobian(
  model: Model,
  t: number,
  y: Float64Array,
  ctx: EvalContext,
  out: Float64Array,
  scratch: FdJacobianScratch = createFdJacobianScratch(model.dim),
): void {
  const dim = model.dim;
  const { yPerturbed, fPlus, fMinus } = scratch;

  for (let col = 0; col < dim; col++) {
    yPerturbed.set(y);
    const yCol = y[col]!;
    const h = CENTRAL_DIFF_STEP_SCALE * Math.max(Math.abs(yCol), 1);

    yPerturbed[col] = yCol + h;
    model.rhs(t, yPerturbed, fPlus, ctx);
    yPerturbed[col] = yCol - h;
    model.rhs(t, yPerturbed, fMinus, ctx);

    const invTwoH = 1 / (2 * h);
    for (let row = 0; row < dim; row++) {
      out[row * dim + col] = (fPlus[row]! - fMinus[row]!) * invTwoH;
    }
  }
}
