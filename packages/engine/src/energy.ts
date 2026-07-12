import type { EvalContext } from "./eval-context.js";
import type { ForceModel } from "./forces.js";
import type { InvariantSpec } from "./model.js";

const Y = 1;
const VX = 2;
const VY = 3;

/** Mechanical energy E = (1/2)m|v|^2 + mgy (§3.8), the platform's universal correctness diagnostic. */
export function mechanicalEnergy(y: Float64Array, ctx: EvalContext): number {
  const vx = y[VX]!;
  const vy = y[VY]!;
  return 0.5 * ctx.params.mass * (vx * vx + vy * vy) + ctx.params.mass * ctx.env.g * y[Y]!;
}

/** Sums F_i.v over every registered force (eq 3.19's generic "work-integral channel"), gravity included. */
export function composeEnergyPower(
  forces: readonly ForceModel[],
  t: number,
  y: Float64Array,
  ctx: EvalContext,
): number {
  let power = 0;
  for (const force of forces) {
    if (force.energyPower) power += force.energyPower(t, y, ctx);
  }
  return power;
}

/**
 * dE/dt via the chain rule (§3.8, eq 3.19): d(KE)/dt = sum of every force's
 * energyPower (F_i.v, gravity included), plus d(PE)/dt = m*g*vy from E's
 * explicit m*g*y term. In still air with drag/Magnus/buoyancy off, gravity's
 * own energyPower (-m*g*vy) exactly cancels that m*g*vy term to floating-
 * point precision, leaving dE/dt = 0 — the platform's energy-conservation
 * check for the gravity-only regime. With drag on, the two gravity terms
 * still cancel and what remains is exactly F_aero.v, matching (3.19).
 */
export function energyRate(
  forces: readonly ForceModel[],
  t: number,
  y: Float64Array,
  ctx: EvalContext,
): number {
  return composeEnergyPower(forces, t, y, ctx) + ctx.params.mass * ctx.env.g * y[VY]!;
}

/** Wires E(y) (§3.8) as a Model invariant; re-samples the environment so `ctx.env.g` is current. */
export function createMechanicalEnergyInvariant(): InvariantSpec {
  return {
    name: "mechanical-energy",
    evaluate(t: number, y: Float64Array, ctx: EvalContext): number {
      ctx.environment.sample(t, y[0]!, y[Y]!, ctx.env);
      return mechanicalEnergy(y, ctx);
    },
  };
}
