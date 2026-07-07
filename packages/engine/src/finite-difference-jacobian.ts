import type { EvalContext } from "./eval-context.js";
import type { Model } from "./model.js";

const SQRT_EPS = Math.sqrt(Number.EPSILON);

/**
 * Generic central finite-difference Jacobian d(rhs)/dy, computed purely from
 * `model.rhs` — works for any Model, not just ones with an analytic
 * `jacobian` (P1.22), and is the fallback for anything an analytic formula
 * doesn't cover (Magnus, tabulated Cd(Re), custom models). Per-component step
 * size `h_j = sqrt(eps_machine) * max(|y_j|, 1)` is the standard balance of
 * truncation error (~h^2) against floating-point cancellation error (~eps/h),
 * scaled so a component near zero doesn't get an absurdly large relative
 * step and one at large magnitude doesn't get an absurdly small one.
 */
export function finiteDifferenceJacobian(
  model: Model,
  t: number,
  y: Float64Array,
  ctx: EvalContext,
  out: Float64Array,
): void {
  const dim = model.dim;
  const yPerturbed = Float64Array.from(y);
  const plus = new Float64Array(dim);
  const minus = new Float64Array(dim);

  for (let j = 0; j < dim; j++) {
    const yj = y[j]!;
    const h = SQRT_EPS * Math.max(Math.abs(yj), 1);

    yPerturbed[j] = yj + h;
    model.rhs(t, yPerturbed, plus, ctx);

    yPerturbed[j] = yj - h;
    model.rhs(t, yPerturbed, minus, ctx);

    yPerturbed[j] = yj;

    const inv2h = 1 / (2 * h);
    for (let i = 0; i < dim; i++) {
      out[i * dim + j] = (plus[i]! - minus[i]!) * inv2h;
    }
  }
}
