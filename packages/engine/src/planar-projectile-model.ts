import { refreshEvalContext, type EvalContext } from "./eval-context.js";
import { createMechanicalEnergyInvariant } from "./energy.js";
import { composeForces, createForceRegistry, type ForceModel } from "./forces.js";
import { gravityQuadraticDragJacobian, supportsGravityQuadraticDragJacobian } from "./jacobian.js";
import type { Model } from "./model.js";
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

/**
 * The workhorse planar projectile model (dim 4, eq. 3.17-3.18): wires
 * gravity/drag/Magnus/buoyancy force composition into a single rhs. This is
 * the first Model SolverKit will integrate — deliberately just a Model, with
 * no special status in the engine (§1.4).
 */
export function createPlanarProjectileModel(forces: readonly ForceModel[]): Model {
  const registry = createForceRegistry(forces);
  const model: Model = {
    dim: 4,
    channels: PLANAR_CHANNELS,
    invariants: [createMechanicalEnergyInvariant()],
    rhs(t: number, y: Float64Array, out: Float64Array, ctx: EvalContext): void {
      refreshEvalContext(t, y, ctx);
      composeForces(registry, t, y, ctx, ctx.forceAccum);

      out[X] = y[VX]!;
      out[Y] = y[VY]!;
      out[VX] = ctx.forceAccum[0] / ctx.params.mass;
      out[VY] = ctx.forceAccum[1] / ctx.params.mass;
    },
  };

  if (supportsGravityQuadraticDragJacobian(registry.map((f) => f.id))) {
    model.jacobian = gravityQuadraticDragJacobian;
  }

  return model;
}
