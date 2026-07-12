import type { EvalContext } from "./eval-context.js";
import { createForceRegistry, type ForceModel } from "./forces.js";
import type { InvariantSpec } from "./model.js";
import { norm } from "./vec2.js";

const X = 0;
const Y = 1;
const VX = 2;
const VY = 3;

/** Mechanical energy E = (1/2) m |v|^2 + m g y (§3.8). */
export function mechanicalEnergy(t: number, y: Float64Array, ctx: EvalContext): number {
  ctx.environment.sample(t, y[X]!, y[Y]!, ctx.env);
  const vx = y[VX]!;
  const vy = y[VY]!;
  return 0.5 * ctx.params.mass * (vx * vx + vy * vy) + ctx.params.mass * ctx.env.g * y[Y]!;
}

/** The engine's `E(y)` invariant, attached to `Model.invariants` (§3.7). */
export const ENERGY_INVARIANT: InvariantSpec = {
  name: "energy",
  evaluate: mechanicalEnergy,
};

/** Mirrors planarProjectileModel's rhs setup so energyPower sees fresh vRel/re/mach. */
function refreshDerivedFields(t: number, y: Float64Array, ctx: EvalContext): void {
  const vx = y[VX]!;
  const vy = y[VY]!;
  ctx.environment.sample(t, y[X]!, y[Y]!, ctx.env);
  ctx.vRel[0] = vx - ctx.env.wx;
  ctx.vRel[1] = vy - ctx.env.wy;
  ctx.speedRel = norm(ctx.vRel);
  ctx.re = (ctx.env.rho * ctx.speedRel * (2 * ctx.params.radius)) / ctx.env.eta;
  ctx.mach = ctx.env.c > 0 ? ctx.speedRel / ctx.env.c : 0;
}

/**
 * dE/dt reconstructed from per-force `energyPower` (eq. 3.19). Summing every
 * registered force's energyPower gives dKE/dt exactly (Newton's 2nd law
 * plus the work-energy theorem); adding the potential-energy rate m*g*vy
 * independently exactly cancels a registered GravityForce's own
 * energyPower (-m*g*vy), leaving F_aero.v. This is the platform's runtime
 * energy-conservation check: (i) aero off => 0, (ii) Magnus-only => 0
 * (ideal Magnus does no work), (iii) drag-on in still air => <= 0 (§3.8).
 */
export function energyRateFromPowers(
  forces: readonly ForceModel[],
  t: number,
  y: Float64Array,
  ctx: EvalContext,
): number {
  const registry = createForceRegistry(forces);
  refreshDerivedFields(t, y, ctx);
  let power = 0;
  for (const force of registry) {
    if (force.energyPower) power += force.energyPower(t, y, ctx);
  }
  return power + ctx.params.mass * ctx.env.g * y[VY]!;
}
