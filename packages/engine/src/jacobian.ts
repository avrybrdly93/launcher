import type { EvalContext } from "./eval-context.js";

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
