import type { EvalContext } from "./eval-context.js";

const X = 0;
const Y = 1;
const VX = 2;
const VY = 3;
const DIM = 4;

const DRAG_JACOBIAN_SPEED_EPS = 1e-12;

/**
 * Analytic Jacobian J = df/dy (§3.7 Model.jacobian) for the two-force system
 * gravity + quadratic drag (no Magnus, no buoyancy). `out` is row-major
 * dim*dim (16 entries): out[row*4+col] = d f_row / d y_col.
 *
 * The closed form assumes the sampled environment (g, rho, wind) is locally
 * frozen at (t, x, y) -- exact for every Environment currently implemented
 * (ConstantAtmosphere, UniformGravity, ZeroWind/uniform wind are all
 * spatially uniform) -- and treats the drag coefficient as locally constant,
 * i.e. ignores d(Cd)/d(Re); exact for ConstantCd, a local linearization
 * otherwise. Models needing spatially-varying environments, Cd(Re) slope, or
 * Magnus/buoyancy fall back to the generic finite-difference Jacobian (P1.23).
 *
 * Derivation: with u = v - w, u = |u|, k_d = rho*Cd*A/(2m),
 * a = -k_d * u * u (vector), the identity d(|u| u_i)/du_j = u_i u_j/|u| +
 * |u| delta_ij gives the drag block below; d(u_i)/d(v_j) = delta_ij since
 * the wind is treated as locally constant.
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

  const re = (ctx.env.rho * u * (2 * ctx.params.radius)) / ctx.env.eta;
  const mach = ctx.env.c > 0 ? u / ctx.env.c : 0;
  const cd = ctx.params.dragCoefficient.cd(re, mach);
  const kd = (0.5 * ctx.env.rho * cd * ctx.params.area) / ctx.params.mass;

  out.fill(0);

  out[X * DIM + VX] = 1;
  out[Y * DIM + VY] = 1;

  if (u < DRAG_JACOBIAN_SPEED_EPS) {
    return;
  }

  out[VX * DIM + VX] = -kd * (u + (ux * ux) / u);
  out[VX * DIM + VY] = -kd * ((ux * uy) / u);
  out[VY * DIM + VX] = -kd * ((uy * ux) / u);
  out[VY * DIM + VY] = -kd * (u + (uy * uy) / u);
}
