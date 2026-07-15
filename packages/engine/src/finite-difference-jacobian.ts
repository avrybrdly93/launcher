import type { EvalContext } from "./eval-context.js";
import type { Model } from "./model.js";

/** The same call shape as `Model.jacobian` (§3.7), whether analytic or FD-derived. */
export type JacobianFn = (t: number, y: Float64Array, out: Float64Array, ctx: EvalContext) => void;

export interface FiniteDifferenceJacobianOptions {
  /**
   * Relative step size, scaled per-component by max(|y_j|, absoluteFloor).
   * Defaults to the standard central-difference-optimal cbrt(machine epsilon)
   * (~6.06e-6): truncation error is O(h^2) while roundoff error is O(eps/h),
   * and this balances the two (§4 / P5.05's noise-aware-FD discussion).
   */
  readonly relativeStep?: number;
  /**
   * Absolute floor under the scaled step, so a component near/at y_j=0 (e.g.
   * a zero velocity component of an otherwise-fast state) doesn't collapse
   * the step toward 0 and blow up roundoff error in the (fPlus-fMinus)/2h
   * division. Defaults to 1 (one SI unit — the state's components are all
   * O(1)-scaled quantities: meters, m/s, rad/s), which keeps the step from
   * vanishing even when a single component happens to be exactly zero.
   */
  readonly absoluteFloor?: number;
}

const DEFAULT_RELATIVE_STEP = Math.cbrt(Number.EPSILON);
const DEFAULT_ABSOLUTE_FLOOR = 1;

/**
 * Generic central-finite-difference fallback for `Model.jacobian` (P1.23),
 * for any Model — not just the planar projectile — including force
 * combinations P1.22's analytic Jacobian doesn't cover (Magnus, tabulated
 * Cd(Re,Mach), position-dependent wind). Per-component scaled steps
 * (`relativeStep * max(|y_j|, absoluteFloor)`) keep the step sensible across
 * the wide dynamic range a state vector spans (position in tens of meters,
 * spin decay near-zero, etc.), rather than a single fixed absolute h.
 *
 * All scratch buffers are allocated once at construction and reused on every
 * call, so — like `Model.rhs` itself — repeated evaluation (e.g. inside a
 * Newton iteration, ADR-004) doesn't allocate.
 */
export function createFiniteDifferenceJacobian(
  model: Model,
  options: FiniteDifferenceJacobianOptions = {},
): JacobianFn {
  const n = model.dim;
  const relativeStep = options.relativeStep ?? DEFAULT_RELATIVE_STEP;
  const absoluteFloor = options.absoluteFloor ?? DEFAULT_ABSOLUTE_FLOOR;
  const yPerturbed = new Float64Array(n);
  const fPlus = new Float64Array(n);
  const fMinus = new Float64Array(n);

  return function finiteDifferenceJacobian(
    t: number,
    y: Float64Array,
    out: Float64Array,
    ctx: EvalContext,
  ): void {
    yPerturbed.set(y);

    for (let j = 0; j < n; j++) {
      const yj = y[j]!;
      const step = relativeStep * Math.max(Math.abs(yj), absoluteFloor);

      yPerturbed[j] = yj + step;
      model.rhs(t, yPerturbed, fPlus, ctx);
      yPerturbed[j] = yj - step;
      model.rhs(t, yPerturbed, fMinus, ctx);
      yPerturbed[j] = yj;

      const inv2h = 1 / (2 * step);
      for (let i = 0; i < n; i++) {
        out[i * n + j] = (fPlus[i]! - fMinus[i]!) * inv2h;
      }
    }
  };
}
