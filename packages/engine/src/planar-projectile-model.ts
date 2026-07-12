import type { EvalContext } from "./eval-context.js";
import type { Environment } from "./environment.js";
import { composeForces, createForceRegistry, type ForceModel } from "./forces.js";
import { createGravityQuadraticDragJacobian } from "./jacobian.js";
import type { Model } from "./model.js";
import type { ProjectileParams } from "./projectile-params.js";
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

/** True iff `forces` is exactly {gravity, quadratic drag} — the sole combination P1.22's analytic Jacobian covers. */
function isGravityQuadraticDragOnly(forces: readonly ForceModel[]): boolean {
  if (forces.length !== 2) return false;
  const ids = new Set(forces.map((f) => f.id));
  return ids.has("gravity") && ids.has("drag-quadratic");
}

/**
 * The workhorse planar projectile model (dim 4, eq. 3.17-3.18): wires
 * gravity/drag/Magnus/buoyancy force composition into a single rhs. This is
 * the first Model SolverKit will integrate — deliberately just a Model, with
 * no special status in the engine (§1.4).
 *
 * When `forces` is exactly {gravity, quadratic drag} and `jacobianEnv` is
 * supplied, the returned Model carries the analytic Jacobian of P1.22;
 * otherwise `jacobian` is omitted and callers fall back to FD (P1.23).
 */
export function createPlanarProjectileModel(
  forces: readonly ForceModel[],
  jacobianEnv?: { readonly params: ProjectileParams; readonly environment: Environment },
): Model {
  const registry = createForceRegistry(forces);

  const model: Model = {
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
  };

  if (jacobianEnv && isGravityQuadraticDragOnly(forces)) {
    return {
      ...model,
      jacobian: createGravityQuadraticDragJacobian(jacobianEnv.params, jacobianEnv.environment),
    };
  }
  return model;
}
