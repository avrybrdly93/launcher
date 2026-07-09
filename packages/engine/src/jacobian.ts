import type { EvalContext } from "./eval-context.js";
import { norm } from "./vec2.js";

const X = 0;
const Y = 1;
const VX = 2;
const VY = 3;
const DIM = 4;

/**
 * Analytic Jacobian J = df/dy (eq. 3.17) of the planar projectile RHS under
 * gravity + quadratic drag only — the (3.18) force set with Magnus and
 * linear drag/buoyancy omitted (Magnus's cross terms and Re-dependent Cd are
 * P1.23's finite-difference fallback territory, not this closed form).
 *
 * Assumes the platform's default, position/time-independent configuration
 * for the remaining pieces — ConstantAtmosphere (rho fixed), non-altitude
 * UniformGravity (g fixed), zero/uniform wind (w fixed), ConstantCd (Cd
 * fixed) — under which rho/g/Cd/w carry no dependence on y, so the position
 * rows and the position columns of the velocity rows are identically zero;
 * only d(accel)/d(velocity) is nonzero. `ctx` still supplies rho/Cd/wind so
 * this stays consistent with whatever environment/params the caller wired
 * up, it just assumes their *derivatives* w.r.t. state are zero.
 *
 * `out` is row-major dim x dim: out[i*DIM+j] = d f_i / d y_j.
 */
export function gravityQuadraticDragJacobian(
  _t: number,
  y: Float64Array,
  out: Float64Array,
  ctx: EvalContext,
): void {
  const x = y[X]!;
  const yPos = y[Y]!;
  const vx = y[VX]!;
  const vy = y[VY]!;

  ctx.environment.sample(_t, x, yPos, ctx.env);
  ctx.vRel[0] = vx - ctx.env.wx;
  ctx.vRel[1] = vy - ctx.env.wy;
  ctx.speedRel = norm(ctx.vRel);
  ctx.re = (ctx.env.rho * ctx.speedRel * (2 * ctx.params.radius)) / ctx.env.eta;
  ctx.mach = ctx.env.c > 0 ? ctx.speedRel / ctx.env.c : 0;

  for (let i = 0; i < DIM * DIM; i++) out[i] = 0;

  // dx/dt = vx, dy/dt = vy
  out[X * DIM + VX] = 1;
  out[Y * DIM + VY] = 1;

  const ux = ctx.vRel[0];
  const uy = ctx.vRel[1];
  const speed = ctx.speedRel;
  if (speed === 0) return; // d(u*u)/du -> 0 as speed -> 0 (u*u is C1 there, §3.8)

  const cd = ctx.params.dragCoefficient.cd(ctx.re, ctx.mach);
  const k = (0.5 * ctx.env.rho * cd * ctx.params.area) / ctx.params.mass;

  // g1 = |u|*ux, g2 = |u|*uy; d(gi)/d(uj) below, and d(u)/d(v) = I since
  // wind is assumed velocity-independent (and, per the header note,
  // position/time-independent too).
  const dG1Dux = (speed * speed + ux * ux) / speed;
  const dG1Duy = (ux * uy) / speed;
  const dG2Dux = dG1Duy;
  const dG2Duy = (speed * speed + uy * uy) / speed;

  out[VX * DIM + VX] = -k * dG1Dux;
  out[VX * DIM + VY] = -k * dG1Duy;
  out[VY * DIM + VX] = -k * dG2Dux;
  out[VY * DIM + VY] = -k * dG2Duy;
}
