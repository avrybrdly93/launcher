import type { EvalContext } from "./eval-context.js";
import type { ForceModel } from "./forces.js";
import type { InvariantSpec } from "./model.js";

const Y = 1;
const VX = 2;
const VY = 3;

/**
 * Total mechanical energy E = (1/2)m|v|^2 + mgy (eq. 3.19). Reads
 * `ctx.params.mass` and `ctx.env.g`, both already refreshed by the
 * preceding `Model.rhs` call on the same `ctx` (the EvalContext convention
 * — nothing here re-samples the environment).
 */
export function mechanicalEnergy(y: Float64Array, ctx: EvalContext): number {
  const vx = y[VX]!;
  const vy = y[VY]!;
  const yPos = y[Y]!;
  return 0.5 * ctx.params.mass * (vx * vx + vy * vy) + ctx.params.mass * ctx.env.g * yPos;
}

/** Wraps `mechanicalEnergy` as the `InvariantSpec` a `Model` declares in `invariants`. */
export function createEnergyInvariant(): InvariantSpec {
  return {
    name: "energy",
    evaluate: (_t, y, ctx) => mechanicalEnergy(y, ctx),
  };
}

/**
 * Sum of every registered force's instantaneous power except gravity's (eq.
 * 3.19's F_aero.v, generalized to any non-gravitational force — e.g.
 * buoyancy — since E's mgy term already accounts for gravity's contribution
 * to dE/dt; including it again here would double-count it).
 */
export function nonGravitationalPower(
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

/**
 * dE/dt computed directly from `rhs`'s output via the chain rule on E,
 * independent of any per-force `energyPower` bookkeeping — the reference
 * value `nonGravitationalPower` must equal (eq. 3.19), since
 * d/dt[(1/2)m|v|^2 + mgy] = m*v.a + mg*vy for a = rhsOut[VX,VY].
 */
export function energyRateFromRhs(y: Float64Array, rhsOut: Float64Array, ctx: EvalContext): number {
  const vx = y[VX]!;
  const vy = y[VY]!;
  const ax = rhsOut[VX]!;
  const ay = rhsOut[VY]!;
  return ctx.params.mass * (vx * ax + vy * ay) + ctx.params.mass * ctx.env.g * vy;
}
