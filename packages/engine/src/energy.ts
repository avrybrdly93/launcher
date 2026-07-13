import type { EvalContext } from "./eval-context.js";
import type { ForceModel } from "./forces.js";
import type { InvariantSpec } from "./model.js";

const Y = 1;
const VX = 2;
const VY = 3;

/**
 * Mechanical energy E = (1/2)m|v|^2 + mgy (eq. 3.19), relative to y=0 at the
 * current local gravity `ctx.env.g`. Gravity's own work is already folded
 * into the mgy potential term, which is what makes `aeroPower` below — the
 * power of every *other* force — equal dE/dt exactly (§3.8).
 */
export function mechanicalEnergy(y: Float64Array, ctx: EvalContext): number {
  const vx = y[VX]!;
  const vy = y[VY]!;
  return 0.5 * ctx.params.mass * (vx * vx + vy * vy) + ctx.params.mass * ctx.env.g * y[Y]!;
}

/**
 * Sum of `energyPower` over every force except gravity — the F_aero . v term
 * of eq. 3.19. Because gravity's power is exactly -d(mgy)/dt, this equals
 * dE/dt for `mechanicalEnergy` above: zero with aero off, zero (to floating
 * precision) with only an ideal Magnus force (perpendicular to v_rel, does
 * no work), and strictly <=0 with drag on in still air (dissipative).
 * Forces without an `energyPower` (rare; every registered force implements
 * it) contribute 0.
 */
export function aeroPower(
  forces: readonly ForceModel[],
  t: number,
  y: Float64Array,
  ctx: EvalContext,
): number {
  let power = 0;
  for (const force of forces) {
    if (force.id === "gravity") continue;
    power += force.energyPower ? force.energyPower(t, y, ctx) : 0;
  }
  return power;
}

/** Wraps `mechanicalEnergy` as the Model's "energy" InvariantSpec (§3.7). */
export function createEnergyInvariant(): InvariantSpec {
  return {
    name: "energy",
    evaluate: (_t: number, y: Float64Array, ctx: EvalContext): number => mechanicalEnergy(y, ctx),
  };
}
