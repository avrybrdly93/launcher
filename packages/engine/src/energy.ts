import type { EvalContext } from "./eval-context.js";
import type { ForceModel } from "./forces.js";
import type { InvariantSpec } from "./model.js";

const X = 0;
const Y = 1;
const VX = 2;
const VY = 3;

/**
 * Mechanical energy E = 0.5*m*|v|^2 + m*g*y (eq. 3.19). Gravity is sampled
 * fresh at (t, x, y) rather than trusting `ctx.env` to already hold it, so
 * this is correct to call standalone (e.g. from a Recorder) and not only
 * right after an `rhs` call for the same state.
 */
export function mechanicalEnergy(t: number, y: Float64Array, ctx: EvalContext): number {
  ctx.environment.sample(t, y[X]!, y[Y]!, ctx.env);
  const vx = y[VX]!;
  const vy = y[VY]!;
  return 0.5 * ctx.params.mass * (vx * vx + vy * vy) + ctx.params.mass * ctx.env.g * y[Y]!;
}

/** The mechanical-energy diagnostic channel (§3.8) as a Model.InvariantSpec. */
export function createMechanicalEnergyInvariant(): InvariantSpec {
  return {
    name: "mechanical-energy",
    evaluate: mechanicalEnergy,
  };
}

/**
 * Sums `energyPower` (F_i . v) over every registered force except gravity —
 * this is F_aero . v of eq. 3.19, the instantaneous dE/dt once gravity's
 * contribution is excluded (its power exactly cancels against the -mgy
 * potential term already folded into `mechanicalEnergy`). With drag and
 * Magnus off this is identically 0: gravity is the only force, and it's
 * excluded by construction, so E is exactly conserved (§3.8 case i).
 */
export function aeroEnergyPower(
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
