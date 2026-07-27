import { spinParameter } from "./characteristic-scales.js";
import type { EvalContext } from "./eval-context.js";
import { composeForces, createForceRegistry, totalForcePower, type ForceModel } from "./forces.js";
import type { EventSpec, InvariantSpec, Model } from "./model.js";
import { mechanicalEnergy, momentumX } from "./planar-projectile-model.js";
import type { ChannelMeta } from "./schema.js";
import { FlatTerrain, type Terrain } from "./terrain.js";
import type { MutVec2 } from "./vec2.js";
import { norm } from "./vec2.js";

/** State-channel metadata for {@link createPlanarProjectileSpinModel}: [x, y, vx, vy, omega]. */
export const PLANAR_SPIN_CHANNELS: readonly ChannelMeta[] = [
  { name: "x", unit: "m" },
  { name: "y", unit: "m" },
  { name: "vx", unit: "m/s" },
  { name: "vy", unit: "m/s" },
  { name: "omega", unit: "rad/s" },
];

const X = 0;
const Y = 1;
const VX = 2;
const VY = 3;
const OMEGA = 4;
const DIM = 5;

/**
 * Magnus force reading spin from the model's own state (`y[OMEGA]`) instead
 * of the constant `ProjectileParams.spin` that {@link MagnusForce} (in
 * forces.ts) reads (§3.6's spin-decay extension, P4.07). Deliberately a new,
 * additive `ForceModel` rather than a modification of `MagnusForce` itself,
 * so the dim-4 workhorse model and its constant-spin golf-drive preset are
 * completely untouched by adding this dim-5 variant -- the exact
 * "extensibility" property this task's validation criterion checks for.
 */
export class StatefulSpinMagnusForce implements ForceModel {
  readonly id = "magnus-spin-state";

  /** @inheritDoc */
  accumulate(_t: number, y: Float64Array, ctx: EvalContext, outForce: MutVec2): void {
    const omega = y[OMEGA]!;
    const liftModel = ctx.params.liftCoefficient;
    if (!omega || !liftModel) return;

    const spinRatio = spinParameter(omega, ctx.params.radius, ctx.speedRel);
    const cl = liftModel.cl(spinRatio);
    const k = 0.5 * ctx.env.rho * cl * ctx.params.area * ctx.speedRel * Math.sign(omega);
    // ê_z x v_rel = (-v_rel_y, v_rel_x)
    outForce[0] += -k * ctx.vRel[1];
    outForce[1] += k * ctx.vRel[0];
  }

  /** @inheritDoc */
  energyPower(_t: number, y: Float64Array, ctx: EvalContext): number {
    const omega = y[OMEGA]!;
    const liftModel = ctx.params.liftCoefficient;
    if (!omega || !liftModel) return 0;

    const spinRatio = spinParameter(omega, ctx.params.radius, ctx.speedRel);
    const cl = liftModel.cl(spinRatio);
    const k = 0.5 * ctx.env.rho * cl * ctx.params.area * ctx.speedRel * Math.sign(omega);
    const fx = -k * ctx.vRel[1];
    const fy = k * ctx.vRel[0];
    return fx * y[VX]! + fy * y[VY]!;
  }
}

const APEX_EVENT: EventSpec = {
  name: "apex",
  g: (_t: number, y: Float64Array) => y[VY]!,
  direction: "falling",
  terminal: false,
};

function createGroundImpactEvent(terrain: Terrain): EventSpec {
  return {
    name: "ground-impact",
    g: (_t: number, y: Float64Array) => y[Y]! - terrain.height(y[X]!),
    direction: "falling",
    terminal: true,
  };
}

function createEnergyInvariant(registry: readonly ForceModel[]): InvariantSpec {
  return {
    name: "energy",
    evaluate: (_t: number, y: Float64Array, ctx: EvalContext) => mechanicalEnergy(y, ctx),
    power: (t: number, y: Float64Array, ctx: EvalContext) =>
      totalForcePower(registry, t, y, ctx) + ctx.params.mass * ctx.env.g * y[VY]!,
  };
}

const MOMENTUM_X_INVARIANT: InvariantSpec = {
  name: "momentum-x",
  evaluate: (_t: number, y: Float64Array, ctx: EvalContext) => momentumX(y, ctx),
};

/**
 * Dim-5 planar projectile model with a decaying spin state (§3.6, §3.7,
 * P4.07): omega_dot = -omega/tauOmega alongside the standard x,y,vx,vy rhs
 * of {@link createPlanarProjectileModel}. This is the first model whose
 * state dimension differs from the dim-4 workhorse, and it is built
 * entirely from unmodified, already-exported engine pieces (`ForceModel`,
 * `composeForces`, `EventSpec`/`InvariantSpec`, `mechanicalEnergy`/
 * `momentumX`) plus one new additive force ({@link StatefulSpinMagnusForce})
 * -- demonstrating §3.7's variable-dimension design needs zero edits to the
 * engine's shared evaluation machinery (`Model`, `EvalContext`, the force
 * composition helpers) to add a model of a different dimension; a caller
 * only needs to register the new factory and, if it wants Magnus lift, wire
 * in `StatefulSpinMagnusForce` rather than the dim-4 `MagnusForce`.
 *
 * `partitions` excludes `omega`: it's a first-order decaying scalar, not a
 * (position, velocity) mechanical pair, so it falls outside the q/p
 * structure symplectic/Verlet steppers require (P4.10 documents how those
 * steppers are expected to integrate it: a companion first-order update
 * alongside the partitioned leapfrog).
 */
export function createPlanarProjectileSpinModel(
  forces: readonly ForceModel[],
  tauOmega: number,
  terrain: Terrain = new FlatTerrain(),
): Model {
  const registry = createForceRegistry(forces);

  return {
    dim: DIM,
    channels: PLANAR_SPIN_CHANNELS,
    invariants: [createEnergyInvariant(registry), MOMENTUM_X_INVARIANT],
    events: [createGroundImpactEvent(terrain), APEX_EVENT],
    partitions: { q: [X, Y], p: [VX, VY] },
    rhs(t: number, y: Float64Array, out: Float64Array, ctx: EvalContext): void {
      const x = y[X]!;
      const yPos = y[Y]!;
      const vx = y[VX]!;
      const vy = y[VY]!;
      const omega = y[OMEGA]!;

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
      out[OMEGA] = -omega / tauOmega;
    },
  };
}
