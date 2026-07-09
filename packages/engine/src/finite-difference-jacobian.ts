import type { EvalContext } from "./eval-context.js";
import type { Model } from "./model.js";

const DEFAULT_H = 1e-6;

/**
 * Generic central finite-difference Jacobian fallback (P1.23), for any
 * `Model` — used when `model.jacobian` isn't supplied (e.g. Magnus is
 * enabled, ruling out P1.22's closed form), or to cross-check an analytic
 * one. Steps are scaled by max(1, |y_j|) per column so both large and small
 * state components get a well-conditioned perturbation.
 *
 * Returns a closure over preallocated scratch buffers (dim-sized
 * y+/y-/f+/f-) so repeated calls — e.g. once per Newton iteration in the
 * backward-Euler stepper (P2.38) — don't allocate.
 *
 * `out` is row-major dim x dim: out[i*dim+j] = d f_i / d y_j, matching P1.22.
 */
export function createFiniteDifferenceJacobian(
  model: Model,
  h: number = DEFAULT_H,
): (t: number, y: Float64Array, out: Float64Array, ctx: EvalContext) => void {
  const n = model.dim;
  const yPlus = new Float64Array(n);
  const yMinus = new Float64Array(n);
  const fPlus = new Float64Array(n);
  const fMinus = new Float64Array(n);

  return (t: number, y: Float64Array, out: Float64Array, ctx: EvalContext): void => {
    for (let j = 0; j < n; j++) {
      yPlus.set(y);
      yMinus.set(y);
      const step = h * Math.max(1, Math.abs(y[j]!));
      yPlus[j]! += step;
      yMinus[j]! -= step;
      model.rhs(t, yPlus, fPlus, ctx);
      model.rhs(t, yMinus, fMinus, ctx);
      const invTwoStep = 1 / (2 * step);
      for (let i = 0; i < n; i++) {
        out[i * n + j] = (fPlus[i]! - fMinus[i]!) * invTwoStep;
      }
    }
  };
}
