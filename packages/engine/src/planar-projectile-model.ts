import type { EvalContext } from "./eval-context.js";
import {
  composeForces,
  composeJacobian,
  createForceRegistry,
  jacobianAvailable,
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

/** Refreshes ctx.env/vRel/speedRel/re/mach for state `y` at time `t` — shared by rhs and jacobian. */
function refreshDerived(t: number, y: Float64Array, ctx: EvalContext): void {
  ctx.environment.sample(t, y[X]!, y[Y]!, ctx.env);
  ctx.vRel[0] = y[VX]! - ctx.env.wx;
  ctx.vRel[1] = y[VY]! - ctx.env.wy;
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
  // Preallocated scratch for the force-level ∂F/∂y block (P1.22); reused
  // across calls to keep `jacobian` allocation-free like `rhs`.
  const forceJ = new Float64Array(8);

  const model: Model = {
    dim: DIM,
    channels: PLANAR_CHANNELS,
    rhs(t: number, y: Float64Array, out: Float64Array, ctx: EvalContext): void {
      const vx = y[VX]!;
      const vy = y[VY]!;

      refreshDerived(t, y, ctx);

      composeForces(registry, t, y, ctx, ctx.forceAccum);

      out[X] = vx;
      out[Y] = vy;
      out[VX] = ctx.forceAccum[0] / ctx.params.mass;
      out[VY] = ctx.forceAccum[1] / ctx.params.mass;
    },
  };

  if (jacobianAvailable(registry)) {
    model.jacobian = (t: number, y: Float64Array, out: Float64Array, ctx: EvalContext): void => {
      refreshDerived(t, y, ctx);
      composeJacobian(registry, t, y, ctx, forceJ);

      out.fill(0);
      // rows d(x)/dt, d(y)/dt = vx, vy: state-independent identity shift.
      out[0 * DIM + VX] = 1;
      out[1 * DIM + VY] = 1;
      // rows d(vx)/dt, d(vy)/dt = F/m: force jacobian scaled by 1/mass.
      const invM = 1 / ctx.params.mass;
      out[2 * DIM + 0] = forceJ[0]! * invM;
      out[2 * DIM + 1] = forceJ[1]! * invM;
      out[2 * DIM + 2] = forceJ[2]! * invM;
      out[2 * DIM + 3] = forceJ[3]! * invM;
      out[3 * DIM + 0] = forceJ[4]! * invM;
      out[3 * DIM + 1] = forceJ[5]! * invM;
      out[3 * DIM + 2] = forceJ[6]! * invM;
      out[3 * DIM + 3] = forceJ[7]! * invM;
    };
  }

  return model;
}
