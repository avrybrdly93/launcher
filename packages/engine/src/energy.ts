import { refreshEvalContext, type EvalContext } from "./eval-context.js";
import type { ForceModel } from "./forces.js";
import type { InvariantSpec } from "./model.js";

const Y = 1;
const VX = 2;
const VY = 3;

/**
 * Mechanical energy E = 1/2 m|v|^2 + mgy (eq. 3.19). Refreshes `ctx`'s
 * scratch fields itself rather than trusting them to already be current, so
 * it can be evaluated standalone at any (t, y) — e.g. by a Recorder walking
 * dense output rather than only solver-visited states.
 */
export function mechanicalEnergy(t: number, y: Float64Array, ctx: EvalContext): number {
  refreshEvalContext(t, y, ctx);
  const vx = y[VX]!;
  const vy = y[VY]!;
  return 0.5 * ctx.params.mass * (vx * vx + vy * vy) + ctx.params.mass * ctx.env.g * y[Y]!;
}

/**
 * Sum of `energyPower` over every registered force except gravity (eq.
 * 3.19). Gravity's own kinetic-power contribution (-mg*vy) is exactly
 * cancelled by d(mgy)/dt inside `mechanicalEnergy`'s definition, so it never
 * appears in dE/dt; every other force (drag, Magnus, buoyancy, ...) does
 * real work against E as defined here and its `energyPower` contributes
 * directly. This is the "dE/dt from powers" side of the invariant check —
 * it should equal the chain-rule derivative of `mechanicalEnergy` along any
 * trajectory of the rhs, for any combination of registered forces. Also
 * refreshes `ctx`'s scratch fields itself, since `energyPower` reads them
 * the same way `accumulate` does.
 */
export function nonGravitationalPower(
  forces: readonly ForceModel[],
  t: number,
  y: Float64Array,
  ctx: EvalContext,
): number {
  refreshEvalContext(t, y, ctx);
  let power = 0;
  for (const force of forces) {
    if (force.id === "gravity" || !force.energyPower) continue;
    power += force.energyPower(t, y, ctx);
  }
  return power;
}

/**
 * The model-level energy invariant (§3.7 `InvariantSpec`): E(y), exactly
 * conserved with drag and Magnus both off, monotone non-increasing under
 * drag alone in still air (§3.8).
 */
export function createMechanicalEnergyInvariant(): InvariantSpec {
  return {
    name: "mechanicalEnergy",
    evaluate: mechanicalEnergy,
  };
}
