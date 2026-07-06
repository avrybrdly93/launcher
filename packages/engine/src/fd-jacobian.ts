import type { EvalContext } from "./eval-context.js";

/** Preallocated scratch for `fdJacobian`, sized once per model so repeated calls allocate nothing (ADR-004). */
export interface FdJacobianScratch {
  readonly yPlus: Float64Array;
  readonly yMinus: Float64Array;
  readonly fPlus: Float64Array;
  readonly fMinus: Float64Array;
}

export function createFdJacobianScratch(dim: number): FdJacobianScratch {
  return {
    yPlus: new Float64Array(dim),
    yMinus: new Float64Array(dim),
    fPlus: new Float64Array(dim),
    fMinus: new Float64Array(dim),
  };
}

// Optimal relative step for a central difference balances O(h^2) truncation
// error against O(eps/h) cancellation error, which is minimized at h ~ eps^(1/3).
const FD_STEP_SCALE = Math.cbrt(Number.EPSILON);

/**
 * Generic central-difference J = ∂f/∂y fallback for any model, used when
 * `Model.jacobian` is undefined (P2.38 damped Newton falls back to this).
 * Step size is scaled per component, h_j = FD_STEP_SCALE*max(1,|y_j|), so it
 * stays well-conditioned across state components of very different
 * magnitude. Row-major, matching `Model.jacobian`: out[i*dim+j] = ∂f_i/∂y_j.
 */
export function fdJacobian(
  model: {
    readonly dim: number;
    rhs(t: number, y: Float64Array, out: Float64Array, ctx: EvalContext): void;
  },
  t: number,
  y: Float64Array,
  out: Float64Array,
  ctx: EvalContext,
  scratch: FdJacobianScratch,
): void {
  const dim = model.dim;
  const { yPlus, yMinus, fPlus, fMinus } = scratch;
  yPlus.set(y);
  yMinus.set(y);

  for (let j = 0; j < dim; j++) {
    const yj = y[j]!;
    const h = FD_STEP_SCALE * Math.max(1, Math.abs(yj));
    yPlus[j] = yj + h;
    yMinus[j] = yj - h;

    model.rhs(t, yPlus, fPlus, ctx);
    model.rhs(t, yMinus, fMinus, ctx);

    for (let i = 0; i < dim; i++) {
      out[i * dim + j] = (fPlus[i]! - fMinus[i]!) / (2 * h);
    }

    yPlus[j] = yj;
    yMinus[j] = yj;
  }
}
