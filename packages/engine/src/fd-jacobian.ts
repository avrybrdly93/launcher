import type { EvalContext } from "./eval-context.js";
import type { Model } from "./model.js";

/** Standard balance point for central differences: truncation ~h^2, roundoff ~eps/h, minimized at h ~ eps^(1/3). */
const CBRT_EPS = Math.cbrt(Number.EPSILON);

export interface FiniteDifferenceJacobianOptions {
  /** Relative step size per component; defaults to eps^(1/3). */
  readonly relStep?: number;
}

/**
 * Generic central-difference Jacobian J = df/dy for any Model (P1.23), the
 * fallback used whenever no analytic `model.jacobian` is available (e.g.
 * Magnus, tabulated Cd, or any force set beyond P1.22's gravity+quadratic-
 * drag special case). Row-major, matching P1.22's convention:
 * `out[row*dim+col] = d f_row / d y_col`.
 *
 * Steps are scaled per component, `h_i = relStep * max(|y_i|, 1)`, rather
 * than one fixed h: this keeps roundoff/truncation balanced across state
 * components spanning very different magnitudes (e.g. position in meters vs.
 * velocity in m/s).
 */
export function createFiniteDifferenceJacobian(
  model: Model,
  ctx: EvalContext,
  options: FiniteDifferenceJacobianOptions = {},
): (t: number, y: Float64Array, out: Float64Array) => void {
  const relStep = options.relStep ?? CBRT_EPS;
  const dim = model.dim;
  const yPlus = new Float64Array(dim);
  const yMinus = new Float64Array(dim);
  const fPlus = new Float64Array(dim);
  const fMinus = new Float64Array(dim);

  return (t: number, y: Float64Array, out: Float64Array): void => {
    yPlus.set(y);
    yMinus.set(y);

    for (let col = 0; col < dim; col++) {
      const h = relStep * Math.max(Math.abs(y[col]!), 1);
      yPlus[col] = y[col]! + h;
      yMinus[col] = y[col]! - h;

      model.rhs(t, yPlus, fPlus, ctx);
      model.rhs(t, yMinus, fMinus, ctx);

      for (let row = 0; row < dim; row++) {
        out[row * dim + col] = (fPlus[row]! - fMinus[row]!) / (2 * h);
      }

      yPlus[col] = y[col]!;
      yMinus[col] = y[col]!;
    }
  };
}
