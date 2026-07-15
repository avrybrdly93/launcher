import type { EvalContext } from "./eval-context.js";
import type { ForceModel } from "./forces.js";
import type { InvariantSpec } from "./model.js";

const X = 0;
const Y = 1;
const VX = 2;
const VY = 3;

/**
 * Mechanical energy E = (1/2)m|v|^2 + mgy (§3.8, above eq. 3.19). Samples the
 * environment fresh at `y` rather than trusting `ctx.env` to already be
 * current, since an invariant may be evaluated independently of `rhs` (e.g.
 * from a recorded trajectory sample, not mid-integration).
 */
export function mechanicalEnergy(t: number, y: Float64Array, ctx: EvalContext): number {
  const vx = y[VX]!;
  const vy = y[VY]!;
  ctx.environment.sample(t, y[X]!, y[Y]!, ctx.env);
  return 0.5 * ctx.params.mass * (vx * vx + vy * vy) + ctx.params.mass * ctx.env.g * y[Y]!;
}

/** `InvariantSpec` wrapping `mechanicalEnergy`, for `Model.invariants` (§3.7). */
export function createEnergyInvariant(): InvariantSpec {
  return { name: "energy", evaluate: mechanicalEnergy };
}

/**
 * Sum of every registered force's `energyPower` (F_i . v, true velocity).
 * By Newton's second law this equals d(KE)/dt exactly — a correctness
 * check on the `energyPower` wiring, independent of which forces are
 * present (T-VAL style identity, always true, not just when drag is off).
 */
export function totalEnergyPower(
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
 * Sum of every registered force's `energyPower` *except* gravity's. Gravity
 * always does work exactly offsetting the m*g*y term in `mechanicalEnergy`
 * (eq. 3.19), so this quantity is dE/dt of `mechanicalEnergy` itself: zero
 * with aero off, zero for an ideal Magnus force alone, and non-positive for
 * drag alone in still air (§3.8's three exact runtime checks).
 *
 * Limitation: buoyancy is treated as an "aero" force here — like gravity it
 * is actually conservative (a constant force under a spatially-uniform
 * atmosphere), but `mechanicalEnergy` has no matching potential term for
 * it, so a scenario with buoyancy on and drag off will show nonzero power
 * here despite being physically energy-conserving. Out of scope for P1.24;
 * revisit if/when buoyancy needs its own invariant-checked potential.
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
    if (force.energyPower) power += force.energyPower(t, y, ctx);
  }
  return power;
}
