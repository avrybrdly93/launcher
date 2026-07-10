import type { EvalContext } from "./eval-context.js";
import type { Model } from "./model.js";

/** sqrt(machine epsilon): the standard balance between FD truncation and rounding error. */
const FD_EPS = Math.sqrt(Number.EPSILON);

/** Scratch buffers so repeated calls (e.g. inside a Newton loop) can stay allocation-free. */
export interface FiniteDifferenceJacobianScratch {
  readonly yPert: Float64Array;
  readonly fPlus: Float64Array;
  readonly fMinus: Float64Array;
}

export function createFiniteDifferenceJacobianScratch(
  dim: number,
): FiniteDifferenceJacobianScratch {
  return {
    yPert: new Float64Array(dim),
    fPlus: new Float64Array(dim),
    fMinus: new Float64Array(dim),
  };
}

/**
 * Generic central-difference Jacobian fallback (P1.23) for any `Model`,
 * used where no analytic `jacobian` (P1.22) is available — e.g. once Magnus
 * or other forces are in play. Row-major, matching `Model.jacobian`'s
 * convention: out[i*dim+j] = d(f_i)/d(y_j). Uses a per-component scaled
 * step h_j = sqrt(eps)*max(1, |y_j|) and 2*dim rhs evaluations.
 *
 * Pass `scratch` (from `createFiniteDifferenceJacobianScratch`) to avoid
 * allocating on repeated calls; omitting it allocates fresh buffers each call.
 */
export function finiteDifferenceJacobian(
  model: Pick<Model, "dim" | "rhs">,
  t: number,
  y: Float64Array,
  ctx: EvalContext,
  out: Float64Array,
  scratch: FiniteDifferenceJacobianScratch = createFiniteDifferenceJacobianScratch(model.dim),
): void {
  const { dim } = model;
  const { yPert, fPlus, fMinus } = scratch;
  yPert.set(y);

  for (let j = 0; j < dim; j++) {
    const yj = y[j]!;
    const h = FD_EPS * Math.max(1, Math.abs(yj));

    yPert[j] = yj + h;
    model.rhs(t, yPert, fPlus, ctx);
    yPert[j] = yj - h;
    model.rhs(t, yPert, fMinus, ctx);
    yPert[j] = yj;

    const inv2h = 1 / (2 * h);
    for (let i = 0; i < dim; i++) {
      out[i * dim + j] = (fPlus[i]! - fMinus[i]!) * inv2h;
    }
  }
}
