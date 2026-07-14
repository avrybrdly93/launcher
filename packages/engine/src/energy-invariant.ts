import type { EvalContext } from "./eval-context.js";
import type { ForceModel } from "./forces.js";
import type { InvariantSpec } from "./model.js";
import { norm } from "./vec2.js";

const X = 0;
const Y = 1;
const VX = 2;
const VY = 3;

/** Mechanical energy E = (1/2)m|v|^2 + mgy (§3.8, eq. 3.19 preamble). */
export function createEnergyInvariant(): InvariantSpec {
  return {
    name: "energy",
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
 * dE/dt computed from each force's `energyPower` (eq. 3.19): gravity's power
 * -mg*v_y exactly cancels the potential-energy rate +mg*v_y baked into E, so
 * summing every registered force's power and adding the potential-energy
 * rate leaves only the aerodynamic-force contribution, dE/dt = F_aero . v.
 * With aero forces off, this is a pure cancellation and dE/dt is 0 to
 * round-off — the runtime correctness check named in §3.8 item (i).
 *
 * Self-contained (re-samples the environment and vRel/speedRel/re/mach)
 * rather than assuming a preceding `rhs` call already refreshed `ctx`, so it
 * can be used standalone as a Recorder diagnostic.
 */
export function energyRateFromPowers(
  forces: readonly ForceModel[],
  t: number,
  y: Float64Array,
  ctx: EvalContext,
): number {
  const x = y[X]!;
  const yPos = y[Y]!;
  const vx = y[VX]!;
  const vy = y[VY]!;

  ctx.environment.sample(t, x, yPos, ctx.env);
  ctx.vRel[0] = vx - ctx.env.wx;
  ctx.vRel[1] = vy - ctx.env.wy;
  ctx.speedRel = norm(ctx.vRel);
  ctx.re = (ctx.env.rho * ctx.speedRel * (2 * ctx.params.radius)) / ctx.env.eta;
  ctx.mach = ctx.env.c > 0 ? ctx.speedRel / ctx.env.c : 0;

  let dPowerSum = 0;
  for (const force of forces) {
    if (force.energyPower) dPowerSum += force.energyPower(t, y, ctx);
  }
  const dPotentialDt = ctx.params.mass * ctx.env.g * vy;
  return dPowerSum + dPotentialDt;
}
