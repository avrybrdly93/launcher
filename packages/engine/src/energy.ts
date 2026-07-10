import type { EvalContext } from "./eval-context.js";
import type { ForceModel } from "./forces.js";
import type { InvariantSpec } from "./model.js";

const X = 0;
const Y = 1;
const VX = 2;
const VY = 3;

/**
 * Total mechanical energy E = (1/2)*m*|v|^2 + m*g*y (§3.8). Samples the
 * environment itself (rather than trusting `ctx.env` to already be fresh)
 * so this is safe to call standalone, before any `rhs` call has populated it.
 */
export function mechanicalEnergy(t: number, y: Float64Array, ctx: EvalContext): number {
  ctx.environment.sample(t, y[X]!, y[Y]!, ctx.env);
  const vx = y[VX]!;
  const vy = y[VY]!;
  return 0.5 * ctx.params.mass * (vx * vx + vy * vy) + ctx.params.mass * ctx.env.g * y[Y]!;
}

/**
 * dE/dt = F_aero . v (eq. 3.19): the summed `energyPower` of every
 * registered force EXCEPT gravity. Gravity's own F_g.v is already accounted
 * for by the m*g*y potential term inside `mechanicalEnergy`, so including it
 * here would double-count it and this sum would no longer equal the true
 * instantaneous rate of change of mechanical energy.
 */
export function aeroPower(
  forces: readonly ForceModel[],
  t: number,
  y: Float64Array,
  ctx: EvalContext,
): number {
  let power = 0;
  for (const force of forces) {
    if (force.id === "gravity" || !force.energyPower) continue;
    power += force.energyPower(t, y, ctx);
  }
  return power;
}

/**
 * InvariantSpec wrapping `mechanicalEnergy`: constant along any trajectory
 * where `aeroPower` is identically zero (gravity-only, or Magnus-only since
 * ideal Magnus does no work), monotone non-increasing when dissipative drag
 * is present in still air (§3.8).
 */
export function createEnergyInvariant(): InvariantSpec {
  return {
    name: "energy",
    evaluate(t: number, y: Float64Array, ctx: EvalContext): number {
      return mechanicalEnergy(t, y, ctx);
    },
  };
}
