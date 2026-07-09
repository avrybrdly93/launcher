import type { EvalContext } from "./eval-context.js";
import type { ForceModel } from "./forces.js";

const X = 0;
const Y = 1;
const VX = 2;
const VY = 3;

/** Mechanical energy E = (1/2)m|v|^2 + mgy (§3.8, eq. 3.19), gravity sampled at the current position. */
export function mechanicalEnergy(t: number, y: Float64Array, ctx: EvalContext): number {
  const yPos = y[Y]!;
  const vx = y[VX]!;
  const vy = y[VY]!;
  ctx.environment.sample(t, y[X]!, yPos, ctx.env);
  return 0.5 * ctx.params.mass * (vx * vx + vy * vy) + ctx.params.mass * ctx.env.g * yPos;
}

/**
 * Sum of every registered force's instantaneous power (F.v) *except*
 * gravity's (eq. 3.19's F_aero . v). Gravity is excluded deliberately:
 * mechanicalEnergy already folds gravity's work into the mgy potential-energy
 * term, so d(mechanicalEnergy)/dt = aeroPower exactly along a trajectory --
 * summing gravity's power again here would double-count it (§3.8).
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
