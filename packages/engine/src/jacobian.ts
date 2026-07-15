import type { EvalContext } from "./eval-context.js";

const X = 0;
const Y = 1;
const VX = 2;
const VY = 3;
const DIM = 4;

/** Below this relative speed, the drag-term partials are treated as exactly zero (see below). */
const SPEED_EPS = 1e-9;

/**
 * Analytic Jacobian J = df/dy for the planar gravity + quadratic-drag RHS
 * (eq. 3.18 with Magnus, linear drag, and buoyancy omitted). `out` is
 * row-major, dim*dim = 16 entries: out[i*4+j] = df_i/dy_j for
 * y = (x, y, vx, vy).
 *
 * rho, Cd, and wind are sampled once at (t, y) and then held fixed while
 * differentiating -- exact whenever the atmosphere, drag-coefficient model,
 * and wind field are position/velocity-independent (the default
 * ConstantAtmosphere + ConstantCd + ZeroWind/uniform-wind configuration used
 * throughout Phase 1), a frozen-coefficient approximation otherwise.
 *
 * At v_rel = 0 the drag term u*u_rel is differentiable with gradient exactly
 * zero (it is O(|v_rel|^2) near the origin, per the C1-but-not-C2 kink noted
 * in §3.8) so the guard below returns the analytically-correct zero rather
 * than a 0/0 NaN.
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
  const kd = (ctx.env.rho * cd * ctx.params.area) / (2 * ctx.params.mass);

  out.fill(0);
  out[X * DIM + VX] = 1; // dx'/dvx = 1
  out[Y * DIM + VY] = 1; // dy'/dvy = 1

  if (u < SPEED_EPS) {
    return;
  }

  const along = u + (ux * ux) / u; // d(u*ux)/dux == d(u*uy)/duy with ux<->uy swapped
  const alongY = u + (uy * uy) / u;
  const cross = (ux * uy) / u; // d(u*ux)/duy == d(u*uy)/dux

  out[VX * DIM + VX] = -kd * along; // d(ax)/dvx
  out[VX * DIM + VY] = -kd * cross; // d(ax)/dvy
  out[VY * DIM + VX] = -kd * cross; // d(ay)/dvx
  out[VY * DIM + VY] = -kd * alongY; // d(ay)/dvy
}
