import type { EvalContext } from "./eval-context.js";
import type { Model } from "./model.js";

const SQRT_EPS = Math.sqrt(Number.EPSILON);

/**
 * Generic central-difference df/dy, for any Model regardless of which forces
 * it wires (the fallback used whenever `model.jacobian` is undefined, e.g.
 * Magnus or linear drag are present per P1.22's scoping). Step size per
 * component is scaled, h_j = sqrt(eps)*max(|y_j|, typicalScale), so
 * near-zero state components (a projectile launched from rest) still get a
 * numerically meaningful perturbation instead of underflowing to h=0.
 *
 * Not on the zero-allocation hot path (ADR-004 covers rhs/stepper loops,
 * not this diagnostic/Newton-fallback utility): allocates dim-sized scratch
 * buffers per call.
 */
export function finiteDifferenceJacobian(
  model: Model,
  t: number,
  y: Float64Array,
  ctx: EvalContext,
  out: Float64Array,
  typicalScale = 1,
): void {
  const dim = model.dim;
  const yPerturbed = Float64Array.from(y);
  const fPlus = new Float64Array(dim);
  const fMinus = new Float64Array(dim);

  for (let j = 0; j < dim; j++) {
    const yj = y[j]!;
    const h = SQRT_EPS * Math.max(Math.abs(yj), typicalScale);

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
}
