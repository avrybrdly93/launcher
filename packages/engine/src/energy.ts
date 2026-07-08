import type { EvalContext } from "./eval-context.js";
import type { ForceModel } from "./forces.js";
import type { InvariantSpec, Model } from "./model.js";

type RhsFn = Model["rhs"];

const X = 0;
const Y = 1;
const VX = 2;
const VY = 3;

/** Mechanical energy E = (1/2)m|v|^2 + mgy (eq. 3.19); potential uses the environment's local g. */
export function mechanicalEnergy(t: number, y: Float64Array, ctx: EvalContext): number {
  const vx = y[VX]!;
  const vy = y[VY]!;
  ctx.environment.sample(t, y[X]!, y[Y]!, ctx.env);
  return 0.5 * ctx.params.mass * (vx * vx + vy * vy) + ctx.params.mass * ctx.env.g * y[Y]!;
}

/** E(y) as a first-class InvariantSpec, for the Recorder/analysis layer to track over a trajectory. */
export function createMechanicalEnergyInvariant(): InvariantSpec {
  return { name: "mechanical-energy", evaluate: mechanicalEnergy };
}

/**
 * Sum of energyPower over every force except gravity. Gravity's power
 * (-mgv_y) is already the rate of change of E's potential term, so it must
 * not be double-counted; the remainder is exactly eq. 3.19's F_aero.v.
 */
function aeroEnergyPower(
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

/**
 * InvariantSpec whose value is the energy-balance residual
 * R_E = dE/dt - F_aero.v (eq. 3.19), evaluated from a single rhs call rather
 * than a numerical time-derivative: dE/dt = m(vx*ax + vy*ay) + m*g*vy
 * expands, since m*a = sum_i F_i, to sum_i(F_i.v) + m*g*vy; gravity's own
 * energyPower is exactly -m*g*vy, which cancels the potential term. So R_E
 * is an algebraic identity, exactly 0 (to round-off) for *any* force
 * combination -- a runtime check that per-force energyPower is wired to the
 * true velocity, not v_rel (§3.3's "most common student bug"). With aero
 * forces off (P1.24's validation case), F_aero = 0 too, so E itself -- not
 * just R_E -- is conserved.
 *
 * Takes the model's `rhs` and `dim` directly (rather than the `Model`
 * itself) so it can be built and attached to `model.invariants` in the same
 * object literal that defines `rhs` -- `invariants` is a readonly field, so
 * it can't be assigned after construction by referencing the finished model.
 */
export function createEnergyBalanceInvariant(
  rhs: RhsFn,
  dim: number,
  forces: readonly ForceModel[],
): InvariantSpec {
  const scratch = new Float64Array(dim);

  return {
    name: "energy-balance-residual",
    evaluate(t: number, y: Float64Array, ctx: EvalContext): number {
      rhs(t, y, scratch, ctx);
      const vx = y[VX]!;
      const vy = y[VY]!;
      const ax = scratch[VX]!;
      const ay = scratch[VY]!;
      const dEdt = ctx.params.mass * (vx * ax + vy * ay) + ctx.params.mass * ctx.env.g * vy;
      return dEdt - aeroEnergyPower(forces, t, y, ctx);
    },
  };
}
