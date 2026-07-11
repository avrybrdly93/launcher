import type { EvalContext } from "./eval-context.js";
import { composeForces, createForceRegistry, type ForceModel } from "./forces.js";
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

/** Scratch size for a force's ∂F/∂y contribution: 2 rows (Fx,Fy) x 4 cols (x,y,vx,vy). */
const FORCE_JACOBIAN_SIZE = 8;

/**
 * Refreshes ctx.env/vRel/speedRel/re/mach for state `y` at time `t`. Shared
 * by rhs and the analytic Jacobian so the latter is correct even when called
 * standalone (e.g. from a Newton solver, P2.38) at a `y` that didn't just
 * come through rhs — using stale ctx fields would silently misdifferentiate.
 */
function refreshDerivedQuantities(t: number, y: Float64Array, ctx: EvalContext): void {
  ctx.environment.sample(t, y[X]!, y[Y]!, ctx.env);
  ctx.vRel[0] = y[VX]! - ctx.env.wx;
  ctx.vRel[1] = y[VY]! - ctx.env.wy;
  ctx.speedRel = norm(ctx.vRel);
  ctx.re = (ctx.env.rho * ctx.speedRel * (2 * ctx.params.radius)) / ctx.env.eta;
  ctx.mach = ctx.env.c > 0 ? ctx.speedRel / ctx.env.c : 0;
}

/**
 * Composes the model-level analytic Jacobian (row-major 4x4) from each
 * force's ∂F/∂y, when every registered force provides one (P1.22). Returns
 * undefined otherwise, signaling callers to fall back to finite differences
 * (P1.23) — e.g. MagnusForce has no `jacobian`, so a model that includes it
 * has no analytic Jacobian.
 */
function tryComposeAnalyticJacobian(
  registry: readonly ForceModel[],
): ((t: number, y: Float64Array, out: Float64Array, ctx: EvalContext) => void) | undefined {
  if (registry.length === 0 || !registry.every((f) => typeof f.jacobian === "function")) {
    return undefined;
  }
  const forceJ = new Float64Array(FORCE_JACOBIAN_SIZE);

  return (t: number, y: Float64Array, out: Float64Array, ctx: EvalContext): void => {
    refreshDerivedQuantities(t, y, ctx);
    forceJ.fill(0);
    for (const force of registry) force.jacobian!(t, y, ctx, forceJ);

    const invM = 1 / ctx.params.mass;
    // d(vx)/dy, d(vy)/dy: kinematic rows, independent of forces.
    out[0] = 0;
    out[1] = 0;
    out[2] = 1;
    out[3] = 0;
    out[4] = 0;
    out[5] = 0;
    out[6] = 0;
    out[7] = 1;
    // d(Fx/m)/dy, d(Fy/m)/dy.
    out[8] = forceJ[0]! * invM;
    out[9] = forceJ[1]! * invM;
    out[10] = forceJ[2]! * invM;
    out[11] = forceJ[3]! * invM;
    out[12] = forceJ[4]! * invM;
    out[13] = forceJ[5]! * invM;
    out[14] = forceJ[6]! * invM;
    out[15] = forceJ[7]! * invM;
  };
}

/**
 * The workhorse planar projectile model (dim 4, eq. 3.17-3.18): wires
 * gravity/drag/Magnus/buoyancy force composition into a single rhs. This is
 * the first Model SolverKit will integrate — deliberately just a Model, with
 * no special status in the engine (§1.4).
 */
export function createPlanarProjectileModel(forces: readonly ForceModel[]): Model {
  const registry = createForceRegistry(forces);
  const analyticJacobian = tryComposeAnalyticJacobian(registry);

  return {
    dim: 4,
    channels: PLANAR_CHANNELS,
    rhs(t: number, y: Float64Array, out: Float64Array, ctx: EvalContext): void {
      const vx = y[VX]!;
      const vy = y[VY]!;

      refreshDerivedQuantities(t, y, ctx);
      composeForces(registry, t, y, ctx, ctx.forceAccum);

      out[X] = vx;
      out[Y] = vy;
      out[VX] = ctx.forceAccum[0] / ctx.params.mass;
      out[VY] = ctx.forceAccum[1] / ctx.params.mass;
    },
    ...(analyticJacobian ? { jacobian: analyticJacobian } : {}),
  };
}
