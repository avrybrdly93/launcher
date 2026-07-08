import type { EvalContext } from "./eval-context.js";
import type { Model } from "./model.js";

/** sqrt(machine epsilon): the standard balance point between truncation and round-off error for a first-derivative central difference. */
const SQRT_EPS = Math.sqrt(Number.EPSILON);

/**
 * Generic central-difference Jacobian J = df/dy (row-major `model.dim`^2,
 * `out[i*n+j]` = df_i/dy_j) for any `Model`, used where no analytic
 * `model.jacobian` is available (P1.23). Per-component step `h_j =
 * sqrt(eps)*max(|y_j|, 1)` scales with the state so components near zero
 * still get a usable absolute step while large components get a step
 * proportional to their own magnitude (avoiding both round-off swamping a
 * too-small step and truncation error from a too-large one).
 */
export function finiteDifferenceJacobian(
  model: Pick<Model, "dim" | "rhs">,
  t: number,
  y: Float64Array,
  ctx: EvalContext,
  out: Float64Array,
): void {
  const n = model.dim;
  const yPerturbed = new Float64Array(y);
  const fPlus = new Float64Array(n);
  const fMinus = new Float64Array(n);

  for (let j = 0; j < n; j++) {
    const yj = y[j]!;
    const h = SQRT_EPS * Math.max(Math.abs(yj), 1);

    yPerturbed[j] = yj + h;
    model.rhs(t, yPerturbed, fPlus, ctx);
    yPerturbed[j] = yj - h;
    model.rhs(t, yPerturbed, fMinus, ctx);
    yPerturbed[j] = yj;

    const twoH = 2 * h;
    for (let i = 0; i < n; i++) {
      out[i * n + j] = (fPlus[i]! - fMinus[i]!) / twoH;
    }
  }
}
