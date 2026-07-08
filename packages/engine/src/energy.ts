import type { EvalContext } from "./eval-context.js";
import type { ForceModel } from "./forces.js";

const Y = 1;
const VX = 2;
const VY = 3;

/**
 * Mechanical energy E = (1/2) m |v|^2 + m g y (eq. 3.19), with gravity's
 * potential baked into the g*y term rather than left as a force power term.
 */
export function mechanicalEnergy(y: Float64Array, mass: number, g: number): number {
  const vx = y[VX]!;
  const vy = y[VY]!;
  return 0.5 * mass * (vx * vx + vy * vy) + mass * g * y[Y]!;
}

/**
 * Sums `energyPower(t, y, ctx)` across `forces` (0 for forces that don't
 * define one) — the per-force power wiring underlying (3.19), the scalar
 * analogue of `composeForces` (P1.18).
 */
export function composeEnergyPower(
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

/**
 * dE/dt via the exact ODE derivative (chain rule through the rhs
 * acceleration output `out`), with no numerical stepping involved. This is
 * algebraically identical to `composeEnergyPower` over every *non-gravity*
 * force: m*a = F_net, so m(vx*ax + vy*ay) = v.F_net = sum_i energyPower_i
 * over *all* forces including gravity, and gravity.energyPower = -m*g*vy by
 * construction, which exactly cancels this function's `+ m*g*vy` term. Per
 * (3.19): with aero forces off, dE/dt = 0 exactly; with Magnus only in
 * still air, dE/dt = 0 since F_M is perpendicular to v.
 */
export function mechanicalEnergyRate(
  y: Float64Array,
  out: Float64Array,
  mass: number,
  g: number,
): number {
  const vx = y[VX]!;
  const vy = y[VY]!;
  const ax = out[VX]!;
  const ay = out[VY]!;
  return mass * (vx * ax + vy * ay) + mass * g * vy;
}
