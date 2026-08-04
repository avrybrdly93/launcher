import { G_STD } from "./units.js";
import type { InvariantSpec, Model } from "./model.js";
import type { ChannelMeta } from "./schema.js";

/** State-channel metadata for {@link createPendulumModel}: [theta, omega]. */
export const PENDULUM_CHANNELS: readonly ChannelMeta[] = [
  { name: "theta", unit: "rad" },
  { name: "omega", unit: "rad/s" },
];

const THETA = 0;
const OMEGA = 1;
const DIM = 2;

/** Construction params for {@link createPendulumModel}: a rigid, undamped simple pendulum. */
export interface PendulumParams {
  /** Pivot-to-bob length, m. */
  readonly length: number;
  /** Local gravitational acceleration, m/s^2. Defaults to {@link G_STD}. */
  readonly gravity?: number;
  /** Bob mass, kg. Cancels out of the dynamics entirely -- only scales the `H` invariant's value. Defaults to 1. */
  readonly mass?: number;
}

/**
 * Hamiltonian (total mechanical energy) of the simple pendulum, `H =
 * (1/2) m L^2 omega^2 + m g L (1 - cos(theta))`: kinetic `(1/2) m v_tangential^2`
 * with `v_tangential = L*omega`, plus potential measured from the
 * lowest point (`theta = 0`) so `H >= 0` everywhere and `H(theta0, 0) = m g L
 * (1 - cos(theta0))` for a release-from-rest amplitude `theta0`.
 */
export function pendulumHamiltonian(
  y: Float64Array,
  length: number,
  gravity: number,
  mass: number,
): number {
  const omega = y[OMEGA]!;
  const theta = y[THETA]!;
  return (
    0.5 * mass * length * length * omega * omega + mass * gravity * length * (1 - Math.cos(theta))
  );
}

/**
 * Builds the simple (rigid, undamped) pendulum `Model` (Stage-B seed,
 * P4.31): `theta' = omega`, `omega' = -(g/L) sin(theta)` (the standard
 * nonlinear pendulum equation -- no small-angle approximation). This is the
 * platform's first registered `Model` with no `ForceModel`/`EvalContext`
 * dependency at all: `rhs` ignores its `ctx` parameter entirely, since the
 * pendulum's dynamics are fully determined by `length`/`gravity` baked in at
 * construction, unlike the projectile models' environment-sampled forces.
 *
 * Declares the `H` (Hamiltonian/mechanical-energy) invariant via
 * {@link pendulumHamiltonian} and `partitions: { q: [theta], p: [omega] }`
 * (`dtheta/dt` is exactly the `omega` channel's value, the same "paired by
 * index" contract {@link createPlanarProjectileModel} documents) for
 * P2.15's semi-implicit Euler and later Verlet-family steppers -- the
 * bounded-energy-oscillation guarantee those steppers provide on conservative
 * systems applies directly here, unlike the projectile's unbounded linear
 * gravity potential (see `semi-implicit-euler-stepper.ts`'s harmonic-
 * oscillator note).
 *
 * No events are declared: unlike the projectile models, the pendulum has no
 * intrinsic "ground" or "apex" to root-find on. A caller measuring period
 * (e.g. against the elliptic-integral reference this model is validated
 * against, `pendulum-model.test.ts`) attaches its own event via
 * `{ ...model, events: [...] }` rather than this factory declaring one
 * pendulum-specific-use-case events unconditionally.
 */
export function createPendulumModel(params: PendulumParams): Model {
  const length = params.length;
  const gravity = params.gravity ?? G_STD;
  const mass = params.mass ?? 1;
  const gOverL = gravity / length;

  const hInvariant: InvariantSpec = {
    name: "H",
    evaluate: (_t: number, y: Float64Array) => pendulumHamiltonian(y, length, gravity, mass),
  };

  return {
    dim: DIM,
    channels: PENDULUM_CHANNELS,
    invariants: [hInvariant],
    partitions: { q: [THETA], p: [OMEGA] },
    rhs(_t: number, y: Float64Array, out: Float64Array): void {
      out[THETA] = y[OMEGA]!;
      out[OMEGA] = -gOverL * Math.sin(y[THETA]!);
    },
  };
}
