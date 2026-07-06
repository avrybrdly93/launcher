import type { EvalContext } from "./eval-context.js";
import type { ForceModel } from "./forces.js";

const Y = 1;
const VX = 2;
const VY = 3;

/** Mechanical energy E = (1/2)*m*|v|^2 + m*g*y at the current state (eq. 3.19). */
export function mechanicalEnergy(y: Float64Array, ctx: EvalContext): number {
  const vx = y[VX]!;
  const vy = y[VY]!;
  const speedSq = vx * vx + vy * vy;
  return 0.5 * ctx.params.mass * speedSq + ctx.params.mass * ctx.env.g * y[Y]!;
}

/**
 * dE/dt = F_aero . v (eq. 3.19): the sum of every *non-gravity* force's
 * instantaneous power. Gravity is excluded because its work is already
 * folded into the potential-energy term of `mechanicalEnergy` -- including
 * it here would double count it (SS3.8): in still air with drag off,
 * this is exactly 0 (Magnus does no work, F_M perp v_rel = v); with drag
 * on in still air it is <= 0 (drag strictly dissipates).
 */
export function aeroEnergyPower(
  forces: readonly ForceModel[],
  t: number,
  y: Float64Array,
  ctx: EvalContext,
): number {
  let power = 0;
  for (const force of forces) {
    if (force.id === "gravity") continue;
    power += force.energyPower?.(t, y, ctx) ?? 0;
  }
  return power;
}
