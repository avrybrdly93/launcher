import type { EvalContext } from "./eval-context.js";
import type { Model } from "./model.js";

/**
 * Cube root of machine epsilon: the standard scale for a *central*-difference
 * step (central differences have O(h^2) truncation error vs O(h) rounding
 * error, so the error-minimizing step is eps^(1/3), not the eps^(1/2) used
 * for one-sided/forward differences).
 */
const CBRT_EPS = Math.cbrt(Number.EPSILON);

/** Per-component step size, scaled by the state's own magnitude (with a floor so y_j = 0 doesn't collapse the step to 0). */
function scaledStep(yj: number): number {
  return CBRT_EPS * Math.max(Math.abs(yj), 1);
}

/**
 * Builds a generic central-difference `jacobian` for any `Model`, used as the
 * fallback when a model has no analytic one (P1.23 — e.g. Magnus-equipped
 * planar projectile models, per P1.22). Every scratch buffer is preallocated
 * in the closure so repeated calls (as in Newton iteration, P2.38) allocate
 * nothing after warmup, matching the analytic jacobian's hot-path contract.
 */
export function createFdJacobian(
  model: Model,
): (t: number, y: Float64Array, out: Float64Array, ctx: EvalContext) => void {
  const n = model.dim;
  const yPerturbed = new Float64Array(n);
  const fPlus = new Float64Array(n);
  const fMinus = new Float64Array(n);

  return function fdJacobian(
    t: number,
    y: Float64Array,
    out: Float64Array,
    ctx: EvalContext,
  ): void {
    yPerturbed.set(y);

    for (let col = 0; col < n; col++) {
      const yj = y[col]!;
      const h = scaledStep(yj);

      yPerturbed[col] = yj + h;
      model.rhs(t, yPerturbed, fPlus, ctx);
      yPerturbed[col] = yj - h;
      model.rhs(t, yPerturbed, fMinus, ctx);
      yPerturbed[col] = yj;

      const inv2h = 1 / (2 * h);
      for (let row = 0; row < n; row++) {
        out[row * n + col] = (fPlus[row]! - fMinus[row]!) * inv2h;
      }
    }
  };
}
