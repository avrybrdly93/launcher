import type { EvalContext } from "./eval-context.js";
import type { Model } from "./model.js";

/** √(machine epsilon) — the classic scale for a central-difference step (eq. 4.7 discussion). */
const SQRT_EPS = 1.4901161193847656e-8;

/** Reusable scratch so `finiteDifferenceJacobian` allocates nothing on repeat calls. */
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

/**
 * Generic central-difference Jacobian J = ∂f/∂y for any `Model`, used as the
 * fallback when `model.jacobian` is unavailable (§3.7) — e.g. Magnus/buoyancy
 * are enabled, or the model has no analytic Jacobian at all. Row-major,
 * length `dim*dim`: `out[row*dim+col]` = ∂f_row/∂y_col, matching P1.22's
 * layout so callers can swap analytic and FD sources interchangeably.
 *
 * Per-component step `h_j = √eps · max(|y_j|, 1)` (scaled steps, not a single
 * fixed h) keeps the step proportional to each state component's magnitude:
 * too small underflows to cancellation noise, too large loses second-order
 * accuracy, and a fixed h picked for position-scale state would be far too
 * large or small once applied to a velocity-scale (or vice versa) component.
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
  const { yPerturbed, fPlus, fMinus } = scratch;
  yPerturbed.set(y);

  for (let col = 0; col < dim; col++) {
    const yj = y[col]!;
    const h = SQRT_EPS * Math.max(Math.abs(yj), 1);

    yPerturbed[col] = yj + h;
    model.rhs(t, yPerturbed, fPlus, ctx);
    yPerturbed[col] = yj - h;
    model.rhs(t, yPerturbed, fMinus, ctx);
    yPerturbed[col] = yj;

    const invTwoH = 1 / (2 * h);
    for (let row = 0; row < dim; row++) {
      out[row * dim + col] = (fPlus[row]! - fMinus[row]!) * invTwoH;
    }
  }
}
