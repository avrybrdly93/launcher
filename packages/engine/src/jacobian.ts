import type { EvalContext } from "./eval-context.js";

const X = 0;
const Y = 1;
const VX = 2;
const VY = 3;
const DIM = 4;

const SPEED_EPS = 1e-9;

/**
 * Analytic Jacobian df/dy (row-major, dim*dim = 16 entries) of the planar
 * rhs (eq. 3.17-3.18) restricted to gravity + quadratic drag only (no
 * Magnus, buoyancy, or linear drag) — P1.22. Freezes rho, Cd, and wind at
 * their values sampled at (t, x, y): it differentiates through u = |v_rel|
 * (the only state-dependent factor gravity+quadratic-drag actually varies
 * with locally) but not through d(rho)/dr, dCd/dRe, or dw/dr. This is exact
 * for ConstantCd with a uniform atmosphere and position/time-independent
 * wind (the scenario this task's validation exercises); for a Cd(Re) model
 * or spatially-varying rho/wind it is the standard frozen-coefficient
 * approximation used for Newton-iteration Jacobians (good enough for local
 * convergence, not claimed exact) — P1.23's finite-difference fallback
 * covers the fully general case.
 */
export function gravityQuadraticDragJacobian(
  t: number,
  y: Float64Array,
  ctx: EvalContext,
  out: Float64Array,
): void {
  const vx = y[VX]!;
  const vy = y[VY]!;

  ctx.environment.sample(t, y[X]!, y[Y]!, ctx.env);
  const ux = vx - ctx.env.wx;
  const uy = vy - ctx.env.wy;
  const u = Math.hypot(ux, uy);

  const re = (ctx.env.rho * u * (2 * ctx.params.radius)) / ctx.env.eta;
  const mach = ctx.env.c > 0 ? u / ctx.env.c : 0;
  const cd = ctx.params.dragCoefficient.cd(re, mach);
  const kd = (ctx.env.rho * cd * ctx.params.area) / (2 * ctx.params.mass);

  out.fill(0);
  out[X * DIM + VX] = 1; // dx/dt = vx
  out[Y * DIM + VY] = 1; // dy/dt = vy

  // Drag's contribution to d(v.)/d(v.) vanishes smoothly as u -> 0 (P1.09);
  // computing ux*ux/u etc. directly at u=0 would divide 0/0, so guard it.
  if (u < SPEED_EPS) return;

  out[VX * DIM + VX] = (-kd * (ux * ux)) / u - kd * u;
  out[VX * DIM + VY] = (-kd * (ux * uy)) / u;
  out[VY * DIM + VX] = (-kd * (ux * uy)) / u;
  out[VY * DIM + VY] = (-kd * (uy * uy)) / u - kd * u;
}

/** Central-difference Jacobian of a `Model.rhs`, dim*dim row-major, reused across calls. */
export type FiniteDifferenceJacobianFn = (
  t: number,
  y: Float64Array,
  ctx: EvalContext,
  out: Float64Array,
) => void;

const CBRT_MACHINE_EPS = Math.cbrt(Number.EPSILON);

/**
 * Generic finite-difference Jacobian fallback for any Model.rhs (P1.23),
 * for use where no analytic `jacobian` (P1.22-style) is available. Central
 * differences with per-component scaled step h_j = eps^(1/3)*max(1,|y_j|):
 * that step size balances O(h^2) truncation error against O(eps/h) rounding
 * error, the standard choice for central-difference Jacobians. Scratch
 * buffers are allocated once at construction and reused on every call.
 */
export function createFiniteDifferenceJacobian(
  rhs: (t: number, y: Float64Array, out: Float64Array, ctx: EvalContext) => void,
  dim: number,
): FiniteDifferenceJacobianFn {
  const yPerturbed = new Float64Array(dim);
  const fPlus = new Float64Array(dim);
  const fMinus = new Float64Array(dim);

  return (t: number, y: Float64Array, ctx: EvalContext, out: Float64Array): void => {
    yPerturbed.set(y);
    for (let j = 0; j < dim; j++) {
      const yj = y[j]!;
      const h = CBRT_MACHINE_EPS * Math.max(1, Math.abs(yj));
      yPerturbed[j] = yj + h;
      rhs(t, yPerturbed, fPlus, ctx);
      yPerturbed[j] = yj - h;
      rhs(t, yPerturbed, fMinus, ctx);
      yPerturbed[j] = yj;
      for (let i = 0; i < dim; i++) {
        out[i * dim + j] = (fPlus[i]! - fMinus[i]!) / (2 * h);
      }
    }
  };
}
