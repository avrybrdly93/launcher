import type { EvalContext } from "./eval-context.js";
import type { ForceModel } from "./forces.js";
import type { InvariantSpec } from "./model.js";

const Y = 1;
const VX = 2;
const VY = 3;

/**
 * Mechanical energy E = (1/2) m |v|^2 + m g y (eq. 3.19). Reads the local
 * gravity from `ctx.env.g`, so `ctx` must already hold a sample at (t, r) --
 * true immediately after `Model.rhs` has run for this (t, y), same
 * convention as every other ctx-derived quantity (vRel, speedRel, ...).
 */
export function mechanicalEnergy(y: Float64Array, ctx: EvalContext): number {
  const vx = y[VX]!;
  const vy = y[VY]!;
  return 0.5 * ctx.params.mass * (vx * vx + vy * vy) + ctx.params.mass * ctx.env.g * y[Y]!;
}

/**
 * dE/dt = F_aero . v (eq. 3.19): sums every force's `energyPower` except
 * gravity, whose own power (-m*g*v_y) is exactly the derivative of
 * mechanicalEnergy's m*g*y term and so never appears as drift. What's left
 * is exactly the aerodynamic terms of (3.19): drag dissipates
 * (-1/2 rho Cd A u (u.v) <= 0 in still air) and ideal Magnus does zero work
 * (F_M perp v_rel = v in still air) -- the two exact runtime checks named
 * in §3.8.
 */
export function aeroPower(
  forces: readonly ForceModel[],
  t: number,
  y: Float64Array,
  ctx: EvalContext,
): number {
  let power = 0;
  for (const force of forces) {
    if (force.id === "gravity") continue;
    if (force.energyPower) power += force.energyPower(t, y, ctx);
  }
  return power;
}

/** Wraps mechanicalEnergy as a Model.invariants entry named "energy". */
export function createEnergyInvariant(): InvariantSpec {
  return {
    name: "energy",
    evaluate: (_t: number, y: Float64Array, ctx: EvalContext): number => mechanicalEnergy(y, ctx),
  };
}
