import type { EvalContext } from "./eval-context.js";
import type { Model } from "./model.js";

/** Preallocated scratch reused across calls so `finiteDifferenceJacobian` stays allocation-free. */
export interface FdJacobianScratch {
  readonly yPerturbed: Float64Array;
  readonly plus: Float64Array;
  readonly minus: Float64Array;
}

export function createFdJacobianScratch(dim: number): FdJacobianScratch {
  return {
    yPerturbed: new Float64Array(dim),
    plus: new Float64Array(dim),
    minus: new Float64Array(dim),
  };
}

/**
 * Generic central-difference Jacobian, the fallback for any `Model` that
 * doesn't supply an analytic `jacobian` (P1.22 covers gravity+quadratic-drag
 * exactly; every other model/force combination uses this instead).
 *
 * The per-component step is scaled by the state magnitude,
 * `h_j = cbrt(eps) * max(|y_j|, 1)`, the standard balance point between
 * central-difference truncation error (O(h^2)) and floating-point roundoff
 * (O(eps/h)) — a fixed absolute step would either underflow for large `y_j`
 * or amplify roundoff for small ones. `out` is `dim*dim` row-major:
 * `out[i*dim+j]` = d f_i / d y_j.
 */
export function finiteDifferenceJacobian(
  model: Model,
  t: number,
  y: Float64Array,
  ctx: EvalContext,
  out: Float64Array,
  scratch: FdJacobianScratch,
): void {
  const dim = model.dim;
  const stepScale = Math.cbrt(Number.EPSILON);
  scratch.yPerturbed.set(y);

  for (let j = 0; j < dim; j++) {
    const base = y[j]!;
    const h = stepScale * Math.max(Math.abs(base), 1);

    scratch.yPerturbed[j] = base + h;
    model.rhs(t, scratch.yPerturbed, scratch.plus, ctx);
    scratch.yPerturbed[j] = base - h;
    model.rhs(t, scratch.yPerturbed, scratch.minus, ctx);
    scratch.yPerturbed[j] = base;

    const inv2h = 1 / (2 * h);
    for (let i = 0; i < dim; i++) {
      out[i * dim + j] = (scratch.plus[i]! - scratch.minus[i]!) * inv2h;
    }
  }
}
