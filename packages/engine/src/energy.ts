import type { EvalContext } from "./eval-context.js";
import type { ForceModel } from "./forces.js";
import type { InvariantSpec } from "./model.js";

const X = 0;
const Y = 1;
const VX = 2;
const VY = 3;

/**
 * Mechanical energy E = KE + PE = 0.5*m*|v|^2 + m*g*y (eq. 3.19). Samples the
 * environment fresh at (t, x, y) rather than trusting `ctx.env` to still
 * hold the right value -- invariant evaluation can happen independently of
 * an `rhs` call (e.g. from a recorder/monitor sink after a step completes).
 */
export function mechanicalEnergy(t: number, y: Float64Array, ctx: EvalContext): number {
  const yPos = y[Y]!;
  const vx = y[VX]!;
  const vy = y[VY]!;
  ctx.environment.sample(t, y[X]!, yPos, ctx.env);
  const ke = 0.5 * ctx.params.mass * (vx * vx + vy * vy);
  const pe = ctx.params.mass * ctx.env.g * yPos;
  return ke + pe;
}

/** `InvariantSpec` wrapping `mechanicalEnergy` for `Model.invariants` (§3.7/3.8). */
export function createMechanicalEnergyInvariant(): InvariantSpec {
  return { name: "energy", evaluate: mechanicalEnergy };
}

/**
 * Sums `energyPower` (F_i . v) across `forces`, in whatever order the caller
 * supplies (pass an id-sorted registry, per `createForceRegistry`, for
 * determinism), skipping forces that don't implement it.
 *
 * Because E's potential term m*g*y already accounts for gravity's work,
 * dE/dt = composeEnergyPower(forces excluding gravity, ...) exactly (not an
 * approximation -- see energy.test.ts for the derivation): gravity's own
 * `energyPower` (-m*g*v_y) exists for other diagnostics (e.g. a raw F.v
 * power sink) but must be left out of *this* sum, which is eq. 3.19's
 * F_aero (drag + Magnus + buoyancy, i.e. every force with no potential term
 * folded into E).
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
