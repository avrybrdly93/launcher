import type { EvalContext } from "./eval-context.js";
import type { Model } from "./model.js";

/** cbrt(machine epsilon): balances central-difference truncation vs. roundoff error. */
const FD_STEP = Math.cbrt(Number.EPSILON);

/**
 * Generic central-difference Jacobian (P1.23), used as the fallback when a
 * `Model` doesn't supply an analytic `jacobian` (e.g. eq. 3.18 with Magnus
 * enabled, for which no closed form is implemented). Works for any model
 * dimension via `model.dim`; row-major, out[n*i + j] = df_i/dy_j, matching
 * the convention of `createGravityQuadraticDragJacobian` (P1.22).
 *
 * Steps are scaled per component, h_j = FD_STEP * max(|y_j|, 1): components
 * near zero still get a meaningful absolute step, and large-magnitude
 * components don't lose relative precision to a fixed absolute step. `ctx`
 * is supplied by the caller (rather than constructed internally) so the
 * fallback reuses the same scratch buffers as the rest of the integration
 * instead of allocating its own.
 */
export function createFiniteDifferenceJacobian(
  model: Model,
  ctx: EvalContext,
): (t: number, y: Float64Array, out: Float64Array) => void {
  const n = model.dim;
  const yPlus = new Float64Array(n);
  const yMinus = new Float64Array(n);
  const fPlus = new Float64Array(n);
  const fMinus = new Float64Array(n);

  return (t: number, y: Float64Array, out: Float64Array): void => {
    yPlus.set(y);
    yMinus.set(y);

    for (let j = 0; j < n; j++) {
      const h = FD_STEP * Math.max(Math.abs(y[j]!), 1);
      yPlus[j] = y[j]! + h;
      yMinus[j] = y[j]! - h;

      model.rhs(t, yPlus, fPlus, ctx);
      model.rhs(t, yMinus, fMinus, ctx);

      const inv2h = 1 / (2 * h);
      for (let i = 0; i < n; i++) {
        out[n * i + j] = (fPlus[i]! - fMinus[i]!) * inv2h;
      }

      yPlus[j] = y[j]!;
      yMinus[j] = y[j]!;
    }
  };
}
