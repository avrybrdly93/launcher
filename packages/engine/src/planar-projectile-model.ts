import type { EvalContext } from "./eval-context.js";
import {
  composeEnergyPower,
  composeForces,
  createForceRegistry,
  type ForceModel,
} from "./forces.js";
import { gravityQuadraticDragJacobian } from "./jacobian.js";
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
/** Force ids for which {@link gravityQuadraticDragJacobian}'s analytic formula is exact (P1.22). */
const ANALYTIC_JACOBIAN_FORCE_IDS = new Set(["gravity", "drag-quadratic"]);

function hasExactForceSet(forces: readonly ForceModel[], ids: ReadonlySet<string>): boolean {
  return forces.length === ids.size && forces.every((force) => ids.has(force.id));
}

/** Mechanical energy E = ½m|v|² + mgy (§3.8), self-contained (samples gravity fresh for any t,y). */
const energyInvariant: InvariantSpec = {
  name: "energy",
  evaluate(t: number, y: Float64Array, ctx: EvalContext): number {
    const x = y[X]!;
    const yPos = y[Y]!;
    const vx = y[VX]!;
    const vy = y[VY]!;
    ctx.environment.sample(t, x, yPos, ctx.env);
    return 0.5 * ctx.params.mass * (vx * vx + vy * vy) + ctx.params.mass * ctx.env.g * yPos;
  },
};

/**
 * dE/dt for {@link energyInvariant}, computed from per-force powers rather
 * than by differentiating a trajectory (eq. 3.19). Since d(KE)/dt equals the
 * sum of every force's power (F_total = sum F_i, so F_total.v = sum(F_i.v))
 * and d(PE)/dt = mg.vy exactly cancels gravity's own power (F_g.v = -mg.vy),
 * this reduces to the aero-only F_aero.v of (3.19) whenever a GravityForce is
 * present in `forces` — e.g. with drag/Magnus/buoyancy all off, it is
 * identically 0. Requires `ctx` freshly refreshed by a preceding
 * `model.rhs(t, y, ..., ctx)` call at the same (t, y), same as
 * {@link composeEnergyPower}.
 */
export function energyRateFromPowers(
  forces: readonly ForceModel[],
  t: number,
  y: Float64Array,
  ctx: EvalContext,
): number {
  const totalPower = composeEnergyPower(forces, t, y, ctx);
  return totalPower + ctx.params.mass * ctx.env.g * y[VY]!;
}

export function createPlanarProjectileModel(forces: readonly ForceModel[]): Model {
  const registry = createForceRegistry(forces);

  const rhs = (t: number, y: Float64Array, out: Float64Array, ctx: EvalContext): void => {
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
  };

  // Only gravity+quadratic-drag has a known-exact analytic Jacobian so far
  // (P1.22); any other force combination (Magnus, linear drag, buoyancy)
  // leaves `jacobian` undefined until a generic FD fallback exists (P1.23).
  if (hasExactForceSet(forces, ANALYTIC_JACOBIAN_FORCE_IDS)) {
    return {
      dim: 4,
      channels: PLANAR_CHANNELS,
      rhs,
      jacobian: gravityQuadraticDragJacobian,
      invariants: [energyInvariant],
    };
  }
  return { dim: 4, channels: PLANAR_CHANNELS, rhs, invariants: [energyInvariant] };
}
