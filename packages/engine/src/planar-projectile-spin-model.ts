import type { EvalContext } from "./eval-context.js";
import {
  composeForces,
  createForceRegistry,
  magnusForceAt,
  magnusPowerAt,
  totalForcePower,
  type ForceModel,
} from "./forces.js";
import type { EventSpec, InvariantSpec, Model } from "./model.js";
import { mechanicalEnergy, momentumX, PLANAR_CHANNELS } from "./planar-projectile-model.js";
import type { ChannelMeta } from "./schema.js";
import { FlatTerrain, type Terrain } from "./terrain.js";
import { norm } from "./vec2.js";

/** State-channel metadata for {@link createPlanarProjectileSpinModel}: [x, y, vx, vy, omega]. */
export const PLANAR_SPIN_CHANNELS: readonly ChannelMeta[] = [
  ...PLANAR_CHANNELS,
  { name: "omega", unit: "rad/s" },
];

const X = 0;
const Y = 1;
const VX = 2;
const VY = 3;
const OMEGA = 4;
const DIM = 5;

const MOMENTUM_X_INVARIANT: InvariantSpec = {
  name: "momentum-x",
  evaluate: (_t: number, y: Float64Array, ctx: EvalContext) => momentumX(y, ctx),
};

/** Builds the energy invariant, mirroring {@link createPlanarProjectileModel}'s (magnus power included via `magnusPowerAt` rather than the registry, see below). */
function createEnergyInvariant(
  nonMagnusRegistry: readonly ForceModel[],
  includesMagnus: boolean,
): InvariantSpec {
  return {
    name: "energy",
    evaluate: (_t: number, y: Float64Array, ctx: EvalContext) => mechanicalEnergy(y, ctx),
    power: (t: number, y: Float64Array, ctx: EvalContext) => {
      const aeroPower = totalForcePower(nonMagnusRegistry, t, y, ctx);
      const magnusPower = includesMagnus ? magnusPowerAt(y[OMEGA], y, ctx) : 0;
      return aeroPower + magnusPower + ctx.params.mass * ctx.env.g * y[VY]!;
    },
  };
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

/**
 * The dim-5 spin-decay planar projectile `Model` (§3.6, §5.5 worked example
 * 2, task P4.07): extends {@link createPlanarProjectileModel}'s [x, y, vx,
 * vy] with a fifth state channel omega (spin, rad/s) obeying exponential
 * decay omega' = -omega/tauOmega. Unlike the dim-4 model (constant
 * `params.spin`), the Magnus force here reads the *live* omega state each
 * step via {@link magnusForceAt}/{@link magnusPowerAt} — the shared,
 * omega-explicit math both models are built on — so `forces` should *not*
 * include a `MagnusForce` instance; pass `"magnus"` implicitly by supplying
 * a projectile with a `liftCoefficient` and a nonzero initial omega, and the
 * model wires the Magnus contribution itself. Demonstrates the platform's
 * extensibility claim: no edits to `forces.ts`'s public API, steppers,
 * Viz, or the trajectory renderer are needed to add a new model dimension
 * (steppers are dimension-agnostic; unknown channels are ignored/plotted
 * automatically).
 */
export function createPlanarProjectileSpinModel(
  forces: readonly ForceModel[],
  tauOmega: number,
  terrain: Terrain = new FlatTerrain(),
): Model {
  if (!(tauOmega > 0)) throw new Error(`tauOmega must be positive, got ${tauOmega}`);

  const registry = createForceRegistry(forces);
  const includesMagnus = registry.some((f) => f.id === "magnus");
  const nonMagnusRegistry = registry.filter((f) => f.id !== "magnus");

  return {
    dim: DIM,
    channels: PLANAR_SPIN_CHANNELS,
    invariants: [createEnergyInvariant(nonMagnusRegistry, includesMagnus), MOMENTUM_X_INVARIANT],
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

      composeForces(nonMagnusRegistry, t, y, ctx, ctx.forceAccum);
      if (includesMagnus) magnusForceAt(omega, ctx, ctx.forceAccum);

      out[X] = vx;
      out[Y] = vy;
      out[VX] = ctx.forceAccum[0] / ctx.params.mass;
      out[VY] = ctx.forceAccum[1] / ctx.params.mass;
      out[OMEGA] = -omega / tauOmega;
    },
  };
}
