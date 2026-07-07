import type { EvalContext } from "./eval-context.js";
import { createEnergyInvariant } from "./energy-invariant.js";
import {
  composeForceJacobians,
  composeForces,
  createForceRegistry,
  hasAnalyticJacobian,
  type ForceModel,
} from "./forces.js";
import type { Model } from "./model.js";
import { refreshDerivedState } from "./planar-derived-state.js";
import type { ChannelMeta } from "./schema.js";

export const PLANAR_CHANNELS: readonly ChannelMeta[] = [
  { name: "x", unit: "m" },
  { name: "y", unit: "m" },
  { name: "vx", unit: "m/s" },
  { name: "vy", unit: "m/s" },
];

const X = 0;
const Y = 1;
const VX = 2;
const VY = 3;
const STATE_DIM = 4;

/**
 * The workhorse planar projectile model (dim 4, eq. 3.17-3.18): wires
 * gravity/drag/Magnus/buoyancy force composition into a single rhs. This is
 * the first Model SolverKit will integrate — deliberately just a Model, with
 * no special status in the engine (§1.4).
 *
 * `model.jacobian` is only defined when every composed force provides an
 * analytic derivative (P1.22) — e.g. gravity + quadratic drag, but not
 * Magnus. Otherwise it's left undefined so callers know to fall back to
 * finite differences (P1.23).
 */
export function createPlanarProjectileModel(forces: readonly ForceModel[]): Model {
  const registry = createForceRegistry(forces);

  const model: Model = {
    dim: 4,
    channels: PLANAR_CHANNELS,
    invariants: [createEnergyInvariant()],
    rhs(t: number, y: Float64Array, out: Float64Array, ctx: EvalContext): void {
      refreshDerivedState(t, y, ctx);

      composeForces(registry, t, y, ctx, ctx.forceAccum);

      out[X] = y[VX]!;
      out[Y] = y[VY]!;
      out[VX] = ctx.forceAccum[0] / ctx.params.mass;
      out[VY] = ctx.forceAccum[1] / ctx.params.mass;
    },
  };

  if (hasAnalyticJacobian(registry)) {
    model.jacobian = (t: number, y: Float64Array, out: Float64Array, ctx: EvalContext): void => {
      refreshDerivedState(t, y, ctx);
      composeForceJacobians(registry, t, y, ctx, out);

      const invMass = 1 / ctx.params.mass;
      out[VX * STATE_DIM + VX] = out[VX * STATE_DIM + VX]! * invMass;
      out[VX * STATE_DIM + VY] = out[VX * STATE_DIM + VY]! * invMass;
      out[VY * STATE_DIM + VX] = out[VY * STATE_DIM + VX]! * invMass;
      out[VY * STATE_DIM + VY] = out[VY * STATE_DIM + VY]! * invMass;

      out[X * STATE_DIM + VX] = 1;
      out[Y * STATE_DIM + VY] = 1;
    };
  }

  return model;
}
