import type { EvalContext } from "./eval-context.js";
import type { ForceModel } from "./forces.js";
import type { InvariantSpec } from "./model.js";

const X = 0;
const Y = 1;
const VX = 2;
const VY = 3;

/**
 * Mechanical energy E = (1/2)m|v|^2 + mgy (eq. 3.19). Samples the
 * environment fresh at (t, x, y) rather than trusting `ctx.env` to already
 * hold this state's sample, since InvariantSpec.evaluate may be called
 * independently of `rhs` (e.g. from a recorder/monitor at a past state).
 */
export function planarMechanicalEnergy(t: number, y: Float64Array, ctx: EvalContext): number {
  const x = y[X]!;
  const yPos = y[Y]!;
  const vx = y[VX]!;
  const vy = y[VY]!;

  ctx.environment.sample(t, x, yPos, ctx.env);
  const speedSq = vx * vx + vy * vy;
  return 0.5 * ctx.params.mass * speedSq + ctx.params.mass * ctx.env.g * yPos;
}

/**
 * Sum of every registered force's instantaneous power F_i . v (eq. 3.19),
 * equal to d(KE)/dt exactly (power theorem). `forces` must already be in
 * registry (id-sorted) order — see `createForceRegistry` — so this sum, like
 * `composeForces`, is independent of registration order (P1.17).
 */
export function composeEnergyPower(
  forces: readonly ForceModel[],
  t: number,
  y: Float64Array,
  ctx: EvalContext,
): number {
  let total = 0;
  for (const force of forces) {
    total += force.energyPower ? force.energyPower(t, y, ctx) : 0;
  }
  return total;
}

/** InvariantSpec exposing E(t,y) for the planar projectile model (§3.7-3.8). */
export const PLANAR_ENERGY_INVARIANT: InvariantSpec = {
  name: "energy",
  evaluate: planarMechanicalEnergy,
};
