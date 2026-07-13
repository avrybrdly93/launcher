import { refreshDerivedQuantities, type EvalContext } from "./eval-context.js";
import { composeForces, createForceRegistry, type ForceModel } from "./forces.js";
import { createEnergyInvariantSpec } from "./energy.js";
import { gravityQuadraticDragJacobian } from "./jacobian.js";
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

/** Force ids for which the analytic gravity+quadratic-drag Jacobian (P1.22) is exact. */
const ANALYTIC_JACOBIAN_FORCE_IDS = new Set(["gravity", "drag-quadratic"]);

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
    invariants: [createEnergyInvariantSpec()],
    rhs(t: number, y: Float64Array, out: Float64Array, ctx: EvalContext): void {
      const x = y[X]!;
      const yPos = y[Y]!;
      const vx = y[VX]!;
      const vy = y[VY]!;

      refreshDerivedQuantities(t, x, yPos, vx, vy, ctx);
      composeForces(registry, t, y, ctx, ctx.forceAccum);

      out[X] = vx;
      out[Y] = vy;
      out[VX] = ctx.forceAccum[0] / ctx.params.mass;
      out[VY] = ctx.forceAccum[1] / ctx.params.mass;
    },
  };

  // Only exact when every registered force is gravity and/or quadratic drag
  // (no Magnus, buoyancy, linear drag, ...) — see jacobian.ts for scope.
  if (registry.every((f) => ANALYTIC_JACOBIAN_FORCE_IDS.has(f.id))) {
    return { ...model, jacobian: gravityQuadraticDragJacobian };
  }
  return model;
}
