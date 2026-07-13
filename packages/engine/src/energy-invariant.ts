import type { EvalContext } from "./eval-context.js";
import type { ForceModel } from "./forces.js";
import type { InvariantSpec } from "./model.js";

const X = 0;
const Y = 1;
const VX = 2;
const VY = 3;

export const MECHANICAL_ENERGY_INVARIANT = "mechanicalEnergy";

/**
 * Mechanical energy E = (1/2)m|v|^2 + mgy (§3.8, discussion preceding eq.
 * 3.19). Gravity is resampled at (t, x, y) rather than assumed constant, so
 * this stays correct under the altitude-dependent gravity model too.
 */
export function createEnergyInvariant(): InvariantSpec {
  return {
    name: MECHANICAL_ENERGY_INVARIANT,
    evaluate(t: number, y: Float64Array, ctx: EvalContext): number {
      const yPos = y[Y]!;
      const vx = y[VX]!;
      const vy = y[VY]!;
      ctx.environment.sample(t, y[X]!, yPos, ctx.env);
      return 0.5 * ctx.params.mass * (vx * vx + vy * vy) + ctx.params.mass * ctx.env.g * yPos;
    },
  };
}

/**
 * dE/dt as the sum of per-force `energyPower` (eq. 3.19), excluding gravity:
 * gravity's work is already accounted for by E's `mgy` potential term (the
 * two cancel exactly — see the derivation in the P1.24 commit/ROADMAP note),
 * so what remains is precisely eq. 3.19's F_aero · v. A force with no
 * `energyPower` contributes nothing (treated as 0, e.g. a user-defined force
 * that hasn't opted in yet).
 *
 * This is the *algebraic* dE/dt at a single state — not a trajectory finite
 * difference (no integrator exists yet in Phase 1) — which is exactly what
 * lets §3.8's exact identities be checked pointwise: drag-off ⇒ 0 to
 * floating-point precision; drag-on in still air ⇒ ≤ 0.
 *
 * Like every `ForceModel.energyPower`, this reads `ctx.vRel`/`speedRel`/`re`/
 * `mach`, so `ctx` must already be refreshed for `(t, y)` — call this right
 * after `model.rhs(t, y, out, ctx)` for the same `(t, y)`, exactly as the
 * force-composition hot path itself does.
 */
export function nonGravityPower(
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
