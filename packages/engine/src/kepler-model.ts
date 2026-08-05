import type { InvariantSpec, Model } from "./model.js";
import type { ChannelMeta } from "./schema.js";

/** State-channel metadata for {@link createKeplerModel}: [rx, ry, vx, vy]. */
export const KEPLER_CHANNELS: readonly ChannelMeta[] = [
  { name: "rx", unit: "m" },
  { name: "ry", unit: "m" },
  { name: "vx", unit: "m/s" },
  { name: "vy", unit: "m/s" },
];

const RX = 0;
const RY = 1;
const VX = 2;
const VY = 3;
const DIM = 4;

/**
 * Specific orbital energy (energy per unit mass of the secondary)
 * E = |v|^2/2 - mu/|r| of the planar two-body problem. Conserved exactly by
 * the continuous flow: dE/dt = v.a + mu*(r.v)/|r|^3, and a = -mu*r/|r|^3
 * makes the two terms cancel identically. Negative for a bound (elliptic)
 * orbit, zero for parabolic, positive for hyperbolic -- so its *sign* is the
 * orbit classification and its *drift* is the integrator diagnostic (P4.33).
 */
export function keplerEnergy(y: Float64Array, mu: number): number {
  const vx = y[VX]!;
  const vy = y[VY]!;
  return 0.5 * (vx * vx + vy * vy) - mu / Math.hypot(y[RX]!, y[RY]!);
}

/**
 * Specific angular momentum L = rx*vy - ry*vx (the scalar z-component the
 * planar problem reduces the vector to). Conserved because the inverse-square
 * attraction is central: dL/dt = rx*ay - ry*ax, and a parallel to r makes
 * that cross product vanish identically, independently of the 1/|r|^2 radial
 * profile. A second, structurally different invariant from the energy above
 * -- an integrator can hold one while drifting the other, so the pair says
 * more than either alone.
 */
export function keplerAngularMomentum(y: Float64Array): number {
  return y[RX]! * y[VY]! - y[RY]! * y[VX]!;
}

function createEnergyInvariant(mu: number): InvariantSpec {
  return {
    name: "E",
    evaluate: (_t: number, y: Float64Array) => keplerEnergy(y, mu),
  };
}

function createAngularMomentumInvariant(): InvariantSpec {
  return {
    name: "L",
    evaluate: (_t: number, y: Float64Array) => keplerAngularMomentum(y),
  };
}

/**
 * Planar two-body / Kepler problem in the fixed-primary (restricted)
 * formulation (P4.33, Stage-B seed): a test mass under the inverse-square
 * attraction of a primary held at the origin,
 * `r'' = -mu * r / |r|^3` with `mu = G*(M + m)` the standard gravitational
 * parameter. Reducing the genuine two-body problem to this one-body form is
 * the textbook barycentric reduction, not an approximation: the relative
 * coordinate of two mutually attracting masses obeys exactly this equation.
 *
 * The second non-projectile `Model` registered (after {@link
 * createPendulumModel}) and the first with *two* invariants, which is the
 * point of the task: energy and angular momentum are independent conserved
 * quantities, and the eccentric-orbit test in SolverKit uses the pair to
 * separate the two failure modes an integrator can have here -- RK4's secular
 * energy drift (the orbit spirals) versus velocity Verlet's bounded,
 * oscillating energy error (the orbit stays closed). Angular momentum is a
 * useful control in that comparison: it comes from the force being *central*
 * rather than from the Hamiltonian structure, so it survives in both.
 *
 * Conservative by construction -- no drag, damping, or any other dissipative
 * term -- which is precisely the precondition for integrating it
 * symplectically. `partitions` marks (rx, ry) as position (q) and (vx, vy) as
 * velocity (p), paired by index per the platform convention, so the Verlet
 * stepper applies directly.
 *
 * @param mu Standard gravitational parameter G*(M+m), strictly positive.
 */
export function createKeplerModel(mu: number): Model {
  if (!(mu > 0)) {
    throw new Error(`createKeplerModel requires a positive mu, got ${mu}`);
  }
  return {
    dim: DIM,
    channels: KEPLER_CHANNELS,
    invariants: [createEnergyInvariant(mu), createAngularMomentumInvariant()],
    partitions: { q: [RX, RY], p: [VX, VY] },
    rhs(_t: number, y: Float64Array, out: Float64Array): void {
      const rx = y[RX]!;
      const ry = y[RY]!;
      // hypot, not sqrt(rx*rx + ry*ry): the cube below already pushes the
      // radius through a wide dynamic range on an eccentric orbit, and the
      // naive form overflows/underflows a factor of two sooner in the
      // exponent than hypot's scaled evaluation does.
      const r = Math.hypot(rx, ry);
      const invR3 = 1 / (r * r * r);
      out[RX] = y[VX]!;
      out[RY] = y[VY]!;
      out[VX] = -mu * rx * invR3;
      out[VY] = -mu * ry * invR3;
    },
  };
}
