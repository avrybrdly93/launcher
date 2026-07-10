import type { EvalContext } from "./eval-context.js";
import type { ForceModel } from "./forces.js";
import type { InvariantSpec } from "./model.js";

const X = 0;
const Y = 1;
const VX = 2;
const VY = 3;

/**
 * Mechanical energy E = (1/2)m|v|^2 + mgy (§3.8). Samples the environment
 * itself (rather than trusting a possibly-stale `ctx.env`) so it can be
 * called standalone, independent of when `Model.rhs` last ran.
 */
export function mechanicalEnergy(t: number, y: Float64Array, ctx: EvalContext): number {
  ctx.environment.sample(t, y[X]!, y[Y]!, ctx.env);
  const vx = y[VX]!;
  const vy = y[VY]!;
  const kinetic = 0.5 * ctx.params.mass * (vx * vx + vy * vy);
  const potential = ctx.params.mass * ctx.env.g * y[Y]!;
  return kinetic + potential;
}

/**
 * dE/dt = F_aero . v (eq. 3.19): the sum of every registered force's
 * `energyPower` *except* gravity, whose contribution is already folded into
 * the potential term of `mechanicalEnergy` and cancels exactly (gravity's
 * power is -mg*vy; d(mgy)/dt is +mg*vy). With no aero forces registered this
 * is an exact `0`, not merely a numerically small residual — that's what
 * makes "drag off => E conserved" a hard identity.
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

/** The energy InvariantSpec every Model that includes gravity can expose (§3.7 `invariants`). */
export function createEnergyInvariant(): InvariantSpec {
  return {
    name: "energy",
    evaluate: (t: number, y: Float64Array, ctx: EvalContext): number => mechanicalEnergy(t, y, ctx),
  };
}
