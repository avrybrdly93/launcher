import type { EvalContext } from "./eval-context.js";
import type { ForceModel } from "./forces.js";
import type { InvariantSpec } from "./model.js";

const Y = 1;
const VX = 2;
const VY = 3;

/** Mechanical energy E = (1/2)*m*|v|^2 + m*g*y (§3.8, "Energy balance"). */
export function mechanicalEnergy(y: Float64Array, ctx: EvalContext): number {
  const vx = y[VX]!;
  const vy = y[VY]!;
  return 0.5 * ctx.params.mass * (vx * vx + vy * vy) + ctx.params.mass * ctx.env.g * y[Y]!;
}

/**
 * Energy-rate invariant, eq. (3.19): dE/dt = F_aero . v. Gravity (and
 * buoyancy, when enabled) are *conservative* forces whose work is already
 * folded into E's mgy potential term — their own `energyPower` exactly
 * cancels against d(mgy)/dt, which is why (3.19) reduces to just the
 * non-conservative ("aero": drag, Magnus) forces' power. Callers therefore
 * pass only that subset here, not the full force registry.
 *
 * In still air (no wind) this is a strong correctness check: drag always
 * dissipates (dE/dt <= 0) and an ideal Magnus force does zero net work
 * (F_M perp v) — so with drag off, dE/dt from this invariant is exactly 0
 * to machine precision, whether or not Magnus is enabled.
 */
export function createEnergyRateInvariant(aeroForces: readonly ForceModel[]): InvariantSpec {
  return {
    name: "energyRate",
    evaluate(t: number, y: Float64Array, ctx: EvalContext): number {
      let dEdt = 0;
      for (const force of aeroForces) {
        if (force.energyPower) dEdt += force.energyPower(t, y, ctx);
      }
      return dEdt;
    },
  };
}
