import type { EvalContext } from "./eval-context.js";
import type { ForceModel } from "./forces.js";
import type { InvariantSpec } from "./model.js";
import { refreshDerivedState } from "./planar-derived-state.js";

const Y = 1;
const VX = 2;
const VY = 3;

/**
 * Mechanical energy E = 0.5*m*|v|^2 + m*g*y (eq. 3.19). Resamples the
 * environment at (t, x, y) itself (via `ctx.environment`), so it's correct
 * even if `ctx`'s scratch fields are stale when this is called.
 */
export function mechanicalEnergy(t: number, y: Float64Array, ctx: EvalContext): number {
  const yPos = y[Y]!;
  const vx = y[VX]!;
  const vy = y[VY]!;
  ctx.environment.sample(t, y[0]!, yPos, ctx.env);
  return 0.5 * ctx.params.mass * (vx * vx + vy * vy) + ctx.params.mass * ctx.env.g * yPos;
}

/**
 * dE/dt computed purely from each force's `energyPower` (F_i . v) plus the
 * analytic rate of the gravitational-PE term, m*g*vy (eq. 3.19). Forces
 * without an `energyPower` contribute 0. Refreshes ctx's derived scratch
 * (env, vRel, speedRel, re, mach) exactly as `rhs` would, since
 * `energyPower` implementations read those fields.
 *
 * This is a validation device, not part of the `Model` interface
 * (`InvariantSpec.evaluate` returns E itself, not its rate) — it's what
 * proves the per-force `energyPower` wiring is self-consistent with E's
 * definition: with gravity as the only force, the -m*g*vy contributed by
 * `GravityForce.energyPower` exactly cancels the +m*g*vy PE-rate term below,
 * so dE/dt is identically zero (P1.24 validation criterion).
 */
export function energyRate(
  forces: readonly ForceModel[],
  t: number,
  y: Float64Array,
  ctx: EvalContext,
): number {
  refreshDerivedState(t, y, ctx);
  let power = 0;
  for (const force of forces) {
    power += force.energyPower?.(t, y, ctx) ?? 0;
  }
  return power + ctx.params.mass * ctx.env.g * y[VY]!;
}

/** The energy `InvariantSpec` wired into `createPlanarProjectileModel` (P1.24). */
export function createEnergyInvariant(): InvariantSpec {
  return {
    name: "energy",
    evaluate: mechanicalEnergy,
  };
}
