import type { EvalContext } from "./eval-context.js";

const DRAG_JACOBIAN_SPEED_EPS = 1e-9;

/**
 * Analytic Jacobian J = df/dy (row-major 4x4: out[4*i+j] = d(f_i)/d(y_j))
 * for the planar gravity + quadratic-drag model (eq. 3.18 with the Magnus
 * term omitted). Assumes Cd is state-independent (ConstantCd, P1.10) and the
 * environment is spatially/temporally uniform at the evaluation point
 * (ConstantAtmosphere + UniformGravity, non-altitude-dependent, + zero or
 * uniform wind): rho, Cd, g, and w are therefore constants of the point, not
 * functions of (t, y), so the only nonzero position-column entries are the
 * kinematic dx/dvx = dy/dvy = 1 block.
 *
 * `ctx` must already be freshly sampled for `y` (i.e. `model.rhs(t, y, ...,
 * ctx)` called first) so `vRel`/`speedRel`/`re`/`mach` reflect the current
 * state. The drag block is the standard quadratic-drag Jacobian
 * d(u*u_i)/dv_j = delta_ij*u + u_i*u_j/u, which vanishes continuously (not
 * just the force, but its derivative) as u -> 0 since |u_i| <= u — handled
 * below by a direct zero rather than evaluating the removable 0/0 form.
 */
export function analyticJacobianGravityQuadraticDrag(ctx: EvalContext, out: Float64Array): void {
  out.fill(0);
  out[0 * 4 + 2] = 1; // dx/dvx
  out[1 * 4 + 3] = 1; // dy/dvy

  const ux = ctx.vRel[0];
  const uy = ctx.vRel[1];
  const u = ctx.speedRel;
  if (u < DRAG_JACOBIAN_SPEED_EPS) {
    return;
  }

  const cd = ctx.params.dragCoefficient.cd(ctx.re, ctx.mach);
  const kd = (0.5 * ctx.env.rho * cd * ctx.params.area) / ctx.params.mass;
  const invU = 1 / u;

  const dAxDvx = -kd * (ux * ux * invU + u);
  const dAxDvy = -kd * ux * uy * invU;
  const dAyDvy = -kd * (uy * uy * invU + u);

  out[2 * 4 + 2] = dAxDvx;
  out[2 * 4 + 3] = dAxDvy;
  out[3 * 4 + 2] = dAxDvy; // symmetric: d(a_y)/d(vx) == d(a_x)/d(vy)
  out[3 * 4 + 3] = dAyDvy;
}

/** Preallocated scratch reused across calls so the fallback stays allocation-free. */
export interface FiniteDifferenceJacobianScratch {
  readonly yPerturbed: Float64Array;
  readonly fPlus: Float64Array;
  readonly fMinus: Float64Array;
}

export function createFiniteDifferenceJacobianScratch(
  dim: number,
): FiniteDifferenceJacobianScratch {
  return {
    yPerturbed: new Float64Array(dim),
    fPlus: new Float64Array(dim),
    fMinus: new Float64Array(dim),
  };
}

/**
 * Generic central-difference Jacobian fallback (P1.23) for any rhs, used
 * when a model has no analytic `jacobian`. Step size per component is scaled
 * to the state magnitude, h_j = sqrt(eps) * max(|y_j|, 1), the standard
 * compromise between truncation error (shrinks with h) and cancellation
 * error (grows as h -> 0) — a fixed absolute step would either lose all
 * precision on small components or blow the truncation error on large ones.
 * Row-major out[n*i+j] = d(f_i)/d(y_j), matching `analyticJacobianGravityQuadraticDrag`.
 */
export function finiteDifferenceJacobian(
  rhs: (t: number, y: Float64Array, out: Float64Array) => void,
  t: number,
  y: Float64Array,
  out: Float64Array,
  scratch: FiniteDifferenceJacobianScratch,
): void {
  const n = y.length;
  const { yPerturbed, fPlus, fMinus } = scratch;
  yPerturbed.set(y);

  for (let j = 0; j < n; j++) {
    const yj = y[j]!;
    const h = Math.sqrt(Number.EPSILON) * Math.max(Math.abs(yj), 1);

    yPerturbed[j] = yj + h;
    rhs(t, yPerturbed, fPlus);
    yPerturbed[j] = yj - h;
    rhs(t, yPerturbed, fMinus);
    yPerturbed[j] = yj;

    const invTwoH = 1 / (2 * h);
    for (let i = 0; i < n; i++) {
      out[n * i + j] = (fPlus[i]! - fMinus[i]!) * invTwoH;
    }
  }
}
