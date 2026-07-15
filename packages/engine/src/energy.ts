import type { EvalContext } from "./eval-context.js";
import type { ForceModel } from "./forces.js";
import type { InvariantSpec } from "./model.js";

const Y = 1;
const VX = 2;
const VY = 3;

/**
 * Total mechanical energy E = (1/2)m|v|^2 + m*g*y (§3.8), evaluated as a
 * state function -- not integrated. Samples the environment at (t, y) itself
 * (rather than trusting ctx.env to already hold the right sample) so it can
 * be called standalone, independent of whether rhs ran first at this state.
 */
export function mechanicalEnergy(t: number, y: Float64Array, ctx: EvalContext): number {
  const x = y[0]!;
  const yPos = y[Y]!;
  const vx = y[VX]!;
  const vy = y[VY]!;

  ctx.environment.sample(t, x, yPos, ctx.env);

  const kinetic = 0.5 * ctx.params.mass * (vx * vx + vy * vy);
  const potential = ctx.params.mass * ctx.env.g * yPos;
  return kinetic + potential;
}

/** `InvariantSpec` for E(y), registrable on a `Model.invariants` list (§3.7). */
export const ENERGY_INVARIANT: InvariantSpec = {
  name: "energy",
  evaluate: mechanicalEnergy,
};

/**
 * dE/dt = F_aero . v (eq. 3.19): sums `energyPower` over `forces` using the
 * true velocity, exactly as GravityForce/QuadraticDragForce/etc. already
 * implement it (each force's power is F_i . v, dotted with the *true*
 * velocity, not v_rel). Pass only the non-gravity, aerodynamic subset of a
 * model's forces here: gravity's own power exactly cancels the potential
 * term's rate of change (-mg*vy vs. d(mgy)/dt = mg*vy), which is why E
 * already accounts for gravity without needing its power added back in --
 * including gravity here would double-count and break the identity.
 */
export function aeroPower(
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
