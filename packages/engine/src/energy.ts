import type { EvalContext } from "./eval-context.js";
import type { ForceModel } from "./forces.js";
import type { InvariantSpec } from "./model.js";

const Y = 1;
const VX = 2;
const VY = 3;

/**
 * Mechanical energy E = (1/2)m|v|^2 + mgy (§3.8, the invariant preceding eq.
 * 3.19). Requires `ctx.env` to already be populated for this (t, y) — i.e.
 * evaluated right after an `rhs`/environment sample, same contract as every
 * other per-state EvalContext consumer (§2.4a).
 */
export const energyInvariant: InvariantSpec = {
  name: "energy",
  evaluate(_t: number, y: Float64Array, ctx: EvalContext): number {
    const vx = y[VX]!;
    const vy = y[VY]!;
    return 0.5 * ctx.params.mass * (vx * vx + vy * vy) + ctx.params.mass * ctx.env.g * y[Y]!;
  },
};

/**
 * Reconstructs dE/dt for `energyInvariant` from per-force `energyPower`
 * terms alone (eq. 3.19), without numerically differentiating a trajectory.
 *
 * Summing every registered force's power gives exactly F_total.v (a dot
 * product identity: sum_i(F_i.v) = (sum_i F_i).v). Gravity's own power
 * (-mg*vy) exactly cancels the mgy potential-energy term buried in
 * `energyInvariant` — d(mgy)/dt = mg*vy — so adding mg*vy back undoes that
 * cancellation and leaves dE/dt. With no aero forces registered (drag off),
 * this reduces to the gravity-only identity mg*vy + (-mg*vy) = 0: mechanical
 * energy is exactly conserved, and this holds to floating-point roundoff
 * (~1e-13), not just approximately.
 */
export function energyRateFromPowers(
  forces: readonly ForceModel[],
  t: number,
  y: Float64Array,
  ctx: EvalContext,
): number {
  let rate = ctx.params.mass * ctx.env.g * y[VY]!;
  for (const force of forces) {
    rate += force.energyPower?.(t, y, ctx) ?? 0;
  }
  return rate;
}
