import type { EvalContext } from "./eval-context.js";
import type { Model } from "./model.js";

/** Reused buffers for {@link finiteDifferenceJacobian} so repeated calls allocate nothing (ADR-004). */
export interface FiniteDifferenceJacobianScratch {
  readonly yPerturbed: Float64Array;
  readonly fPlus: Float64Array;
  readonly fMinus: Float64Array;
}

export function createFiniteDifferenceJacobianScratch(
  dim: number,
): FiniteDifferenceJacobianScratch {
  return {
    yPerturbed: new Float64Array(dim),
    fPlus: new Float64Array(dim),
    fMinus: new Float64Array(dim),
  };
}

/**
 * cbrt(eps) balances central-difference truncation error (~h^2) against
 * floating-point round-off in the difference quotient (~eps/h); it is the
 * standard step-size rule for a two-point central difference.
 */
const FD_STEP_SCALE = Math.cbrt(Number.EPSILON);

/**
 * Generic finite-difference Jacobian fallback (§3.7 `Model.jacobian`) for any
 * model that doesn't supply an analytic one — P1.22's
 * `gravityQuadraticDragJacobian` is the only analytic case today; every other
 * force composition (Magnus, buoyancy, linear drag, ...) falls back to this.
 * Row-major: `out[dim*i+j]` = $\partial f_i/\partial y_j$.
 *
 * The step for component `j` is scaled to that component's own magnitude,
 * `h_j = cbrt(eps) * max(1, |y_j|)`, rather than a single fixed `h` — state
 * channels span wildly different scales (position in meters vs. velocity in
 * m/s), and an unscaled step is either too coarse for small components or
 * lost to round-off for large ones.
 */
export function finiteDifferenceJacobian(
  model: Model,
  t: number,
  y: Float64Array,
  out: Float64Array,
  ctx: EvalContext,
  scratch: FiniteDifferenceJacobianScratch,
): void {
  const n = model.dim;
  const { yPerturbed, fPlus, fMinus } = scratch;
  yPerturbed.set(y);

  for (let j = 0; j < n; j++) {
    const yj = y[j]!;
    const h = FD_STEP_SCALE * Math.max(1, Math.abs(yj));

    yPerturbed[j] = yj + h;
    model.rhs(t, yPerturbed, fPlus, ctx);
    yPerturbed[j] = yj - h;
    model.rhs(t, yPerturbed, fMinus, ctx);
    yPerturbed[j] = yj;

    const invTwoH = 1 / (2 * h);
    for (let i = 0; i < n; i++) {
      out[n * i + j] = (fPlus[i]! - fMinus[i]!) * invTwoH;
    }
  }
}
