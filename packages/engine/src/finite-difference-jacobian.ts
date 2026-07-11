import type { EvalContext } from "./eval-context.js";
import type { Model } from "./model.js";

/**
 * Central-difference step size scale for component j: h_j = STEP_SCALE *
 * max(|y_j|, typicalScale). STEP_SCALE = eps^(1/3) balances the two error
 * sources of a central difference — O(h^2) truncation vs O(eps/h) roundoff
 * — which are minimized together at h ~ eps^(1/3) (unlike a forward
 * difference, whose optimum is eps^(1/2)). Scaling by |y_j| rather than
 * using one fixed h is what makes this work uniformly for state components
 * spanning meters (position) to tens of m/s (velocity) or beyond.
 */
const STEP_SCALE = Math.cbrt(Number.EPSILON);

/**
 * Generic finite-difference `Model.jacobian` fallback (P1.23), used wherever
 * a Model doesn't supply an analytic one (e.g. Magnus, tabulated Cd(Re) —
 * see forces.ts `jacobianV`). Scratch buffers are preallocated once per
 * instance and reused across `evaluate` calls so repeated use inside a
 * Newton loop (P2.38/P4.21) doesn't allocate per iteration (ADR-004).
 */
export class FiniteDifferenceJacobian {
  private readonly yPerturbed: Float64Array;
  private readonly fPlus: Float64Array;
  private readonly fMinus: Float64Array;

  constructor(
    private readonly dim: number,
    private readonly typicalScale = 1,
  ) {
    this.yPerturbed = new Float64Array(dim);
    this.fPlus = new Float64Array(dim);
    this.fMinus = new Float64Array(dim);
  }

  /** Writes the row-major n x n Jacobian (out[i*n+j] = d f_i/d y_j) into `out`. */
  evaluate(model: Model, t: number, y: Float64Array, ctx: EvalContext, out: Float64Array): void {
    const n = this.dim;
    this.yPerturbed.set(y);

    for (let j = 0; j < n; j++) {
      const yj = y[j]!;
      const h = STEP_SCALE * Math.max(Math.abs(yj), this.typicalScale);

      this.yPerturbed[j] = yj + h;
      model.rhs(t, this.yPerturbed, this.fPlus, ctx);
      this.yPerturbed[j] = yj - h;
      model.rhs(t, this.yPerturbed, this.fMinus, ctx);
      this.yPerturbed[j] = yj;

      const inv2h = 1 / (2 * h);
      for (let i = 0; i < n; i++) {
        out[i * n + j] = (this.fPlus[i]! - this.fMinus[i]!) * inv2h;
      }
    }
  }
}

/**
 * Evaluates model.jacobian if the Model provides one (P1.22, exact and
 * cheaper), otherwise falls back to `fallback`'s finite-difference estimate
 * (P1.23). Composability means most scenarios (gravity + quadratic drag) get
 * the analytic path automatically; adding Magnus or a tabulated Cd model
 * silently switches this to FD without any caller-side branching.
 */
export function evaluateJacobian(
  model: Model,
  t: number,
  y: Float64Array,
  ctx: EvalContext,
  out: Float64Array,
  fallback: FiniteDifferenceJacobian,
): void {
  if (model.jacobian) {
    model.jacobian(t, y, out, ctx);
  } else {
    fallback.evaluate(model, t, y, ctx, out);
  }
}
