import { refreshDerivedQuantities, type EvalContext } from "./eval-context.js";
import { createForceRegistry, type ForceModel } from "./forces.js";
import type { InvariantSpec } from "./model.js";

const X = 0;
const Y = 1;
const VX = 2;
const VY = 3;

/**
 * Mechanical energy E = 1/2 m|v|^2 + mgy (§3.8, eq. 3.19 LHS). `g` is
 * resampled at the current (t, r) so this stays correct under an
 * altitude-dependent gravity model too.
 */
export function mechanicalEnergy(t: number, y: Float64Array, ctx: EvalContext): number {
  ctx.environment.sample(t, y[X]!, y[Y]!, ctx.env);
  const vx = y[VX]!;
  const vy = y[VY]!;
  return 0.5 * ctx.params.mass * (vx * vx + vy * vy) + ctx.params.mass * ctx.env.g * y[Y]!;
}

/** `InvariantSpec` wrapping `mechanicalEnergy`, for `Model.invariants` (§3.7). */
export function createEnergyInvariantSpec(): InvariantSpec {
  return {
    name: "energy",
    evaluate: mechanicalEnergy,
  };
}

/**
 * Sums every registered force's `energyPower` (F_i . v, true velocity) —
 * this is dKE/dt exactly, since m*dv/dt = sum_i F_i (Newton's 2nd law), so
 * v . (m*dv/dt) = sum_i F_i . v. Sorted by the same id order as
 * `composeForces` for the same bit-reproducibility reason (P1.17).
 */
export function composeEnergyPower(
  forces: readonly ForceModel[],
  t: number,
  y: Float64Array,
  ctx: EvalContext,
): number {
  const registry = createForceRegistry(forces);
  let power = 0;
  for (const force of registry) {
    if (force.energyPower) power += force.energyPower(t, y, ctx);
  }
  return power;
}

/**
 * dE/dt reconstructed purely from per-force `energyPower` (eq. 3.19). dKE/dt
 * is `composeEnergyPower` exactly; gravity's own -mg*vy term in that sum
 * exactly cancels d(mgy)/dt = +mg*vy, leaving F_aero . v as the net result —
 * the eq. (3.19) RHS. With no aero forces registered (drag/Magnus/buoyancy
 * all off), this is therefore the runtime conservation check: dE/dt ≡ 0.
 */
export function energyRateFromPowers(
  forces: readonly ForceModel[],
  t: number,
  y: Float64Array,
  ctx: EvalContext,
): number {
  refreshDerivedQuantities(t, y[X]!, y[Y]!, y[VX]!, y[VY]!, ctx);
  return composeEnergyPower(forces, t, y, ctx) + ctx.params.mass * ctx.env.g * y[VY]!;
}
