import type { EvalContext } from "./eval-context.js";
import type { ForceModel } from "./forces.js";
import type { InvariantSpec } from "./model.js";

const Y = 1;
const VX = 2;
const VY = 3;

/**
 * Mechanical energy E = (1/2)m|v|^2 + mgy (eq. 3.19). Requires `ctx.env` to
 * already be freshly sampled at (t, y) — the same contract `Model.rhs`
 * relies on — since `evaluate` itself never calls `environment.sample`.
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
 * dE/dt per (3.19): the power delivered by every registered force *except*
 * gravity, which is already folded into E's `mgy` potential term and so must
 * be excluded to avoid double-counting. In still air this is exactly 0 with
 * drag off, exactly 0 with Magnus alone (F_M perp v), and <= 0 with drag on
 * (dissipation) — the three runtime checks §3.8 calls out.
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
