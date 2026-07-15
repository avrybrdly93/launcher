import type { EvalContext } from "./eval-context.js";

const Y = 1;
const VX = 2;
const VY = 3;

/**
 * Mechanical energy E = (1/2)m|v|^2 + mgy for the planar projectile state
 * (§3.8 eq. before 3.19). Requires `ctx.env.g` to already reflect the
 * environment sampled at this (t, y) — callers that don't already have a
 * fresh ctx.env (e.g. right after an `rhs` call) must sample it first.
 */
export function mechanicalEnergy(y: Float64Array, ctx: EvalContext): number {
  const vx = y[VX]!;
  const vy = y[VY]!;
  return 0.5 * ctx.params.mass * (vx * vx + vy * vy) + ctx.params.mass * ctx.env.g * y[Y]!;
}
