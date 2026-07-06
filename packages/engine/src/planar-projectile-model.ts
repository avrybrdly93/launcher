import type { EvalContext } from "./eval-context.js";
import { composeForces, createForceRegistry, type ForceModel } from "./forces.js";
import { gravityQuadraticDragJacobian } from "./jacobian.js";
import type { Model } from "./model.js";
import type { ChannelMeta } from "./schema.js";
import { norm } from "./vec2.js";

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
  const forceIds = new Set(registry.map((f) => f.id));
  const isGravityQuadraticDragOnly =
    forceIds.size === 2 && forceIds.has("gravity") && forceIds.has("drag-quadratic");

  return {
    dim: 4,
    channels: PLANAR_CHANNELS,
    rhs(t: number, y: Float64Array, out: Float64Array, ctx: EvalContext): void {
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

      composeForces(registry, t, y, ctx, ctx.forceAccum);

      out[X] = vx;
      out[Y] = vy;
      out[VX] = ctx.forceAccum[0] / ctx.params.mass;
      out[VY] = ctx.forceAccum[1] / ctx.params.mass;
    },
    ...(isGravityQuadraticDragOnly ? { jacobian: gravityQuadraticDragJacobian } : {}),
  };
}
