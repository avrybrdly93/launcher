import type { EvalContext } from "./eval-context.js";
import type { ForceModel } from "./forces.js";
import type { InvariantSpec } from "./model.js";

const Y = 1;
const VX = 2;
const VY = 3;

/**
 * Mechanical energy E = (1/2)m|v|^2 + mgy (eq. 3.19). Only gravity's
 * potential term is folded in here; every other force's work shows up as a
 * *rate* through `aeroPower` below, not as a term of E itself.
 */
export function mechanicalEnergy(t: number, y: Float64Array, ctx: EvalContext): number {
  ctx.environment.sample(t, y[0]!, y[Y]!, ctx.env);
  const vx = y[VX]!;
  const vy = y[VY]!;
  return 0.5 * ctx.params.mass * (vx * vx + vy * vy) + ctx.params.mass * ctx.env.g * y[Y]!;
}

/** `InvariantSpec` wrapping `mechanicalEnergy` for use as `Model.invariants` (§3.7). */
export function createEnergyInvariant(): InvariantSpec {
  return {
    name: "energy",
    evaluate: mechanicalEnergy,
  };
}

/**
 * dE/dt per (3.19): the summed power of every *aero* force in `forces` --
 * everything but gravity, whose work is already folded into E's mgy
 * potential term. In still air with drag off, a Magnus-only trajectory
 * makes this exactly zero (F_M ⊥ v), the "(ii)" runtime check of §3.8; with
 * drag on it is the (generally nonzero, dissipative) work-rate that the
 * energy residual R_E integrates.
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
