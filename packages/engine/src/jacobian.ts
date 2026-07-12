import type { EvalContext } from "./eval-context.js";
import type { Model } from "./model.js";
import { norm } from "./vec2.js";

const X = 0;
const Y = 1;
const VX = 2;
const VY = 3;
const DIM = 4;

const SPEED_EPS = 1e-9;

/**
 * Analytic Jacobian J = ∂f/∂y (row-major DIM×DIM, `out[DIM*i+j] = df_i/dy_j`)
 * for the gravity + quadratic-drag rhs (eq. 3.18 with the Magnus term
 * dropped). Two simplifications bound its validity, both matched by the
 * ConstantCd + spatially-uniform-environment configuration this is tested
 * against:
 *
 *  - `Cd` is treated as frozen at its value for the current (Re, Mach) —
 *    the true rhs's dependence on Re through `dragCoefficient.cd` is not
 *    differentiated. Exact whenever Cd is state-independent (ConstantCd,
 *    P1.10); an approximation otherwise (ignores ∂Cd/∂Re).
 *  - atmosphere/gravity/wind are assumed spatially uniform at the
 *    evaluation point, so ∂f/∂x = ∂f/∂y_pos = 0 for the velocity rows.
 *    (Position-dependent fields — altitude gravity, wind shear — are out
 *    of this task's scope; P1.23's finite-difference fallback covers them.)
 *
 * At v_rel = 0 the quadratic-drag term u·u is C¹ but not C² (§3.8); this
 * Jacobian's aero block is continuous there with value 0, so no guard is
 * needed beyond avoiding the 0/0 in `ux²/u` — see `SPEED_EPS` below.
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
  ctx.vRel[0] = ux;
  ctx.vRel[1] = uy;
  const u = norm(ctx.vRel);

  const re = ctx.env.eta > 0 ? (ctx.env.rho * u * (2 * ctx.params.radius)) / ctx.env.eta : 0;
  const mach = ctx.env.c > 0 ? u / ctx.env.c : 0;
  const cd = ctx.params.dragCoefficient.cd(re, mach);
  const k = (0.5 * ctx.env.rho * cd * ctx.params.area) / ctx.params.mass;

  out.fill(0);
  out[DIM * X + VX] = 1;
  out[DIM * Y + VY] = 1;

  if (u > SPEED_EPS) {
    const invU = 1 / u;
    const dVxDvx = -k * (u + ux * ux * invU);
    const dVxDvy = -k * ux * uy * invU;
    const dVyDvy = -k * (u + uy * uy * invU);

    out[DIM * VX + VX] = dVxDvx;
    out[DIM * VX + VY] = dVxDvy;
    out[DIM * VY + VX] = dVxDvy;
    out[DIM * VY + VY] = dVyDvy;
  }
}

/** Optimal relative step for a central difference of an O(1)-scale smooth function. */
const FD_STEP = Math.cbrt(Number.EPSILON);

/** Caller-owned scratch for {@link finiteDifferenceJacobian} so repeated calls (e.g. inside a Newton iteration) stay allocation-free. */
export interface FiniteDifferenceJacobianScratch {
  readonly yPerturbed: Float64Array;
  readonly outPlus: Float64Array;
  readonly outMinus: Float64Array;
}

export function createFiniteDifferenceJacobianScratch(
  dim: number,
): FiniteDifferenceJacobianScratch {
  return {
    yPerturbed: new Float64Array(dim),
    outPlus: new Float64Array(dim),
    outMinus: new Float64Array(dim),
  };
}

/**
 * Generic central-difference Jacobian J = ∂f/∂y for any `Model`, used as the
 * fallback when a model has no analytic `jacobian` (P1.23) — e.g. for models
 * with position-dependent environments (wind shear, altitude gravity) that
 * {@link gravityQuadraticDragJacobian} deliberately doesn't cover, or with
 * Magnus enabled. Each column `j` uses its own scaled step
 * `h_j = FD_STEP * max(1, |y_j|)`, the standard scaling that keeps the step
 * meaningful for both small and large state components. `out` is row-major
 * `dim×dim` (`out[dim*i+j] = df_i/dy_j`).
 */
export function finiteDifferenceJacobian(
  model: Model,
  t: number,
  y: Float64Array,
  ctx: EvalContext,
  out: Float64Array,
  scratch: FiniteDifferenceJacobianScratch,
): void {
  const dim = model.dim;
  const { yPerturbed, outPlus, outMinus } = scratch;
  yPerturbed.set(y);

  for (let j = 0; j < dim; j++) {
    const yj = y[j]!;
    const h = FD_STEP * Math.max(1, Math.abs(yj));

    yPerturbed[j] = yj + h;
    model.rhs(t, yPerturbed, outPlus, ctx);

    yPerturbed[j] = yj - h;
    model.rhs(t, yPerturbed, outMinus, ctx);

    yPerturbed[j] = yj;

    const invTwoH = 1 / (2 * h);
    for (let i = 0; i < dim; i++) {
      out[dim * i + j] = (outPlus[i]! - outMinus[i]!) * invTwoH;
    }
  }
}
