import type { EvalContext } from "./eval-context.js";
import type { ForceModel } from "./forces.js";
import type { InvariantSpec } from "./model.js";

const X = 0;
const Y = 1;
const VX = 2;
const VY = 3;

/**
 * Mechanical energy E = (1/2)m|v|^2 + mgy (eq. 3.19). Assumes `ctx.env` is
 * already sampled at the current (t, x, y) (the model's rhs does this once
 * per evaluation; callers evaluating this standalone must sample first).
 */
export function mechanicalEnergy(y: Float64Array, ctx: EvalContext): number {
  const vx = y[VX]!;
  const vy = y[VY]!;
  const kinetic = 0.5 * ctx.params.mass * (vx * vx + vy * vy);
  const potential = ctx.params.mass * ctx.env.g * y[Y]!;
  return kinetic + potential;
}

/**
 * Sum of `energyPower` (F.v) over every force *except* gravity (eq. 3.19's
 * F_aero term). Gravity's power is excluded because its work is already
 * accounted for by the mgy term inside `mechanicalEnergy` — that term's own
 * time-derivative (mg*vy) exactly cancels gravity's F.v (-mg*vy), so E's
 * true rate of change equals precisely this "aero" sum, not the sum over
 * all forces.
 */
export function aeroEnergyPower(
  forces: readonly ForceModel[],
  t: number,
  y: Float64Array,
  ctx: EvalContext,
): number {
  let power = 0;
  for (const force of forces) {
    if (force.id === "gravity") continue;
    power += force.energyPower?.(t, y, ctx) ?? 0;
  }
  return power;
}

/**
 * dE/dt computed directly from the rhs' accelerations via the chain rule:
 * d/dt[(1/2)m|v|^2 + mgy] = m(vx*ax + vy*ay) + mg*vy. Algebraically
 * identical to `aeroEnergyPower` (up to floating-point rounding) for
 * uniform, non-altitude-dependent gravity — the two are cross-checked in
 * tests as the "per-force energyPower wiring" validation.
 */
export function energyDerivativeFromRhs(
  y: Float64Array,
  rhsOut: Float64Array,
  ctx: EvalContext,
): number {
  const vx = y[VX]!;
  const vy = y[VY]!;
  const ax = rhsOut[VX]!;
  const ay = rhsOut[VY]!;
  return ctx.params.mass * (vx * ax + vy * ay) + ctx.params.mass * ctx.env.g * vy;
}

/** Builds the `InvariantSpec` exposing mechanical energy as a Model channel. */
export function createEnergyInvariant(): InvariantSpec {
  return {
    name: "energy",
    evaluate(t: number, y: Float64Array, ctx: EvalContext): number {
      ctx.environment.sample(t, y[X]!, y[Y]!, ctx.env);
      return mechanicalEnergy(y, ctx);
    },
  };
}
