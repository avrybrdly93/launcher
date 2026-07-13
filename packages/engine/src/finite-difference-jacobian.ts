import type { EvalContext } from "./eval-context.js";
import type { Model } from "./model.js";

const SQRT_EPS = Math.sqrt(Number.EPSILON);
const MIN_SCALE = 1e-10;

/**
 * Generic central-difference Jacobian fallback (P1.23), used whenever a
 * `Model` has no analytic `jacobian` (e.g. Magnus is present, or Cd/env vary
 * with state — cases `createGravityQuadraticDragJacobian` (P1.22) declines).
 * Unlike that analytic formula, this works for *any* Model: it only calls
 * `model.rhs` twice per column, never differentiating the force law itself.
 *
 * Per-column step size follows the Dennis & Schnabel scaled-step convention
 * `h_j = sqrt(eps_machine) * max(|y_j|, typical_j)` rather than one fixed h:
 * a single unscaled h is either too large for small state components (poor
 * truncation) or too small for large ones (swamped by rhs rounding noise).
 * `typicalScale` lets a caller supply per-channel magnitude hints (e.g.
 * velocity components in a stiff scenario with tiny positions); it defaults
 * to 1 in every component.
 *
 * The returned closure allocates its scratch buffers once at construction
 * and never again per call, keeping it safe to use on a solver hot path
 * (ADR-004) — the only allocation a repeated call to this fallback avoids
 * is the dim*dim `out` buffer itself, which the caller owns.
 */
export function createFiniteDifferenceJacobian(
  model: Model,
  typicalScale?: readonly number[],
): NonNullable<Model["jacobian"]> {
  const dim = model.dim;
  const yPerturbed = new Float64Array(dim);
  const fPlus = new Float64Array(dim);
  const fMinus = new Float64Array(dim);

  return (t: number, y: Float64Array, out: Float64Array, ctx: EvalContext): void => {
    yPerturbed.set(y);

    for (let j = 0; j < dim; j++) {
      const typical = typicalScale?.[j] ?? 1;
      const scale = Math.max(Math.abs(y[j]!), typical, MIN_SCALE);
      const h = SQRT_EPS * scale;
      const yj = y[j]!;

      yPerturbed[j] = yj + h;
      model.rhs(t, yPerturbed, fPlus, ctx);
      yPerturbed[j] = yj - h;
      model.rhs(t, yPerturbed, fMinus, ctx);
      yPerturbed[j] = yj;

      const twoH = 2 * h;
      for (let i = 0; i < dim; i++) {
        out[i * dim + j] = (fPlus[i]! - fMinus[i]!) / twoH;
      }
    }
  };
}
