import type { EvalContext } from "./eval-context.js";
import type { Model } from "./model.js";

/**
 * Cube root of machine epsilon: the truncation/round-off-optimal relative
 * step for a central difference (O(h^2) truncation vs. O(eps/h) round-off,
 * balanced at h ~ eps^(1/3), unlike the eps^(1/2) optimum for one-sided
 * differences).
 */
const FD_RELATIVE_STEP = Math.cbrt(Number.EPSILON);

/**
 * Builds a reusable central-difference Jacobian evaluator for `model`,
 * matching the `Model.jacobian` signature so it can serve as a drop-in
 * fallback wherever no analytic formula is registered -- P1.22's
 * gravity+quadratic-drag case is the one exception; every other force
 * combination (Magnus, tabulated Cd(Re), buoyancy, ...) uses this instead.
 *
 * Each state component y_j gets its own scaled step h_j =
 * cbrt(eps)*max(|y_j|, 1), so components near zero (e.g. a fresh launch
 * position) still get a well-conditioned step instead of h -> 0.
 *
 * The returned closure owns its scratch buffers (sized once, to model.dim)
 * so repeated calls -- e.g. once per Newton iteration in a future implicit
 * stepper (P2.38) -- do not allocate.
 */
export function createFiniteDifferenceJacobian(
  model: Model,
): (t: number, y: Float64Array, out: Float64Array, ctx: EvalContext) => void {
  const dim = model.dim;
  const yPerturbed = new Float64Array(dim);
  const fPlus = new Float64Array(dim);
  const fMinus = new Float64Array(dim);

  return (t: number, y: Float64Array, out: Float64Array, ctx: EvalContext): void => {
    yPerturbed.set(y);

    for (let j = 0; j < dim; j++) {
      const yj = y[j]!;
      const h = FD_RELATIVE_STEP * Math.max(Math.abs(yj), 1);

      yPerturbed[j] = yj + h;
      model.rhs(t, yPerturbed, fPlus, ctx);
      yPerturbed[j] = yj - h;
      model.rhs(t, yPerturbed, fMinus, ctx);
      yPerturbed[j] = yj;

      const inv2h = 1 / (2 * h);
      for (let i = 0; i < dim; i++) {
        out[i * dim + j] = (fPlus[i]! - fMinus[i]!) * inv2h;
      }
    }
  };
}

/**
 * Returns `model` unchanged if it already declares an analytic `jacobian`
 * (P1.22), otherwise returns a copy with the finite-difference fallback
 * (P1.23) attached -- so callers (e.g. the backward-Euler Newton solver,
 * P2.38) can always rely on `model.jacobian` being defined without caring
 * which kind it is.
 */
export function withFiniteDifferenceJacobianFallback(model: Model): Model {
  if (model.jacobian) return model;
  return { ...model, jacobian: createFiniteDifferenceJacobian(model) };
}
