import type { EvalContext } from "./eval-context.js";
import type { ForceModel } from "./forces.js";
import { composeForces } from "./forces.js";
import type { InvariantSpec } from "./model.js";
import { norm } from "./vec2.js";

const X = 0;
const Y = 1;
const VX = 2;
const VY = 3;

/**
 * Mechanical energy E = (1/2) m |v|^2 + m g y (eq. 3.19) — kinetic plus
 * *gravitational* potential only. A pure function of the state; it does not
 * know about drag, Magnus, or buoyancy, which is the point: those show up
 * as a nonzero residual in `dE/dt`, not as an extra potential term here.
 */
export function mechanicalEnergy(y: Float64Array, mass: number, g: number): number {
  const vx = y[VX]!;
  const vy = y[VY]!;
  return 0.5 * mass * (vx * vx + vy * vy) + mass * g * y[Y]!;
}

/**
 * `InvariantSpec` wiring `mechanicalEnergy` into `Model.invariants`, reading
 * mass from `ctx.params` and gravity from `ctx.env.g` (assumed freshly
 * sampled by a preceding `rhs`/`energyRateFromForces` call at the same
 * `(t, y)`). Only meaningful when gravity is one of the model's forces —
 * `mgy` is not a real potential for a force-free-of-gravity model.
 */
export function createEnergyInvariant(): InvariantSpec {
  return {
    name: "energy",
    evaluate(_t: number, y: Float64Array, ctx: EvalContext): number {
      return mechanicalEnergy(y, ctx.params.mass, ctx.env.g);
    },
  };
}

/**
 * Sum of `energyPower(t, y, ctx)` over every registered force *except*
 * gravity — the "F_aero·v" term of (3.19), generalized to any non-gravity
 * force (drag, Magnus, buoyancy, user-defined). A force without
 * `energyPower` contributes 0, which understates the true residual rather
 * than throwing; every force currently shipped implements it.
 */
export function nonGravityPower(
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
 * dE/dt computed *kinematically*, i.e. independent of any per-force
 * `energyPower` implementation: `v·F_total + m g v_y`, using the same
 * `composeForces` accumulation `rhs` uses. This is the cross-check target
 * for `nonGravityPower` — algebraically, `v·F_total = Σ energyPower_i`
 * (every force, including gravity), and gravity's own power
 * `-m g v_y` exactly cancels the `+m g v_y` potential-derivative term here,
 * leaving `dE/dt == Σ_{i≠gravity} energyPower_i` whenever gravity is one of
 * `forces` — the identity this module's tests verify to 1e-13 (P1.24).
 */
export function energyRateFromForces(
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

  composeForces(forces, t, y, ctx, ctx.forceAccum);

  return vx * ctx.forceAccum[0] + vy * ctx.forceAccum[1] + ctx.params.mass * ctx.env.g * vy;
}
