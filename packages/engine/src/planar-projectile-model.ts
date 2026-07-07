import type { EvalContext } from "./eval-context.js";
import { mechanicalEnergy } from "./energy.js";
import { composeForces, createForceRegistry, type ForceModel } from "./forces.js";
import { analyticGravityQuadraticDragJacobian } from "./jacobian-quadratic-drag.js";
import type { InvariantSpec, Model } from "./model.js";
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
/** Force-id set for which the analytic Jacobian (P1.22) is valid: gravity + quadratic drag only. */
const ANALYTIC_JACOBIAN_FORCE_IDS = new Set(["gravity", "drag-quadratic"]);

/** Mechanical energy E = (1/2)m|v|^2 + mgy (§3.8), the universal invariant/monotonicity diagnostic. */
const ENERGY_INVARIANT: InvariantSpec = {
  name: "energy",
  evaluate(_t: number, y: Float64Array, ctx: EvalContext): number {
    return mechanicalEnergy(y, ctx);
  },
};

export function createPlanarProjectileModel(forces: readonly ForceModel[]): Model {
  const registry = createForceRegistry(forces);

  const model: Model = {
    dim: 4,
    channels: PLANAR_CHANNELS,
    invariants: [ENERGY_INVARIANT],
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

  const isAnalyticJacobianEligible =
    registry.length > 0 && registry.every((f) => ANALYTIC_JACOBIAN_FORCE_IDS.has(f.id));
  if (isAnalyticJacobianEligible) {
    return {
      ...model,
      jacobian(t: number, y: Float64Array, out: Float64Array, ctx: EvalContext): void {
        // Refresh ctx's scratch fields at (t, y) ourselves rather than trusting
        // a prior rhs call left them current — jacobian must be independently callable.
        ctx.environment.sample(t, y[X]!, y[Y]!, ctx.env);
        ctx.vRel[0] = y[VX]! - ctx.env.wx;
        ctx.vRel[1] = y[VY]! - ctx.env.wy;
        ctx.speedRel = norm(ctx.vRel);
        ctx.re = (ctx.env.rho * ctx.speedRel * (2 * ctx.params.radius)) / ctx.env.eta;
        ctx.mach = ctx.env.c > 0 ? ctx.speedRel / ctx.env.c : 0;
        analyticGravityQuadraticDragJacobian(t, y, out, ctx);
      },
    };
  }
  return model;
}
