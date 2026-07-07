import type { EvalContext } from "./eval-context.js";
import {
  composeForces,
  composeVelocityJacobian,
  createForceRegistry,
  forcesSupportJacobian,
  type ForceModel,
} from "./forces.js";
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
const DIM = 4;

/** Refreshes ctx.env/vRel/speedRel/re/mach for state (x, yPos, vx, vy) at time t, once per eval. */
function refreshDerived(
  t: number,
  x: number,
  yPos: number,
  vx: number,
  vy: number,
  ctx: EvalContext,
): void {
  ctx.environment.sample(t, x, yPos, ctx.env);
  ctx.vRel[0] = vx - ctx.env.wx;
  ctx.vRel[1] = vy - ctx.env.wy;
  ctx.speedRel = norm(ctx.vRel);
  ctx.re = (ctx.env.rho * ctx.speedRel * (2 * ctx.params.radius)) / ctx.env.eta;
  ctx.mach = ctx.env.c > 0 ? ctx.speedRel / ctx.env.c : 0;
}

/**
 * The workhorse planar projectile model (dim 4, eq. 3.17-3.18): wires
 * gravity/drag/Magnus/buoyancy force composition into a single rhs. This is
 * the first Model SolverKit will integrate — deliberately just a Model, with
 * no special status in the engine (§1.4).
 */
export function createPlanarProjectileModel(forces: readonly ForceModel[]): Model {
  const registry = createForceRegistry(forces);
  const velocityJacobian = new Float64Array(4);

  const model: Model = {
    dim: DIM,
    channels: PLANAR_CHANNELS,
    rhs(t: number, y: Float64Array, out: Float64Array, ctx: EvalContext): void {
      const x = y[X]!;
      const yPos = y[Y]!;
      const vx = y[VX]!;
      const vy = y[VY]!;

      refreshDerived(t, x, yPos, vx, vy, ctx);

      composeForces(registry, t, y, ctx, ctx.forceAccum);

      out[X] = vx;
      out[Y] = vy;
      out[VX] = ctx.forceAccum[0] / ctx.params.mass;
      out[VY] = ctx.forceAccum[1] / ctx.params.mass;
    },
  };

  // Only expose an analytic Jacobian if every registered force can linearize
  // itself (P1.22); e.g. Magnus (clamp kink) opts out, so a model wired with
  // it simply leaves `jacobian` undefined for callers to detect and fall
  // back to finite differences (P1.23).
  if (forcesSupportJacobian(registry)) {
    model.jacobian = (t: number, y: Float64Array, out: Float64Array, ctx: EvalContext): void => {
      const x = y[X]!;
      const yPos = y[Y]!;
      const vx = y[VX]!;
      const vy = y[VY]!;

      refreshDerived(t, x, yPos, vx, vy, ctx);
      composeVelocityJacobian(registry, t, y, ctx, velocityJacobian);

      out.fill(0, 0, DIM * DIM);
      out[X * DIM + VX] = 1; // d(dx/dt)/d(vx)
      out[Y * DIM + VY] = 1; // d(dy/dt)/d(vy)

      const invMass = 1 / ctx.params.mass;
      out[VX * DIM + VX] = velocityJacobian[0]! * invMass;
      out[VX * DIM + VY] = velocityJacobian[1]! * invMass;
      out[VY * DIM + VX] = velocityJacobian[2]! * invMass;
      out[VY * DIM + VY] = velocityJacobian[3]! * invMass;
    };
  }

  return model;
}
