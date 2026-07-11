import type { EvalContext } from "./eval-context.js";
import type { Model } from "./model.js";

/**
 * Relative step scale for central differences: cbrt(machine epsilon), the
 * step size that balances truncation error (O(h^2)) against round-off error
 * (O(eps/h)) for a first derivative, giving ~1e-10-1e-11 accuracy in double
 * precision (Numerical Recipes §5.7).
 */
const FD_STEP_SCALE = Math.cbrt(Number.EPSILON);

/**
 * Generic central-difference Jacobian fallback (P1.23) for any `Model`
 * lacking an analytic `jacobian` (P1.22 covers gravity+quadratic-drag only;
 * Magnus, tabulated Cd(Re), and non-constant environments have no
 * closed form here). Steps are scaled per-component,
 * `h_j = cbrt(eps) * max(1, |y_j|)`, so it stays accurate for both small and
 * large state magnitudes.
 *
 * Returns a closure matching `Model.jacobian`'s signature exactly, so it can
 * be dropped in as `model.jacobian = createFiniteDifferenceJacobian(model, ctx)`.
 * All scratch (`yPerturbed`, `fPlus`, `fMinus`) is allocated once here, not
 * per call, keeping repeated Jacobian evaluations allocation-free.
 */
export function createFiniteDifferenceJacobian(
  model: Model,
  ctx: EvalContext,
): (t: number, y: Float64Array, out: Float64Array) => void {
  const dim = model.dim;
  const yPerturbed = new Float64Array(dim);
  const fPlus = new Float64Array(dim);
  const fMinus = new Float64Array(dim);

  return (t: number, y: Float64Array, out: Float64Array): void => {
    yPerturbed.set(y);

    for (let j = 0; j < dim; j++) {
      const original = y[j]!;
      const h = FD_STEP_SCALE * Math.max(1, Math.abs(original));

      yPerturbed[j] = original + h;
      model.rhs(t, yPerturbed, fPlus, ctx);
      yPerturbed[j] = original - h;
      model.rhs(t, yPerturbed, fMinus, ctx);
      yPerturbed[j] = original;

      const invTwoH = 1 / (2 * h);
      for (let i = 0; i < dim; i++) {
        out[i * dim + j] = (fPlus[i]! - fMinus[i]!) * invTwoH;
      }
    }
  };
}
