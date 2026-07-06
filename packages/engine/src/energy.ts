import type { EvalContext } from "./eval-context.js";

const Y = 1;
const VX = 2;
const VY = 3;

/**
 * Mechanical energy E = (1/2)*m*|v|^2 + m*g*y (eq. 3.19 preamble): the
 * conserved-or-monotone quantity §3.8 describes -- conserved with all aero
 * forces off, monotone non-increasing with drag on in still air. Requires
 * `ctx.env` already sampled at the state's (t, x, y) (for g and, per the
 * altitude-dependent gravity flag, its position dependence).
 */
export function mechanicalEnergy(y: Float64Array, ctx: EvalContext): number {
  const vx = y[VX]!;
  const vy = y[VY]!;
  const kinetic = 0.5 * ctx.params.mass * (vx * vx + vy * vy);
  const potential = ctx.params.mass * ctx.env.g * y[Y]!;
  return kinetic + potential;
}
