import type { EvalContext } from "./eval-context.js";
import type { Model } from "./model.js";

/**
 * Central-difference step scaled by state magnitude: h ~ eps^(1/3) balances
 * O(h^2) truncation error against O(eps/h) rounding error for a central
 * difference, and scaling by |y_i| keeps it meaningful across magnitudes.
 */
const RELATIVE_STEP = Math.cbrt(Number.EPSILON);

/**
 * Generic finite-difference Jacobian fallback for any `Model`, used where no
 * analytic `jacobian` is available (e.g. Magnus-included or Re-dependent-Cd
 * configurations the P1.22 closed form can't handle). Row-major dim*dim
 * output matches the analytic convention: `out[row*dim + col]` = d(f_row)/d(y_col).
 * Scratch buffers are preallocated once per model so repeated calls stay
 * allocation-free after warmup (ADR-004).
 */
export function createFiniteDifferenceJacobian(
  model: Model,
  ctx: EvalContext,
  relativeStep: number = RELATIVE_STEP,
): (t: number, y: Float64Array, out: Float64Array) => void {
  const dim = model.dim;
  const yPlus = new Float64Array(dim);
  const yMinus = new Float64Array(dim);
  const fPlus = new Float64Array(dim);
  const fMinus = new Float64Array(dim);

  return function jacobian(t: number, y: Float64Array, out: Float64Array): void {
    for (let col = 0; col < dim; col++) {
      yPlus.set(y);
      yMinus.set(y);
      const step = relativeStep * Math.max(1, Math.abs(y[col]!));
      yPlus[col] = y[col]! + step;
      yMinus[col] = y[col]! - step;

      model.rhs(t, yPlus, fPlus, ctx);
      model.rhs(t, yMinus, fMinus, ctx);

      for (let row = 0; row < dim; row++) {
        out[row * dim + col] = (fPlus[row]! - fMinus[row]!) / (2 * step);
      }
    }
  };
}
