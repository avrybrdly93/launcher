import type { EvalContext } from "./eval-context.js";
import type { Model } from "./model.js";

/**
 * Central-difference step scale eps^(1/3): the standard choice that balances
 * truncation error (~h^2, shrinking with h) against floating-point
 * cancellation error (~eps/h, growing as h shrinks) for a central difference,
 * giving ~eps^(2/3) relative accuracy — unlike sqrt(eps), which is optimal
 * for one-sided (forward) differences instead.
 */
const CBRT_EPS = Math.cbrt(Number.EPSILON);

/**
 * Generic central-difference Jacobian J = df/dy for any `Model`, the fallback
 * wherever an analytic `Model.jacobian` isn't available — e.g. models with
 * Magnus lift or a Re-dependent drag coefficient, which P1.22's analytic
 * gravity+quadratic-drag Jacobian doesn't cover. Step size per component is
 * scaled to the local state magnitude, `h_j = eps^(1/3)*max(1, |y_j|)`, so
 * components near zero don't take a vanishingly small (all-roundoff) step and
 * large components don't take a step too coarse to resolve curvature.
 *
 * Returns a `Model.jacobian`-shaped closure bound to `model`/`ctx`, with its
 * own preallocated scratch buffers so repeated calls (e.g. once per Newton
 * iteration in an implicit stepper) stay allocation-free (ADR-004). `out` is
 * row-major: `out[i*dim+j] = df_i/dy_j`, matching P1.22's layout.
 */
export function createFiniteDifferenceJacobian(
  model: Pick<Model, "dim" | "rhs">,
  ctx: EvalContext,
): (t: number, y: Float64Array, out: Float64Array) => void {
  const dim = model.dim;
  const yPerturbed = new Float64Array(dim);
  const fPlus = new Float64Array(dim);
  const fMinus = new Float64Array(dim);

  return (t: number, y: Float64Array, out: Float64Array): void => {
    for (let j = 0; j < dim; j++) {
      const h = CBRT_EPS * Math.max(1, Math.abs(y[j]!));
      const inv2h = 1 / (2 * h);

      yPerturbed.set(y);
      yPerturbed[j] = y[j]! + h;
      model.rhs(t, yPerturbed, fPlus, ctx);

      yPerturbed.set(y);
      yPerturbed[j] = y[j]! - h;
      model.rhs(t, yPerturbed, fMinus, ctx);

      for (let i = 0; i < dim; i++) {
        out[i * dim + j] = (fPlus[i]! - fMinus[i]!) * inv2h;
      }
    }
  };
}
