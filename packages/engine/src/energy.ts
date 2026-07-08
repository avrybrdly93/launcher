import type { EvalContext } from "./eval-context.js";
import type { InvariantSpec } from "./model.js";

const Y = 1;
const VX = 2;
const VY = 3;

/**
 * Mechanical energy E = (1/2)m|v|^2 + mgy (§3.8). Gravity's own contribution
 * is folded into the mgy term, which is exactly why `composeEnergyPower`
 * (forces.ts) must exclude the gravity force's `energyPower` when checking
 * dE/dt against (3.19) — including it would double-count gravity's work.
 */
export function mechanicalEnergy(y: Float64Array, mass: number, g: number): number {
  const vx = y[VX]!;
  const vy = y[VY]!;
  return 0.5 * mass * (vx * vx + vy * vy) + mass * g * y[Y]!;
}

/**
 * Reports mechanical energy E(t,y) as a model invariant. Assumes `ctx.env`
 * is already fresh for (t,y) — i.e. this is evaluated using the same ctx a
 * preceding `model.rhs` call left behind, not sampled independently.
 */
export const ENERGY_INVARIANT: InvariantSpec = {
  name: "energy",
  evaluate(_t: number, y: Float64Array, ctx: EvalContext): number {
    return mechanicalEnergy(y, ctx.params.mass, ctx.env.g);
  },
};
