import type { EvalContext } from "./eval-context.js";
import {
  composeForces,
  composeJacobianV,
  createForceRegistry,
  hasAnalyticJacobianV,
  type ForceModel,
} from "./forces.js";
import type { InvariantSpec, Model } from "./model.js";
import type { ChannelMeta } from "./schema.js";
import { norm, type MutMat2 } from "./vec2.js";

/** id of GravityForce (forces.ts) — see `nonGravityPower` for why it's singled out. */
const GRAVITY_FORCE_ID = "gravity";

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

/** Refreshes ctx.env/vRel/speedRel/re/mach at (t, y) — shared by rhs and jacobian. */
function refreshDerived(t: number, y: Float64Array, ctx: EvalContext): void {
  ctx.environment.sample(t, y[X]!, y[Y]!, ctx.env);
  ctx.vRel[0] = y[VX]! - ctx.env.wx;
  ctx.vRel[1] = y[VY]! - ctx.env.wy;
  ctx.speedRel = norm(ctx.vRel);
  ctx.re = (ctx.env.rho * ctx.speedRel * (2 * ctx.params.radius)) / ctx.env.eta;
  ctx.mach = ctx.env.c > 0 ? ctx.speedRel / ctx.env.c : 0;
}

/** Mechanical energy E = 0.5*m*|v|^2 + m*g*y (eq. 3.19); PE term only accounts for gravity. */
export function mechanicalEnergy(t: number, y: Float64Array, ctx: EvalContext): number {
  refreshDerived(t, y, ctx);
  const vx = y[VX]!;
  const vy = y[VY]!;
  return 0.5 * ctx.params.mass * (vx * vx + vy * vy) + ctx.params.mass * ctx.env.g * y[Y]!;
}

/**
 * Sum of `energyPower` over every registered force *except* gravity (eq.
 * 3.19). Gravity's own power (-m*g*vy) is already accounted for by E's m*g*y
 * potential term — its contributions to dKE/dt and dPE/dt cancel exactly
 * along any trajectory — so this is the quantity dE/dt is actually predicted
 * to equal: with all aero/buoyancy forces off, it's identically zero even
 * under gravity alone (P1.24 validation), and with drag on in still air it's
 * the (non-positive) dissipation rate.
 */
export function nonGravityPower(
  forces: readonly ForceModel[],
  t: number,
  y: Float64Array,
  ctx: EvalContext,
): number {
  refreshDerived(t, y, ctx);
  let power = 0;
  for (const force of forces) {
    if (force.id === GRAVITY_FORCE_ID || !force.energyPower) continue;
    power += force.energyPower(t, y, ctx);
  }
  return power;
}

/**
 * The workhorse planar projectile model (dim 4, eq. 3.17-3.18): wires
 * gravity/drag/Magnus/buoyancy force composition into a single rhs. This is
 * the first Model SolverKit will integrate — deliberately just a Model, with
 * no special status in the engine (§1.4).
 */
export function createPlanarProjectileModel(forces: readonly ForceModel[]): Model {
  const registry = createForceRegistry(forces);

  const energyInvariant: InvariantSpec = {
    name: "energy",
    evaluate(t, y, ctx) {
      return mechanicalEnergy(t, y, ctx);
    },
  };

  const model: Model = {
    dim: 4,
    channels: PLANAR_CHANNELS,
    invariants: [energyInvariant],
    rhs(t: number, y: Float64Array, out: Float64Array, ctx: EvalContext): void {
      refreshDerived(t, y, ctx);
      composeForces(registry, t, y, ctx, ctx.forceAccum);

      out[X] = y[VX]!;
      out[Y] = y[VY]!;
      out[VX] = ctx.forceAccum[0] / ctx.params.mass;
      out[VY] = ctx.forceAccum[1] / ctx.params.mass;
    },
  };

  // Analytic jacobian (P1.22) is only attachable when every registered force
  // can provide one exactly; otherwise callers fall back to FD (P1.23).
  if (hasAnalyticJacobianV(registry)) {
    const jvv: MutMat2 = [0, 0, 0, 0];
    model.jacobian = (t: number, y: Float64Array, out: Float64Array, ctx: EvalContext): void => {
      refreshDerived(t, y, ctx);
      composeJacobianV(registry, t, y, ctx, jvv);

      const m = ctx.params.mass;
      out.fill(0);
      out[X * 4 + VX] = 1; // d(dx/dt)/dvx
      out[Y * 4 + VY] = 1; // d(dy/dt)/dvy
      out[VX * 4 + VX] = jvv[0] / m;
      out[VX * 4 + VY] = jvv[1] / m;
      out[VY * 4 + VX] = jvv[2] / m;
      out[VY * 4 + VY] = jvv[3] / m;
    };
  }

  return model;
}
