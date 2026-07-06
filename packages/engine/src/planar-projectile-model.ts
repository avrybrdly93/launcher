import type { EvalContext } from "./eval-context.js";
import { mechanicalEnergy } from "./energy.js";
import {
  composeEnergyPower,
  composeForces,
  createForceRegistry,
  type ForceModel,
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

const GRAVITY_FORCE_ID = "gravity";

/** Refreshes ctx.env/vRel/speedRel/re/mach for state y at time t -- shared by rhs and the energy-power invariant. */
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
  // Every non-gravity force is "aero" for eq. (3.19): dE/dt = F_aero . v,
  // since E's potential term m*g*y already accounts for gravity's work.
  const aeroRegistry = registry.filter((force) => force.id !== GRAVITY_FORCE_ID);

  const invariants: readonly InvariantSpec[] = [
    {
      name: "energy",
      evaluate(t: number, y: Float64Array, ctx: EvalContext): number {
        refreshDerived(t, y, ctx);
        return mechanicalEnergy(y, ctx);
      },
    },
    {
      name: "energy-power",
      evaluate(t: number, y: Float64Array, ctx: EvalContext): number {
        refreshDerived(t, y, ctx);
        return composeEnergyPower(aeroRegistry, t, y, ctx);
      },
    },
  ];

  return {
    dim: 4,
    channels: PLANAR_CHANNELS,
    invariants,
    rhs(t: number, y: Float64Array, out: Float64Array, ctx: EvalContext): void {
      refreshDerived(t, y, ctx);
      composeForces(registry, t, y, ctx, ctx.forceAccum);

      out[X] = y[VX]!;
      out[Y] = y[VY]!;
      out[VX] = ctx.forceAccum[0] / ctx.params.mass;
      out[VY] = ctx.forceAccum[1] / ctx.params.mass;
    },
  };
}
