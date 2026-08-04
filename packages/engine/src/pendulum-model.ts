import type { InvariantSpec, Model } from "./model.js";
import type { ChannelMeta } from "./schema.js";

/** State-channel metadata for {@link createPendulumModel}: [theta, thetadot]. */
export const PENDULUM_CHANNELS: readonly ChannelMeta[] = [
  { name: "theta", unit: "rad" },
  { name: "thetadot", unit: "rad/s" },
];

const THETA = 0;
const THETADOT = 1;
const DIM = 2;

/**
 * Specific mechanical energy H = (1/2)(L*thetadot)^2 - g*L*cos(theta) of the
 * simple pendulum (Stage-B seed, §3.8's invariant-checking pattern applied
 * to a non-projectile model): kinetic term uses the bob's tangential speed
 * L*thetadot, potential term is -g*L*cos(theta) (zero at the pivot height,
 * matching the sign convention of theta measured from the downward
 * vertical). Constant across a torque-free swing regardless of amplitude --
 * dH/dt = L^2*thetadot*thetadotdot + g*L*sin(theta)*thetadot, and
 * thetadotdot = -(g/L)*sin(theta) makes the two terms cancel exactly.
 */
export function pendulumEnergy(y: Float64Array, L: number, g: number): number {
  const thetadot = y[THETADOT]!;
  return 0.5 * L * L * thetadot * thetadot - g * L * Math.cos(y[THETA]!);
}

function createEnergyInvariant(L: number, g: number): InvariantSpec {
  return {
    name: "H",
    evaluate: (_t: number, y: Float64Array) => pendulumEnergy(y, L, g),
  };
}

/**
 * Simple (undamped, unforced) pendulum of length L in gravity g (P4.31,
 * Stage-B seed): thetadotdot = -(g/L)*sin(theta). The first non-projectile
 * `Model` registered -- built entirely from the shared `Model`/
 * `InvariantSpec` engine interfaces with no `EvalContext` dependency (no
 * forces, no environment sampling), demonstrating those interfaces impose no
 * projectile-specific assumptions. `partitions` marks theta as position (q)
 * and thetadot as velocity (p): the pair symplectic/Verlet steppers require
 * for the pendulum's classic closed-orbit-vs-spiral phase portrait (P4.32).
 */
export function createPendulumModel(L: number, g: number): Model {
  return {
    dim: DIM,
    channels: PENDULUM_CHANNELS,
    invariants: [createEnergyInvariant(L, g)],
    partitions: { q: [THETA], p: [THETADOT] },
    rhs(_t: number, y: Float64Array, out: Float64Array): void {
      out[THETA] = y[THETADOT]!;
      out[THETADOT] = -(g / L) * Math.sin(y[THETA]!);
    },
  };
}
