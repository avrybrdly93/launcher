import type { EvalContext } from "./eval-context.js";
import type { Model } from "./model.js";

/**
 * Cube root of the machine epsilon: the standard step-size scale for
 * central-difference derivatives (Dennis & Schnabel), balancing O(h^2)
 * truncation error against O(eps/h) rounding error.
 */
const CBRT_EPS = Math.cbrt(Number.EPSILON);

/**
 * Generic central-difference Jacobian, the fallback for any `Model` that
 * does not supply an analytic `jacobian` (P1.22 covers the one case that
 * does). Works for any state dimension since it only calls `model.rhs`;
 * the per-column step is scaled to the magnitude of that component,
 * `h_j = CBRT_EPS * max(|y_j|, 1)`, so it stays well-conditioned whether
 * `y_j` is O(1) or O(100).
 *
 * All scratch buffers (perturbed states, +/- rhs evaluations) are
 * preallocated once at creation so repeated calls to the returned closure
 * stay allocation-free (ADR-004) — the only per-call cost is 2*dim rhs
 * evaluations.
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
      const yj = y[j]!;
      const h = CBRT_EPS * Math.max(Math.abs(yj), 1);

      yPerturbed[j] = yj + h;
      model.rhs(t, yPerturbed, fPlus, ctx);
      yPerturbed[j] = yj - h;
      model.rhs(t, yPerturbed, fMinus, ctx);
      yPerturbed[j] = yj;

      const invTwoH = 1 / (2 * h);
      for (let i = 0; i < dim; i++) {
        out[i * dim + j] = (fPlus[i]! - fMinus[i]!) * invTwoH;
      }
    }
  };
}
