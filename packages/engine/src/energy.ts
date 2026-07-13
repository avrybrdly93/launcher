import type { EvalContext } from "./eval-context.js";
import type { ForceModel } from "./forces.js";

const Y = 1;
const VX = 2;
const VY = 3;

/**
 * Mechanical energy $E = \tfrac12 m\lVert\mathbf v\rVert^2 + mgy$ (eq. 3.19)
 * for the planar (x, y, vx, vy) state layout.
 */
export function mechanicalEnergy(y: Float64Array, ctx: EvalContext): number {
  const vx = y[VX]!;
  const vy = y[VY]!;
  return 0.5 * ctx.params.mass * (vx * vx + vy * vy) + ctx.params.mass * ctx.env.g * y[Y]!;
}

/**
 * $dE/dt = \mathbf F_{\text{aero}} \cdot \mathbf v$ (eq. 3.19): the summed
 * power of every registered force *except* gravity. Gravity is excluded
 * because its work is already accounted for by the $mgy$ term above —
 * $F_g \cdot v = -mg v_y$ is exactly canceled by $d(mgy)/dt = mg v_y$, so it
 * contributes zero net to $dE/dt$ by construction (not by cancellation at
 * runtime). Forces without an `energyPower` implementation contribute
 * nothing, mirroring the "defined where available" convention used for the
 * P1.22 analytic jacobian.
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
