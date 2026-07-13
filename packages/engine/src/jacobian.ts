import type { EvalContext } from "./eval-context.js";
import type { Model } from "./model.js";

const X = 0;
const Y = 1;
const VX = 2;
const VY = 3;
const DIM = 4;

/**
 * Analytic ∂f/∂y for gravity + quadratic drag (eq. 3.18 with the Magnus term
 * omitted), row-major in `out` (`out[i*DIM+j]` = ∂f_i/∂y_j, dim 4x4).
 *
 * Exact whenever Cd, ρ and the wind field are state-independent at the query
 * point — true for every environment/drag-coefficient combination available
 * so far (ConstantAtmosphere, uniform gravity, zero/uniform wind, and any
 * DragCoefficientModel evaluated at the frozen (Re, Mach) of this point,
 * since none of those model the *feedback* of Cd's own state-dependence).
 * A model that needs that feedback term, or position-dependent ρ/wind/g,
 * requires the generic finite-difference Jacobian (P1.23) instead.
 */
export function gravityQuadraticDragJacobian(
  t: number,
  y: Float64Array,
  out: Float64Array,
  ctx: EvalContext,
): void {
  out.fill(0);
  out[X * DIM + VX] = 1;
  out[Y * DIM + VY] = 1;

  const vx = y[VX]!;
  const vy = y[VY]!;

  ctx.environment.sample(t, y[X]!, y[Y]!, ctx.env);
  const ux = vx - ctx.env.wx;
  const uy = vy - ctx.env.wy;
  const u = Math.hypot(ux, uy);

  // Removable singularity of u*u_vec at u=0 (§3.8): the function is C1 there
  // with gradient 0, so the velocity-coupling block stays exactly zero.
  if (u === 0) return;

  const re = (ctx.env.rho * u * (2 * ctx.params.radius)) / ctx.env.eta;
  const mach = ctx.env.c > 0 ? u / ctx.env.c : 0;
  const cd = ctx.params.dragCoefficient.cd(re, mach);
  const k = (0.5 * ctx.env.rho * cd * ctx.params.area) / ctx.params.mass;

  out[VX * DIM + VX] = -k * (u + (ux * ux) / u);
  out[VX * DIM + VY] = (-k * ux * uy) / u;
  out[VY * DIM + VX] = (-k * ux * uy) / u;
  out[VY * DIM + VY] = -k * (u + (uy * uy) / u);
}

/**
 * eps^(1/3), the standard central-difference step scale: it balances the
 * O(h^2) Taylor truncation error against the O(eps/h) subtractive-
 * cancellation rounding error from computing f(y+h)-f(y-h). sqrt(eps) is
 * the *forward*-difference optimum and is too small (noisier) here.
 */
const FD_STEP_SCALE = Math.cbrt(Number.EPSILON);

/**
 * Generic central-difference ∂f/∂y for any Model (P1.23), row-major in
 * `out` (dim*dim). Steps are scaled by state magnitude,
 * `h_j = FD_STEP_SCALE * max(1, |y_j|)`, rather than a fixed absolute step,
 * so components at very different scales (e.g. position in meters vs. a
 * near-zero velocity) each get an appropriately sized perturbation.
 *
 * This is the fallback for any force composition an analytic Jacobian (e.g.
 * gravityQuadraticDragJacobian, P1.22) doesn't cover — Magnus, buoyancy,
 * linear drag, or any DragCoefficientModel whose Cd genuinely varies with
 * state. It allocates three dim-length scratch buffers per call; unlike
 * Model.rhs this is not a hot path (ADR-004 zero-allocation guarantee
 * applies to rhs, not to Jacobian evaluation), so that's acceptable.
 */
export function finiteDifferenceJacobian(
  model: Model,
  t: number,
  y: Float64Array,
  out: Float64Array,
  ctx: EvalContext,
): void {
  const n = model.dim;
  const yPerturbed = Float64Array.from(y);
  const fPlus = new Float64Array(n);
  const fMinus = new Float64Array(n);

  for (let j = 0; j < n; j++) {
    const orig = y[j]!;
    const h = FD_STEP_SCALE * Math.max(1, Math.abs(orig));

    yPerturbed[j] = orig + h;
    model.rhs(t, yPerturbed, fPlus, ctx);
    yPerturbed[j] = orig - h;
    model.rhs(t, yPerturbed, fMinus, ctx);
    yPerturbed[j] = orig;

    for (let i = 0; i < n; i++) {
      out[i * n + j] = (fPlus[i]! - fMinus[i]!) / (2 * h);
    }
  }
}
