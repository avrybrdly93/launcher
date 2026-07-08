import type { EvalContext } from "./eval-context.js";
import type { Model } from "./model.js";

/** Cube root of Number.EPSILON: the standard scale for a central-difference step. */
const DEFAULT_RELATIVE_STEP = 6.055454452393343e-6;

/**
 * Builds a generic central-difference Jacobian for any `Model`, used as
 * SolverKit's fallback wherever `Model.jacobian` is undefined (P2.38). Each
 * component gets its own scaled step `h_j = relativeStep * max(1, |y_j|)`,
 * so position and velocity components spanning many orders of magnitude
 * are each perturbed sensibly.
 *
 * Buffers are preallocated once per model here (mirroring `Stepper.init`),
 * so the returned function is allocation-free on repeat calls (ADR-004).
 * `out` is row-major dim x dim: out[dim*i+j] = df_i/dy_j.
 */
export function createFiniteDifferenceJacobian(
  model: Model,
): (
  t: number,
  y: Float64Array,
  ctx: EvalContext,
  out: Float64Array,
  relativeStep?: number,
) => void {
  const n = model.dim;
  const yPerturbed = new Float64Array(n);
  const outPlus = new Float64Array(n);
  const outMinus = new Float64Array(n);

  return function finiteDifferenceJacobian(
    t: number,
    y: Float64Array,
    ctx: EvalContext,
    out: Float64Array,
    relativeStep: number = DEFAULT_RELATIVE_STEP,
  ): void {
    yPerturbed.set(y);

    for (let j = 0; j < n; j++) {
      const yj = y[j]!;
      const hj = relativeStep * Math.max(1, Math.abs(yj));

      yPerturbed[j] = yj + hj;
      model.rhs(t, yPerturbed, outPlus, ctx);
      yPerturbed[j] = yj - hj;
      model.rhs(t, yPerturbed, outMinus, ctx);
      yPerturbed[j] = yj;

      for (let i = 0; i < n; i++) {
        out[n * i + j] = (outPlus[i]! - outMinus[i]!) / (2 * hj);
      }
    }
  };
}
