import type { EvalContext } from "./eval-context.js";
import type { Model } from "./model.js";

/** sqrt(machine epsilon): the standard central-difference step-scale tradeoff (truncation ~ h^2 vs. roundoff ~ eps/h). */
const FD_STEP_SCALE = Math.sqrt(Number.EPSILON);

const X = 0;
const Y = 1;
const VX = 2;
const VY = 3;
const DIM = 4;

const SPEED_EPS = 1e-9;

/**
 * Analytic Jacobian J = df/dy (§3.7, §3.8) for a planar model composed of
 * gravity + quadratic drag only (no Magnus, no buoyancy, no linear drag).
 * Row-major: `out[i*DIM+j]` = df_i/dy_j.
 *
 * Simplifying assumptions, matching this task's scope (P1.22; a fully
 * general model falls back to the finite-difference Jacobian, P1.23):
 * - the drag-coefficient model has zero *local* sensitivity to Re/Mach at
 *   the evaluation point (exact for `ConstantCd`; a tabulated Cd(Re) would
 *   need an additional dCd/dRe term this does not compute);
 * - wind does not vary with position (dw/dr = 0), so d(v_rel)/dy reduces to
 *   dv/dy;
 * - the atmosphere does not vary with position (drho/dy = 0).
 *
 * With u = |v_rel|, u_x = vx - wx, u_y = vy - wy, k_d = rho*Cd*A/(2m):
 * a_x = -k_d*u*u_x, a_y = -g - k_d*u*u_y (eq. 3.18 without the Magnus term).
 * Since u*u_vec = grad_v(|v_rel|^3/3), the velocity block of J is symmetric:
 *   da_x/dvx = -k_d*(u + u_x^2/u),  da_x/dvy = da_y/dvx = -k_d*u_x*u_y/u
 *   da_y/dvy = -k_d*(u + u_y^2/u)
 * At u -> 0 every entry of this block -> 0 (the drag force is C1 but not C2
 * at v_rel=0, §3.8): the limit is taken explicitly below to avoid the 0/0
 * that a literal division would produce.
 */
export function createGravityQuadraticDragJacobian(
  ctx: EvalContext,
): NonNullable<Model["jacobian"]> {
  return (t: number, y: Float64Array, out: Float64Array): void => {
    const x = y[X]!;
    const yPos = y[Y]!;
    const vx = y[VX]!;
    const vy = y[VY]!;

    ctx.environment.sample(t, x, yPos, ctx.env);
    const ux = vx - ctx.env.wx;
    const uy = vy - ctx.env.wy;
    const u = Math.hypot(ux, uy);
    const re = (ctx.env.rho * u * (2 * ctx.params.radius)) / ctx.env.eta;
    const mach = ctx.env.c > 0 ? u / ctx.env.c : 0;
    const cd = ctx.params.dragCoefficient.cd(re, mach);
    const kd = (0.5 * ctx.env.rho * cd * ctx.params.area) / ctx.params.mass;

    out.fill(0);
    out[X * DIM + VX] = 1; // dx'/dvx
    out[Y * DIM + VY] = 1; // dy'/dvy

    if (u < SPEED_EPS) {
      return;
    }

    const dax_dvx = -kd * (u + (ux * ux) / u);
    const dax_dvy = -kd * ((ux * uy) / u);
    const day_dvy = -kd * (u + (uy * uy) / u);

    out[VX * DIM + VX] = dax_dvx;
    out[VX * DIM + VY] = dax_dvy;
    out[VY * DIM + VX] = dax_dvy;
    out[VY * DIM + VY] = day_dvy;
  };
}

/**
 * Generic central-difference Jacobian, the fallback for any `Model` that
 * does not supply an analytic `jacobian` (e.g. P1.22's gravity+quadratic-drag
 * case, or a model with Magnus/buoyancy/non-constant atmosphere where the
 * analytic derivative isn't implemented). Column j is perturbed by a
 * *scaled* step h_j = sqrt(eps)*max(|y_j|, 1) — scaling to the state's own
 * magnitude keeps the truncation/roundoff tradeoff well-balanced whether y_j
 * is O(1) or O(1e5), unlike a single fixed absolute step.
 *
 * Row-major: `out[i*dim+j]` = df_i/dy_j. Scratch buffers are preallocated
 * once per model (closed over), not per call, so repeated evaluation (e.g.
 * inside a Newton iteration) does not allocate on every step.
 */
export function createFiniteDifferenceJacobian(
  model: Model,
  ctx: EvalContext,
): NonNullable<Model["jacobian"]> {
  const dim = model.dim;
  const yPerturbed = new Float64Array(dim);
  const fPlus = new Float64Array(dim);
  const fMinus = new Float64Array(dim);

  return (t: number, y: Float64Array, out: Float64Array): void => {
    yPerturbed.set(y);

    for (let col = 0; col < dim; col++) {
      const yCol = y[col]!;
      const h = FD_STEP_SCALE * Math.max(1, Math.abs(yCol));

      yPerturbed[col] = yCol + h;
      model.rhs(t, yPerturbed, fPlus, ctx);
      yPerturbed[col] = yCol - h;
      model.rhs(t, yPerturbed, fMinus, ctx);
      yPerturbed[col] = yCol;

      const inv2h = 1 / (2 * h);
      for (let row = 0; row < dim; row++) {
        out[row * dim + col] = (fPlus[row]! - fMinus[row]!) * inv2h;
      }
    }
  };
}
