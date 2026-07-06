import type { EvalContext } from "./eval-context.js";
import { norm } from "./vec2.js";

const X = 0;
const Y = 1;
const VX = 2;
const VY = 3;
const DIM = 4;

const SPEED_EPS = 1e-9;

/**
 * Analytic Jacobian J = df/dy (eq. 3.18, gravity + quadratic drag only, no
 * Magnus) for the planar projectile state y=(x,y,vx,vy). `out` is row-major,
 * length dim*dim=16: out[i*4+j] = d(f_i)/d(y_j).
 *
 * Assumes a position/time-independent environment (constant atmosphere,
 * non-altitude-dependent gravity, uniform-or-zero wind) and a speed-independent
 * drag coefficient, so d(rho)/dr = dg/dy = dw/dr = dCd/dRe = 0 — the only
 * nonzero block is d(acceleration)/d(velocity), since u*u_i is homogeneous
 * degree 2 in v_rel. As |v_rel| -> 0 that block's analytic limit is exactly
 * zero (matching the C^1-but-not-C^2 kink at v_rel=0, §3.8), so speeds below
 * SPEED_EPS take the zero branch rather than dividing by a near-zero norm.
 */
export function gravityQuadraticDragJacobian(
  t: number,
  y: Float64Array,
  out: Float64Array,
  ctx: EvalContext,
): void {
  const x = y[X]!;
  const yPos = y[Y]!;
  const vx = y[VX]!;
  const vy = y[VY]!;

  ctx.environment.sample(t, x, yPos, ctx.env);
  ctx.vRel[0] = vx - ctx.env.wx;
  ctx.vRel[1] = vy - ctx.env.wy;
  const ux = ctx.vRel[0];
  const uy = ctx.vRel[1];
  const u = norm(ctx.vRel);
  ctx.speedRel = u;
  ctx.re = (ctx.env.rho * u * (2 * ctx.params.radius)) / ctx.env.eta;
  ctx.mach = ctx.env.c > 0 ? u / ctx.env.c : 0;

  const cd = ctx.params.dragCoefficient.cd(ctx.re, ctx.mach);
  const kd = (0.5 * ctx.env.rho * cd * ctx.params.area) / ctx.params.mass;

  out.fill(0);
  out[X * DIM + VX] = 1;
  out[Y * DIM + VY] = 1;

  if (u > SPEED_EPS) {
    const dUxDvx = u + (ux * ux) / u;
    const dUxDvy = (ux * uy) / u;
    const dUyDvy = u + (uy * uy) / u;
    out[VX * DIM + VX] = -kd * dUxDvx;
    out[VX * DIM + VY] = -kd * dUxDvy;
    out[VY * DIM + VX] = -kd * dUxDvy;
    out[VY * DIM + VY] = -kd * dUyDvy;
  }
}
