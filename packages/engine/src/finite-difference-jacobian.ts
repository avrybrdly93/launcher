import type { EvalContext } from "./eval-context.js";
import type { Model } from "./model.js";

/** cbrt(machine epsilon): the truncation/rounding-error-balancing relative step for central differences. */
const DEFAULT_RELATIVE_STEP = 6.055454452393343e-6;
const DEFAULT_MIN_STEP = 1e-8;

export interface FiniteDifferenceJacobianOptions {
  /** Step size as a fraction of |y_j|, default cbrt(machine epsilon). */
  readonly relativeStep?: number;
  /** Floor on the step size when |y_j| is near zero. */
  readonly minStep?: number;
}

/**
 * Generic central-difference Jacobian fallback (P1.23) for any `Model`,
 * used where no analytic `jacobian` is available (P2.38's Newton solver,
 * the Solver Lab's eigenvalue overlay). Per-component step is scaled to
 * |y_j| (`h_j = max(minStep, relativeStep * |y_j|)`) rather than fixed,
 * since state components routinely span position (~10-100 m) and velocity
 * (~1-100 m/s) at very different magnitudes in the same state vector.
 *
 * Scratch buffers are allocated once per returned closure, not per call, so
 * repeated evaluation (e.g. once per Newton iteration) stays allocation-free.
 */
export function createFiniteDifferenceJacobian(
  model: Model,
  ctx: EvalContext,
  options: FiniteDifferenceJacobianOptions = {},
): (t: number, y: Float64Array, out: Float64Array) => void {
  const dim = model.dim;
  const relativeStep = options.relativeStep ?? DEFAULT_RELATIVE_STEP;
  const minStep = options.minStep ?? DEFAULT_MIN_STEP;

  const yPerturbed = new Float64Array(dim);
  const fPlus = new Float64Array(dim);
  const fMinus = new Float64Array(dim);

  return (t: number, y: Float64Array, out: Float64Array): void => {
    yPerturbed.set(y);

    for (let col = 0; col < dim; col++) {
      const yCol = y[col]!;
      const h = Math.max(minStep, relativeStep * Math.abs(yCol));

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
  };
}
