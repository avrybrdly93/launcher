import type { EvalContext } from "./eval-context.js";
import type { Model } from "./model.js";

/** State/Jacobian dimension for the planar projectile (x, y, vx, vy). */
export const PLANAR_JACOBIAN_DIM = 4;

const X = 0;
const Y = 1;
const VX = 2;
const VY = 3;

/** Below this relative speed, drag and all its derivatives are treated as exactly zero (P1.09-style guard). */
const REL_SPEED_EPS = 1e-12;

/**
 * Analytic Jacobian J = df/dy (eq. 3.18, gravity + quadratic drag only, no
 * Magnus) for the planar projectile state y = (x, y, vx, vy). `out` is a
 * caller-owned, row-major 4x4 buffer: out[i*4+j] = df_i/dy_j.
 *
 * Exact for a `ConstantCd` drag model (P1.08) under any environment whose
 * sample is independent of state (ConstantAtmosphere, non-altitude-dependent
 * UniformGravity, ZeroWind/uniform wind) -- the only environment components
 * implemented in Phase 1. A Reynolds/Mach-dependent Cd (P1.12) would add a
 * dCd/dRe * dRe/dv term this function does not include; that extension is
 * out of scope for this task's "no Magnus" analytic case.
 *
 * With u = v - w, u = |u|, k_d = rho*Cd*A/(2m):
 *   d(ax)/dvx = -k_d*(ux^2/u + u),  d(ax)/dvy = -k_d*ux*uy/u
 *   d(ay)/dvx = -k_d*ux*uy/u,       d(ay)/dvy = -k_d*(uy^2/u + u)
 * with all other partials zero (x, y do not otherwise appear in the rhs
 * under a state-independent environment), and the whole drag block set to
 * zero in the u -> 0 limit (each term above is bounded by k_d*u -> 0).
 */
export function gravityQuadraticDragJacobian(
  t: number,
  y: Float64Array,
  ctx: EvalContext,
  out: Float64Array,
): void {
  const x = y[X]!;
  const yPos = y[Y]!;
  const vx = y[VX]!;
  const vy = y[VY]!;

  ctx.environment.sample(t, x, yPos, ctx.env);
  const ux = vx - ctx.env.wx;
  const uy = vy - ctx.env.wy;
  const u = Math.hypot(ux, uy);

  out.fill(0);
  out[X * PLANAR_JACOBIAN_DIM + VX] = 1;
  out[Y * PLANAR_JACOBIAN_DIM + VY] = 1;

  if (u <= REL_SPEED_EPS) return;

  const re = (ctx.env.rho * u * (2 * ctx.params.radius)) / ctx.env.eta;
  const mach = ctx.env.c > 0 ? u / ctx.env.c : 0;
  const cd = ctx.params.dragCoefficient.cd(re, mach);
  const kd = (0.5 * ctx.env.rho * cd * ctx.params.area) / ctx.params.mass;
  const invU = 1 / u;

  const daxDvx = -kd * (ux * ux * invU + u);
  const daxDvy = -kd * ux * uy * invU;
  const dayDvy = -kd * (uy * uy * invU + u);

  out[VX * PLANAR_JACOBIAN_DIM + VX] = daxDvx;
  out[VX * PLANAR_JACOBIAN_DIM + VY] = daxDvy;
  out[VY * PLANAR_JACOBIAN_DIM + VX] = daxDvy;
  out[VY * PLANAR_JACOBIAN_DIM + VY] = dayDvy;
}

/** Relative step scale for the FD Jacobian: sqrt(machine epsilon), the standard central-difference-optimal choice. */
const FD_REL_STEP = Math.sqrt(Number.EPSILON);
/** Absolute floor on the step so components with y_j == 0 still get a finite, well-scaled perturbation. */
const FD_TYPICAL_SCALE = 1;

/** Preallocated buffers for `finiteDifferenceJacobian`, sized once per model dimension and reused across calls. */
export interface FiniteDifferenceScratch {
  readonly yPerturbed: Float64Array;
  readonly fPlus: Float64Array;
  readonly fMinus: Float64Array;
}

export function createFiniteDifferenceScratch(dim: number): FiniteDifferenceScratch {
  return {
    yPerturbed: new Float64Array(dim),
    fPlus: new Float64Array(dim),
    fMinus: new Float64Array(dim),
  };
}

/**
 * Generic central finite-difference Jacobian fallback (P1.23): works for any
 * `Model`, used where no analytic `Model.jacobian` is available (e.g. once
 * Magnus or a non-constant Cd is in play). Column j is estimated by
 * perturbing y_j by a scaled step h_j = sqrt(eps)*max(|y_j|, 1) -- large
 * enough to survive floating-point cancellation, small enough to keep
 * truncation error low -- rather than a single fixed step across all
 * components, whose scale would be wrong whenever state components differ
 * by orders of magnitude (positions in meters vs. e.g. a slow spin-decay
 * state). `out` is row-major dim x dim: out[i*dim+j] = df_i/dy_j. Zero-alloc
 * given a `scratch` sized by `createFiniteDifferenceScratch(model.dim)`.
 */
export function finiteDifferenceJacobian(
  model: Model,
  t: number,
  y: Float64Array,
  ctx: EvalContext,
  scratch: FiniteDifferenceScratch,
  out: Float64Array,
): void {
  const dim = model.dim;
  const { yPerturbed, fPlus, fMinus } = scratch;
  yPerturbed.set(y);

  for (let j = 0; j < dim; j++) {
    const yj = y[j]!;
    const h = FD_REL_STEP * Math.max(Math.abs(yj), FD_TYPICAL_SCALE);

    yPerturbed[j] = yj + h;
    model.rhs(t, yPerturbed, fPlus, ctx);
    yPerturbed[j] = yj - h;
    model.rhs(t, yPerturbed, fMinus, ctx);
    yPerturbed[j] = yj;

    const invTwoH = 1 / (2 * h);
    for (let i = 0; i < dim; i++) {
      out[i * dim + j] = (fPlus[i]! - fMinus[i]!) * invTwoH;
    }
  }
}
