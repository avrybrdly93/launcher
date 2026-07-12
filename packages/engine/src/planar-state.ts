import type { EvalContext } from "./eval-context.js";
import { norm } from "./vec2.js";

/** Index layout of the planar-projectile state vector y = (x, y, vx, vy) (§3.7). */
export const X = 0;
export const Y = 1;
export const VX = 2;
export const VY = 3;

/**
 * Samples the environment at the current (t, x, y) and derives v_rel,
 * |v_rel|, Re, Mach into `ctx` — the shared priming step every planar-model
 * consumer (rhs, the energy diagnostics in energy.ts) needs before reading
 * force-composition-dependent fields off `ctx`. Lives in its own leaf module
 * so planar-projectile-model.ts and energy.ts can both depend on it without
 * a cycle between them.
 */
export function primePlanarEvalContext(t: number, y: Float64Array, ctx: EvalContext): void {
  const x = y[X]!;
  const yPos = y[Y]!;
  const vx = y[VX]!;
  const vy = y[VY]!;

  ctx.environment.sample(t, x, yPos, ctx.env);

  ctx.vRel[0] = vx - ctx.env.wx;
  ctx.vRel[1] = vy - ctx.env.wy;
  ctx.speedRel = norm(ctx.vRel);
  ctx.re = (ctx.env.rho * ctx.speedRel * (2 * ctx.params.radius)) / ctx.env.eta;
  ctx.mach = ctx.env.c > 0 ? ctx.speedRel / ctx.env.c : 0;
}
