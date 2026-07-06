import type { EvalContext } from "./eval-context.js";
import {
  allForcesHaveJacobian,
  composeForces,
  composeJacobian,
  createForceRegistry,
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

/** Refreshes the once-per-eval env sample + derived Re/Mach (shared by rhs and jacobian). */
function sampleRelativeMotion(
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
 *
 * `jacobian` is only wired up when every force in `forces` supplies an
 * analytic derivative (P1.22, currently gravity + quadratic drag); with
 * Magnus or any other non-differentiated force present it is left
 * `undefined` so callers fall back to finite differences (P1.23).
 */
export function createPlanarProjectileModel(forces: readonly ForceModel[]): Model {
  const registry = createForceRegistry(forces);
  const jacAccum = new Float64Array(2 * DIM);

  const rhs = (t: number, y: Float64Array, out: Float64Array, ctx: EvalContext): void => {
    const x = y[X]!;
    const yPos = y[Y]!;
    const vx = y[VX]!;
    const vy = y[VY]!;

    sampleRelativeMotion(t, x, yPos, vx, vy, ctx);
    composeForces(registry, t, y, ctx, ctx.forceAccum);

    out[X] = vx;
    out[Y] = vy;
    out[VX] = ctx.forceAccum[0]! / ctx.params.mass;
    out[VY] = ctx.forceAccum[1]! / ctx.params.mass;
  };

  const jacobian = (t: number, y: Float64Array, out: Float64Array, ctx: EvalContext): void => {
    const x = y[X]!;
    const yPos = y[Y]!;
    const vx = y[VX]!;
    const vy = y[VY]!;

    sampleRelativeMotion(t, x, yPos, vx, vy, ctx);
    composeJacobian(registry, t, y, ctx, jacAccum);

    const invM = 1 / ctx.params.mass;
    out.fill(0);
    out[X * DIM + VX] = 1; // d(x-dot)/d(vx)
    out[Y * DIM + VY] = 1; // d(y-dot)/d(vy)
    out[VX * DIM + X] = jacAccum[0]! * invM;
    out[VX * DIM + Y] = jacAccum[1]! * invM;
    out[VX * DIM + VX] = jacAccum[2]! * invM;
    out[VX * DIM + VY] = jacAccum[3]! * invM;
    out[VY * DIM + X] = jacAccum[4]! * invM;
    out[VY * DIM + Y] = jacAccum[5]! * invM;
    out[VY * DIM + VX] = jacAccum[6]! * invM;
    out[VY * DIM + VY] = jacAccum[7]! * invM;
  };

  return {
    dim: DIM,
    channels: PLANAR_CHANNELS,
    rhs,
    ...(allForcesHaveJacobian(registry) ? { jacobian } : {}),
  };
}
