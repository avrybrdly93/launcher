import type { EvalContext } from "./eval-context.js";
import type { Model } from "./model.js";

/**
 * Central-difference step scale: eps^(1/3) balances O(h^2) truncation error
 * against O(eps/h) round-off for a central difference, the standard choice
 * (vs. eps^(1/2) for one-sided differences). Scaled per-component by
 * max(1, |y_i|) so the step is meaningful whether a state component is near
 * zero or large (§4.1-style scaled-step FD practice).
 */
const FD_STEP_SCALE = Math.cbrt(Number.EPSILON);

/**
 * Generic finite-difference Jacobian, the fallback used when a `Model` has
 * no analytic `jacobian` (e.g. Magnus/buoyancy included, or a
 * spatially-varying environment) -- P1.22 covers the closed-form special
 * case of gravity + quadratic drag alone. Buffers are preallocated in the
 * closure so repeated `compute` calls (e.g. from a Newton iteration, P2.38)
 * stay allocation-free after construction (ADR-004).
 *
 * `out` is row-major dim*dim: out[row*dim+col] = d f_row / d y_col.
 */
export interface FiniteDifferenceJacobian {
  compute(model: Model, t: number, y: Float64Array, ctx: EvalContext, out: Float64Array): void;
}

export function createFiniteDifferenceJacobian(dim: number): FiniteDifferenceJacobian {
  const yPerturbed = new Float64Array(dim);
  const fPlus = new Float64Array(dim);
  const fMinus = new Float64Array(dim);

  return {
    compute(model: Model, t: number, y: Float64Array, ctx: EvalContext, out: Float64Array): void {
      yPerturbed.set(y);

      for (let col = 0; col < dim; col++) {
        const yCol = y[col]!;
        const h = FD_STEP_SCALE * Math.max(1, Math.abs(yCol));

        yPerturbed[col] = yCol + h;
        model.rhs(t, yPerturbed, fPlus, ctx);
        yPerturbed[col] = yCol - h;
        model.rhs(t, yPerturbed, fMinus, ctx);
        yPerturbed[col] = yCol;

        const invTwoH = 1 / (2 * h);
        for (let row = 0; row < dim; row++) {
          out[row * dim + col] = (fPlus[row]! - fMinus[row]!) * invTwoH;
        }
      }
    },
  };
}
