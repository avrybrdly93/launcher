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

/** Below this relative speed, drag's velocity-gradient contribution is taken as its zero limit (§3.8: u*u is C1 but not C2 at v_rel=0). */
const JACOBIAN_SPEED_EPS = 1e-9;

/**
 * Analytic J = df/dy for gravity + quadratic drag only (no Magnus): eq.
 * (3.18) with the Magnus term dropped. Treats rho, Cd, and g as locally
 * frozen w.r.t. y — exact for ConstantCd + a position-independent
 * atmosphere/wind + non-altitude-dependent gravity (the case this is wired
 * up for below); an approximation (missing dCd/dRe and dg/dy terms) if a
 * Reynolds-dependent Cd or altitude-dependent gravity model is substituted.
 */
function planarGravityQuadraticDragJacobian(
  t: number,
  y: Float64Array,
  out: Float64Array,
  ctx: EvalContext,
): void {
  const x = y[X]!;
  const yPos = y[Y]!;
  const vx = y[VX]!;
  const vy = y[VY]!;

  ctx.environment.sample(t, x, yPos, ctx.env);
  const ux = vx - ctx.env.wx;
  const uy = vy - ctx.env.wy;
  const u = Math.hypot(ux, uy);
  const re = (ctx.env.rho * u * (2 * ctx.params.radius)) / ctx.env.eta;
  const mach = ctx.env.c > 0 ? u / ctx.env.c : 0;
  const cd = ctx.params.dragCoefficient.cd(re, mach);
  const kd = (0.5 * ctx.env.rho * cd * ctx.params.area) / ctx.params.mass;

  out.fill(0);
  out[0 * 4 + VX] = 1; // dx'/dvx
  out[1 * 4 + VY] = 1; // dy'/dvy

  if (u > JACOBIAN_SPEED_EPS) {
    const dAxDvx = (-kd * (ux * ux)) / u - kd * u;
    const dAxDvy = (-kd * ux * uy) / u;
    const dAyDvx = dAxDvy;
    const dAyDvy = (-kd * (uy * uy)) / u - kd * u;
    out[VX * 4 + VX] = dAxDvx;
    out[VX * 4 + VY] = dAxDvy;
    out[VY * 4 + VX] = dAyDvx;
    out[VY * 4 + VY] = dAyDvy;
  }
}

/**
 * The workhorse planar projectile model (dim 4, eq. 3.17-3.18): wires
 * gravity/drag/Magnus/buoyancy force composition into a single rhs. This is
 * the first Model SolverKit will integrate — deliberately just a Model, with
 * no special status in the engine (§1.4).
 */
export function createPlanarProjectileModel(forces: readonly ForceModel[]): Model {
  const registry = createForceRegistry(forces);
  const forceIds = new Set(registry.map((f) => f.id));
  const hasAnalyticJacobian =
    forceIds.size === 2 && forceIds.has("gravity") && forceIds.has("drag-quadratic");

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
    ...(hasAnalyticJacobian ? { jacobian: planarGravityQuadraticDragJacobian } : {}),
  };

  return model;
}
