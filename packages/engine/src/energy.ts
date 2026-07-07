import type { EvalContext } from "./eval-context.js";
import type { ForceModel } from "./forces.js";

const Y = 1;
const VX = 2;
const VY = 3;

/** Mechanical energy E = (1/2)m|v|^2 + mgy (§3.8). Gravity's contribution lives entirely here. */
export function mechanicalEnergy(y: Float64Array, ctx: EvalContext): number {
  const vx = y[VX]!;
  const vy = y[VY]!;
  return 0.5 * ctx.params.mass * (vx * vx + vy * vy) + ctx.params.mass * ctx.env.g * y[Y]!;
}

/**
 * dE/dt as the sum of every force's instantaneous power, *excluding gravity*
 * (eq. 3.19). Gravity's own power (F_g·v = -mgy') exactly cancels the mgy
 * term's derivative by construction of `mechanicalEnergy`, so summing it in
 * here would double-count: the two terms are algebraically the same
 * quantity, just recovered from opposite ends of the identity
 * d/dt(mgy) = mg·v_y = -F_g·v. What remains — drag, Magnus, buoyancy — is
 * exactly the non-conservative (or not-yet-folded-into-E) work rate.
 * Forces without `energyPower` contribute 0 (there are none among the
 * current force set; the guard is defensive for future additions).
 */
export function nonGravityEnergyPower(
  forces: readonly ForceModel[],
  t: number,
  y: Float64Array,
  ctx: EvalContext,
): number {
  let power = 0;
  for (const f of forces) {
    if (f.id === "gravity") continue;
    power += f.energyPower ? f.energyPower(t, y, ctx) : 0;
  }
  return power;
}
