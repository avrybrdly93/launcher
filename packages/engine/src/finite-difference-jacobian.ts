import type { EvalContext } from "./eval-context.js";
import type { Model } from "./model.js";

/**
 * Central-difference step scale: eps^(1/3) balances truncation error (O(h^2))
 * against floating-point cancellation error (O(eps/h)) in the difference
 * quotient — the standard choice for a central-difference derivative.
 */
const REL_STEP = Math.cbrt(Number.EPSILON);

/** Pre-allocated scratch for `finiteDifferenceJacobian`, sized once per model.dim (ADR-004). */
export interface FdJacobianScratch {
  readonly yPerturbed: Float64Array;
  readonly outPlus: Float64Array;
  readonly outMinus: Float64Array;
}

export function createFdJacobianScratch(dim: number): FdJacobianScratch {
  return {
    yPerturbed: new Float64Array(dim),
    outPlus: new Float64Array(dim),
    outMinus: new Float64Array(dim),
  };
}

/**
 * Generic finite-difference Jacobian fallback: `out[i*dim+j] = d(f_i)/d(y_j)`
 * via central differences with a per-component scaled step
 * `h_j = REL_STEP * max(1, |y_j|)`, so it stays well-conditioned whether
 * `y_j` is O(1) or O(1e5). Works for any `Model`, unlike a closed-form
 * Jacobian (e.g. P1.22's), at the cost of 2*dim extra `rhs` evaluations and
 * O(h^2) truncation error. Zero-allocation given a `scratch` created once
 * (not per call) via `createFdJacobianScratch`.
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
  scratch.yPerturbed.set(y);

  for (let j = 0; j < dim; j++) {
    const original = y[j]!;
    const h = REL_STEP * Math.max(1, Math.abs(original));

    scratch.yPerturbed[j] = original + h;
    model.rhs(t, scratch.yPerturbed, scratch.outPlus, ctx);
    scratch.yPerturbed[j] = original - h;
    model.rhs(t, scratch.yPerturbed, scratch.outMinus, ctx);
    scratch.yPerturbed[j] = original;

    for (let i = 0; i < dim; i++) {
      out[i * dim + j] = (scratch.outPlus[i]! - scratch.outMinus[i]!) / (2 * h);
    }
  }
}
