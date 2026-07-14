import type { EvalContext } from "./eval-context.js";
import type { Model } from "./model.js";

/**
 * Optimal relative step for a *central* difference (truncation ~h^2 vs.
 * roundoff ~eps/h balances at h ~ eps^(1/3)), unlike the eps^(1/2) rule for
 * forward differences.
 */
const CBRT_EPS = Math.cbrt(Number.EPSILON);

/**
 * Generic central-difference `Model.jacobian` (P1.23): the fallback used
 * whenever a model has no analytic `jacobian` (e.g. anything outside P1.22's
 * gravity+quadratic-drag special case — Magnus, buoyancy, tabulated Cd(Re),
 * position-dependent environment). Per-component step is scaled to the
 * state's own magnitude (`h_j = eps^(1/3) * max(|y_j|, 1)`) so components
 * near zero don't get a vanishingly small, roundoff-dominated step, and the
 * displacement used in the denominator is the *actual* `y+h - (y-h)`
 * (rather than the nominal `2h`) since `y+h` itself rounds to the nearest
 * representable double.
 *
 * Buffers are preallocated once here and reused on every call, so repeated
 * use (e.g. per Newton iteration in an implicit stepper) does not allocate.
 */
export function createFiniteDifferenceJacobian(
  model: Model,
  ctx: EvalContext,
): (t: number, y: Float64Array, out: Float64Array) => void {
  const dim = model.dim;
  const yPlus = new Float64Array(dim);
  const yMinus = new Float64Array(dim);
  const fPlus = new Float64Array(dim);
  const fMinus = new Float64Array(dim);

  return function finiteDifferenceJacobian(t: number, y: Float64Array, out: Float64Array): void {
    for (let j = 0; j < dim; j++) {
      const h = CBRT_EPS * Math.max(Math.abs(y[j]!), 1);

      yPlus.set(y);
      yMinus.set(y);
      yPlus[j] = y[j]! + h;
      yMinus[j] = y[j]! - h;
      const denom = yPlus[j]! - yMinus[j]!;

      model.rhs(t, yPlus, fPlus, ctx);
      model.rhs(t, yMinus, fMinus, ctx);

      for (let i = 0; i < dim; i++) {
        out[i * dim + j] = (fPlus[i]! - fMinus[i]!) / denom;
      }
    }
  };
}
