import type { EvalContext, Model } from "@ballista/engine";

/**
 * Relative step for scaled central differences: the classical optimum for a
 * central difference (truncation error O(h^2), rounding error O(eps/h)) is
 * h ~ eps^(1/3), balancing the two. Scaling by max(1, |y_j|) keeps the step
 * meaningful across components of very different magnitude (position in
 * meters vs. velocity in m/s vs. a near-zero state component).
 */
export const FD_RELATIVE_STEP = Math.cbrt(Number.EPSILON);

/** Preallocated scratch for `fdJacobian`, reusable across calls to stay allocation-free in a loop. */
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

/**
 * Generic finite-difference Jacobian, the fallback used whenever a `Model`
 * doesn't provide an analytic `jacobian` (P1.22 covers gravity+quadratic-drag
 * analytically; every other force combination — Magnus, linear drag,
 * buoyancy, position-dependent environments — lands here). Column j is a
 * scaled central difference of `rhs` with respect to y_j:
 *
 *   J[:,j] = (f(y + h_j e_j) - f(y - h_j e_j)) / (2 h_j),  h_j = FD_RELATIVE_STEP * max(1, |y_j|)
 *
 * `out` is row-major dim x dim: out[dim*i + j] = ∂f_i/∂y_j. Never allocates —
 * `scratch` supplies every intermediate buffer, so this is safe to call once
 * per Newton iteration in an implicit stepper (P2.38/P4.21).
 */
export function fdJacobian(
  model: Model,
  t: number,
  y: Float64Array,
  out: Float64Array,
  ctx: EvalContext,
  scratch: FdJacobianScratch,
): void {
  const n = model.dim;
  const { yPlus, yMinus, fPlus, fMinus } = scratch;
  yPlus.set(y);
  yMinus.set(y);

  for (let j = 0; j < n; j++) {
    const yj = y[j]!;
    const h = FD_RELATIVE_STEP * Math.max(1, Math.abs(yj));
    yPlus[j] = yj + h;
    yMinus[j] = yj - h;

    model.rhs(t, yPlus, fPlus, ctx);
    model.rhs(t, yMinus, fMinus, ctx);

    const invTwoH = 1 / (2 * h);
    for (let i = 0; i < n; i++) {
      out[n * i + j] = (fPlus[i]! - fMinus[i]!) * invTwoH;
    }

    yPlus[j] = yj;
    yMinus[j] = yj;
  }
}

/** Convenience one-shot wrapper over `fdJacobian` for callers outside a hot loop (tests, one-off analysis). */
export function fdJacobianAlloc(
  model: Model,
  t: number,
  y: Float64Array,
  ctx: EvalContext,
): Float64Array {
  const out = new Float64Array(model.dim * model.dim);
  fdJacobian(model, t, y, out, ctx, createFdJacobianScratch(model.dim));
  return out;
}

/**
 * `model.jacobian` if present, else the generic FD fallback — the single
 * entry point solvers should call so they never special-case "does this
 * model have an analytic Jacobian?" (§3.7).
 */
export function jacobianOf(
  model: Model,
  t: number,
  y: Float64Array,
  out: Float64Array,
  ctx: EvalContext,
  scratch: FdJacobianScratch,
): void {
  if (model.jacobian) {
    model.jacobian(t, y, out, ctx);
  } else {
    fdJacobian(model, t, y, out, ctx, scratch);
  }
}
