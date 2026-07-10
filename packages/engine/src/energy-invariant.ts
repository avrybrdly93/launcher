import { refreshEvalContext, type EvalContext } from "./eval-context.js";
import type { ForceModel } from "./forces.js";
import type { InvariantSpec } from "./model.js";

const Y = 1;
const VX = 2;
const VY = 3;

/**
 * Mechanical energy E(y) = (1/2)m|v|^2 + mgy (§3.8 eq. 3.19's conserved/
 * monotone quantity). This is a state function, not a rate — the Recorder
 * (P2.37) tracks it over a trajectory to catch drift.
 */
export function createEnergyInvariant(): InvariantSpec {
  return {
    name: "energy",
    evaluate(_t: number, y: Float64Array, ctx: EvalContext): number {
      const vx = y[VX]!;
      const vy = y[VY]!;
      const ke = 0.5 * ctx.params.mass * (vx * vx + vy * vy);
      const pe = ctx.params.mass * ctx.env.g * y[Y]!;
      return ke + pe;
    },
  };
}

/**
 * dE/dt reconstructed "from powers" (eq. 3.19): sums every registered
 * force's `energyPower` (F_i·v, gravity included) and adds the potential
 * term's own rate mgẏ = mg·v_y. Gravity's energyPower is exactly -mg·v_y
 * (same env.g, same v_y sample), so it cancels the added potential term
 * algebraically, leaving only the non-gravity ("aero") contribution — no
 * force needs to be special-cased for this to hold for an arbitrary force
 * list. With every non-gravity force off, this vanishes to round-off; this
 * is the P1.24 wiring check.
 */
export function energyRateFromPowers(
  forces: readonly ForceModel[],
  t: number,
  y: Float64Array,
  ctx: EvalContext,
): number {
  const x = y[0]!;
  const yPos = y[Y]!;
  const vx = y[VX]!;
  const vy = y[VY]!;
  refreshEvalContext(t, x, yPos, vx, vy, ctx);

  let power = ctx.params.mass * ctx.env.g * vy;
  for (const force of forces) {
    if (force.energyPower) power += force.energyPower(t, y, ctx);
  }
  return power;
}
