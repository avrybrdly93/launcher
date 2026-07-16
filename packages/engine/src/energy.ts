import type { EvalContext } from "./eval-context.js";
import type { ForceModel } from "./forces.js";
import type { InvariantSpec, Model } from "./model.js";

const Y = 1;
const VX = 2;
const VY = 3;

/** Total mechanical energy E = (1/2) m |v|^2 + m g y (eq. 3.19). */
export function mechanicalEnergy(y: Float64Array, mass: number, g: number): number {
  const vx = y[VX]!;
  const vy = y[VY]!;
  return 0.5 * mass * (vx * vx + vy * vy) + mass * g * y[Y]!;
}

/**
 * Sums `energyPower` (F_i . v) across every force in the registry, mirroring
 * `composeForces` for the scalar power channel (eq. 3.19). Forces without an
 * `energyPower` implementation contribute 0.
 */
export function composeEnergyPower(
  forces: readonly ForceModel[],
  t: number,
  y: Float64Array,
  ctx: EvalContext,
): number {
  let power = 0;
  for (const force of forces) {
    power += force.energyPower?.(t, y, ctx) ?? 0;
  }
  return power;
}

/**
 * The energy invariant (§3.8/3.19): evaluates to the current mechanical
 * energy E(t,y). Whether it stays constant, is conserved, or decreases
 * monotonically depends on which forces are registered -- that's checked by
 * `energyDerivativeFromPowers`/`energyDerivativeFromRhs` below, not by this
 * spec itself (it just reports the instantaneous value, like any
 * `InvariantSpec`, for a drift monitor to track over a run).
 */
export const ENERGY_INVARIANT: InvariantSpec = {
  name: "energy",
  evaluate(_t: number, y: Float64Array, ctx: EvalContext): number {
    return mechanicalEnergy(y, ctx.params.mass, ctx.env.g);
  },
};

/**
 * dE/dt via the per-force power channel: the work-energy theorem gives
 * d(KE)/dt = Σ_i F_i.v = composeEnergyPower(...) exactly; d(PE)/dt = m g v_y
 * is gravity's potential term differentiated analytically. Summed, this is
 * dE/dt. With only gravity registered, gravity's own power (-m g v_y) and
 * the potential term (+m g v_y) cancel exactly, giving 0 (eq. 3.19 check i).
 */
export function energyDerivativeFromPowers(
  forces: readonly ForceModel[],
  t: number,
  y: Float64Array,
  ctx: EvalContext,
): number {
  return composeEnergyPower(forces, t, y, ctx) + ctx.params.mass * ctx.env.g * y[VY]!;
}

/**
 * dE/dt computed independently from the rhs acceleration, as a cross-check
 * that every force's `energyPower` genuinely matches its `accumulate`
 * (eq. 3.19): d(KE)/dt = m (v . a), d(PE)/dt = m g v_y.
 */
export function energyDerivativeFromRhs(
  model: Model,
  t: number,
  y: Float64Array,
  ctx: EvalContext,
  mass: number,
  g: number,
): number {
  const out = new Float64Array(model.dim);
  model.rhs(t, y, out, ctx);
  return mass * (y[VX]! * out[VX]! + y[VY]! * out[VY]!) + mass * g * y[VY]!;
}
