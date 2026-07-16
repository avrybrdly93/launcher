import type { EvalContext } from "./eval-context.js";
import type { Model } from "./model.js";

export interface FiniteDifferenceJacobianOptions {
  /**
   * Relative step scale, applied per-component as `relativeStep * |y_j|`.
   * Defaults to eps^(1/3) (~6e-6 in Float64), the standard balance point
   * between central-difference truncation error (O(h^2)) and floating-point
   * cancellation error (O(eps/h)).
   */
  readonly relativeStep?: number;
  /** Absolute floor on the step, used when `y_j` is near zero. */
  readonly minStep?: number;
}

const DEFAULT_RELATIVE_STEP = Math.cbrt(Number.EPSILON);
const DEFAULT_MIN_STEP = 1e-6;

/**
 * Generic central-difference `Model.jacobian(t, y, out)` fallback (P1.23):
 * covers any `Model.rhs`, including the Cd(Re)/Magnus/wind-shear cases the
 * frozen-coefficient analytic Jacobian (P1.22) doesn't differentiate through.
 * Per-component ("scaled") steps `h_j = max(minStep, relativeStep * |y_j|)`
 * keep the step sensible whether `y_j` is a position (O(10-100)) or a
 * near-zero velocity, avoiding both underflow-to-zero and excess truncation
 * error from one fixed step size across a state with mixed magnitudes.
 *
 * `ctx` is captured by closure (mirroring P1.22): `Model.jacobian` per the
 * blueprint's own interface (§3.7) takes no `EvalContext`, yet `Model.rhs`
 * needs one to sample the environment, so any generic wrapper has to bake
 * one in at construction time same as the analytic factories do.
 *
 * `out` must be a length-`dim*dim` buffer, written row-major:
 * `out[dim*i + j] = ∂f_i/∂y_j`. Scratch buffers are preallocated once so
 * repeated calls stay allocation-free after warmup (ADR-004).
 */
export function createFiniteDifferenceJacobian(
  model: Model,
  ctx: EvalContext,
  options: FiniteDifferenceJacobianOptions = {},
): NonNullable<Model["jacobian"]> {
  const dim = model.dim;
  const relativeStep = options.relativeStep ?? DEFAULT_RELATIVE_STEP;
  const minStep = options.minStep ?? DEFAULT_MIN_STEP;

  const yPlus = new Float64Array(dim);
  const yMinus = new Float64Array(dim);
  const fPlus = new Float64Array(dim);
  const fMinus = new Float64Array(dim);

  return (t: number, y: Float64Array, out: Float64Array): void => {
    yPlus.set(y);
    yMinus.set(y);

    for (let j = 0; j < dim; j++) {
      const yj = y[j]!;
      const h = Math.max(minStep, relativeStep * Math.abs(yj));

      yPlus[j] = yj + h;
      yMinus[j] = yj - h;
      model.rhs(t, yPlus, fPlus, ctx);
      model.rhs(t, yMinus, fMinus, ctx);
      yPlus[j] = yj;
      yMinus[j] = yj;

      const invTwoH = 1 / (2 * h);
      for (let i = 0; i < dim; i++) {
        out[dim * i + j] = (fPlus[i]! - fMinus[i]!) * invTwoH;
      }
    }
  };
}
