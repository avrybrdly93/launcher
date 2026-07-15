import type { EvalContext } from "./eval-context.js";
import { mechanicalEnergy } from "./energy.js";
import {
  composeForceJacobian,
  composeForces,
  createForceRegistry,
  forcesSupportJacobian,
  type ForceModel,
  type MutForceJacobian,
} from "./forces.js";
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

/** Refreshes ctx.env/vRel/speedRel/re/mach for (t, y); shared by rhs and jacobian. */
function refreshDerived(t: number, y: Float64Array, ctx: EvalContext): void {
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
}

/**
 * The workhorse planar projectile model (dim 4, eq. 3.17-3.18): wires
 * gravity/drag/Magnus/buoyancy force composition into a single rhs. This is
 * the first Model SolverKit will integrate — deliberately just a Model, with
 * no special status in the engine (§1.4).
 */
export function createPlanarProjectileModel(forces: readonly ForceModel[]): Model {
  const registry = createForceRegistry(forces);
  const hasAnalyticJacobian = forcesSupportJacobian(registry);
  const forceJ: MutForceJacobian = [0, 0, 0, 0, 0, 0, 0, 0];

  const rhs = (t: number, y: Float64Array, out: Float64Array, ctx: EvalContext): void => {
    const vx = y[VX]!;
    const vy = y[VY]!;

    refreshDerived(t, y, ctx);
    composeForces(registry, t, y, ctx, ctx.forceAccum);

    out[X] = vx;
    out[Y] = vy;
    out[VX] = ctx.forceAccum[0] / ctx.params.mass;
    out[VY] = ctx.forceAccum[1] / ctx.params.mass;
  };

  /**
   * Analytic J = ∂f/∂y (P1.22), row-major 4x4. Rows 0-1 are the trivial
   * dr/dt = v identity block; rows 2-3 are the sum of each force's
   * jacobian(), scaled by 1/m. Only present when every registered force
   * supplies one (§P1.23 covers the general FD-fallback case).
   */
  const jacobian = (t: number, y: Float64Array, out: Float64Array, ctx: EvalContext): void => {
    refreshDerived(t, y, ctx);
    composeForceJacobian(registry, t, y, ctx, forceJ);
    const m = ctx.params.mass;

    out[0] = 0;
    out[1] = 0;
    out[2] = 1;
    out[3] = 0;
    out[4] = 0;
    out[5] = 0;
    out[6] = 0;
    out[7] = 1;
    out[8] = forceJ[0] / m;
    out[9] = forceJ[1] / m;
    out[10] = forceJ[2] / m;
    out[11] = forceJ[3] / m;
    out[12] = forceJ[4] / m;
    out[13] = forceJ[5] / m;
    out[14] = forceJ[6] / m;
    out[15] = forceJ[7] / m;
  };

  /** Mechanical energy E = (1/2)m|v|^2 + mgy (P1.24, §3.8/3.19), refreshing ctx.env first. */
  const invariants: readonly InvariantSpec[] = [
    {
      name: "energy",
      evaluate(t: number, y: Float64Array, ctx: EvalContext): number {
        ctx.environment.sample(t, y[X]!, y[Y]!, ctx.env);
        return mechanicalEnergy(y, ctx);
      },
    },
  ];

  return {
    dim: 4,
    channels: PLANAR_CHANNELS,
    rhs,
    invariants,
    ...(hasAnalyticJacobian ? { jacobian } : {}),
  };
}
