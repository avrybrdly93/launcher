import type { EvalContext } from "./eval-context.js";
import type { Model } from "./model.js";

/** Per-Numerical-Recipes central-difference scaling: balances truncation (O(h^2)) against roundoff (O(eps/h)). */
const SQRT_EPS = Math.sqrt(Number.EPSILON);

/**
 * Generic central-difference Jacobian ∂f/∂y for *any* `Model.rhs`, with
 * per-component scaled step sizes h_j = √ε·max(|y_j|, 1) — large enough to
 * clear roundoff for large state components, without collapsing to zero for
 * near-zero ones. Row-major: out[i*dim+j] = ∂f_i/∂y_j.
 *
 * This is the fallback used wherever a `Model` has no analytic `jacobian`
 * (Magnus enabled, tabulated Cd(Re), altitude-dependent gravity, ...); on
 * the P1.22 gravity+quadratic-drag case where an analytic Jacobian *is*
 * available, the two must agree (see finite-difference-jacobian.test.ts).
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
      const h = SQRT_EPS * Math.max(Math.abs(yj), 1);

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
