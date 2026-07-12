import type { EvalContext } from "./eval-context.js";
import type { ForceModel } from "./forces.js";
import type { InvariantSpec } from "./model.js";
import { VX, VY, X, Y, primePlanarEvalContext } from "./planar-state.js";

/** Mechanical energy E = (1/2)m|v|^2 + mgy (§3.8), sampling the environment for g at (t, x, y). */
export function mechanicalEnergy(t: number, y: Float64Array, ctx: EvalContext): number {
  ctx.environment.sample(t, y[X]!, y[Y]!, ctx.env);
  const vx = y[VX]!;
  const vy = y[VY]!;
  return 0.5 * ctx.params.mass * (vx * vx + vy * vy) + ctx.params.mass * ctx.env.g * y[Y]!;
}

/**
 * Sums every registered force's instantaneous power F_i·v (eq. 3.19),
 * mirroring composeForces' zero-then-accumulate pattern for the scalar
 * power channel. Forces without `energyPower` contribute 0. `ctx` must
 * already be primed for `y` (see `primePlanarEvalContext`) since forces
 * like quadratic drag read `ctx.env`/`ctx.vRel` rather than recomputing them.
 */
export function composeEnergyPower(
  forces: readonly ForceModel[],
  t: number,
  y: Float64Array,
  ctx: EvalContext,
): number {
  let power = 0;
  for (const force of forces) {
    power += force.energyPower ? force.energyPower(t, y, ctx) : 0;
  }
  return power;
}

/**
 * dE/dt reconstructed purely from per-force `energyPower`, per (3.19).
 * Since E = KE + mgy, d(mgy)/dt = mg·v_y exactly cancels GravityForce's own
 * -mg·v_y power contribution, so this reduces to the non-gravity forces'
 * power whenever gravity is registered — and to exactly 0 with gravity as
 * the only registered force (the "drag off" validation case), since there
 * is then nothing left to cancel against.
 */
export function energyDerivativeFromPowers(
  forces: readonly ForceModel[],
  t: number,
  y: Float64Array,
  ctx: EvalContext,
): number {
  primePlanarEvalContext(t, y, ctx);
  return composeEnergyPower(forces, t, y, ctx) + ctx.params.mass * ctx.env.g * y[VY]!;
}

/** The `energy` InvariantSpec for the planar projectile Model (§3.7 `Model.invariants`). */
export function createEnergyInvariant(): InvariantSpec {
  return {
    name: "energy",
    evaluate(t: number, y: Float64Array, ctx: EvalContext): number {
      return mechanicalEnergy(t, y, ctx);
    },
  };
}
