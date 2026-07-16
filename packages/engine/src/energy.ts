import type { EvalContext } from "./eval-context.js";

const Y = 1;
const VX = 2;
const VY = 3;

/**
 * Mechanical energy E = KE + PE = (1/2)m|v|^2 + mgy (§3.8, eq. 3.19). `g` is
 * read from `ctx.env` (refreshed by the last `rhs` call for this `y`) rather
 * than hardcoded, so it tracks whatever GravityModel produced it.
 */
export function mechanicalEnergy(y: Float64Array, ctx: EvalContext): number {
  const mass = ctx.params.mass;
  const vx = y[VX]!;
  const vy = y[VY]!;
  return 0.5 * mass * (vx * vx + vy * vy) + mass * ctx.env.g * y[Y]!;
}
