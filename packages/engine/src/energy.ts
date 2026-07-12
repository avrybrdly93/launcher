import type { EvalContext } from "./eval-context.js";
import type { ForceModel } from "./forces.js";

const X = 0;
const Y = 1;
const VX = 2;
const VY = 3;

/**
 * Mechanical energy E = ½m|v|² + mgy, the platform's primary
 * conserved/monotone diagnostic (§3.8, preceding eq. 3.19). `g` is sampled
 * at the current (t, x, y) rather than assumed constant, so this stays
 * correct under the altitude-dependent gravity model (§3.2) too.
 */
export function mechanicalEnergy(t: number, y: Float64Array, ctx: EvalContext): number {
  ctx.environment.sample(t, y[X]!, y[Y]!, ctx.env);
  const vx = y[VX]!;
  const vy = y[VY]!;
  return 0.5 * ctx.params.mass * (vx * vx + vy * vy) + ctx.params.mass * ctx.env.g * y[Y]!;
}

/**
 * Sums `energyPower` across `forces` — the power-domain counterpart of
 * `composeForces` (P1.18), equally force-agnostic: it doesn't know or care
 * which physical forces it's summing. Passing every registered force gives
 * the total mechanical power F_total.v; passing every force *except*
 * gravity gives F_aero.v of eq. (3.19), since gravity's power is exactly
 * the term that cancels d(mgy)/dt inside dE/dt (derived and exercised in
 * energy.test.ts).
 */
export function composeEnergyPower(
  forces: readonly ForceModel[],
  t: number,
  y: Float64Array,
  ctx: EvalContext,
): number {
  let power = 0;
  for (const force of forces) {
    if (force.energyPower) power += force.energyPower(t, y, ctx);
  }
  return power;
}
