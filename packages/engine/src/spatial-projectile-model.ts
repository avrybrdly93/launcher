import type { EvalContext } from "./eval-context.js";
import { createForceRegistry, type ForceModel } from "./forces.js";
import type { EventSpec, InvariantSpec, Model } from "./model.js";
import { restitutionBounceAction, type RestitutionParams } from "./restitution.js";
import type { ChannelMeta } from "./schema.js";
import { FlatTerrain, type Terrain } from "./terrain.js";

/**
 * State-channel metadata for {@link createSpatialProjectileModel}: [x, y, z,
 * vx, vy, vz]. Axis convention (P4.23, pinned down in `vec3.ts`'s module
 * doc): x = downrange, y = up (opposite gravity), z = lateral/out-of-plane,
 * right-handed with e_x x e_y = e_z -- a direct continuation of the 2D
 * model's implicit ê_z spin axis (`forces.ts`'s `MagnusForce` comment), not
 * a new convention.
 */
export const SPATIAL_CHANNELS: readonly ChannelMeta[] = [
  { name: "x", unit: "m" },
  { name: "y", unit: "m" },
  { name: "z", unit: "m" },
  { name: "vx", unit: "m/s" },
  { name: "vy", unit: "m/s" },
  { name: "vz", unit: "m/s" },
];

const X = 0;
const Y = 1;
const Z = 2;
const VX = 3;
const VY = 4;
const VZ = 5;
const DIM = 6;

/**
 * Force ids this dim-6 "groundwork" model knows how to generalize to 3D
 * directly from their existing 2D closed forms (§3.2-§3.5): gravity and
 * buoyancy act on the y-component only (unchanged from 2D, z untouched);
 * quadratic and linear drag generalize their `u`/`|u|` to the full 3D
 * relative-velocity vector, with lateral wind (`wz`) treated as always 0 --
 * `EnvSample` has no `wz` field yet, that's presumably a later crosswind task
 * (P4.25). Any other force id (in particular "magnus": full 3D Magnus with a
 * general spin-axis parameter is explicitly P4.24, not this task) makes
 * construction throw rather than silently produce wrong physics.
 */
const SUPPORTED_FORCE_IDS = new Set(["gravity", "buoyancy", "drag-quadratic", "drag-linear"]);

/**
 * Force ids whose contribution to df/dy the analytic jacobian below accounts
 * for -- the direct 3D generalization of
 * `planar-projectile-model.ts`'s own `ANALYTIC_JACOBIAN_FORCE_IDS` restriction
 * (no linear drag either, for the same reason: its own jacobian block is easy
 * too, but the 2D model draws the line here and this groundwork model mirrors
 * that line rather than widening it).
 */
const ANALYTIC_JACOBIAN_FORCE_IDS = new Set(["gravity", "buoyancy", "drag-quadratic"]);
const JACOBIAN_SPEED_EPS = 1e-9;

/**
 * 3D mechanical energy E = (1/2)m|v|^2 + mgy, |v|^2 = vx^2+vy^2+vz^2 -- the
 * z-aware generalization of `planar-projectile-model.ts`'s `mechanicalEnergy`.
 * Kept as a separate function (not a mutation of the shared one) since that
 * one is also relied on by the dim-4/dim-5 models and their own tests.
 */
export function spatialMechanicalEnergy(y: Float64Array, ctx: EvalContext): number {
  const vx = y[VX]!;
  const vy = y[VY]!;
  const vz = y[VZ]!;
  return (
    0.5 * ctx.params.mass * (vx * vx + vy * vy + vz * vz) + ctx.params.mass * ctx.env.g * y[Y]!
  );
}

/** Downrange momentum p_x = m*v_x -- conserved only when no x-force acts (mirrors `momentumX`, §3.8). */
export function spatialMomentumX(y: Float64Array, ctx: EvalContext): number {
  return ctx.params.mass * y[VX]!;
}

/** Lateral momentum p_z = m*v_z -- conserved only when no z-force acts (no lateral force is wired by default). */
export function spatialMomentumZ(y: Float64Array, ctx: EvalContext): number {
  return ctx.params.mass * y[VZ]!;
}

/**
 * Analytic df/dy for gravity + quadratic drag in 3D (direct generalization of
 * `planar-projectile-model.ts`'s `planarGravityQuadraticDragJacobian` to a
 * full 3D `u`): with u = v - w (w constant, wz always 0) and Cd frozen at its
 * current (re, mach), only the velocity block is nonzero:
 *   d(v_i')/d(v_j) = -kd*(u_i*u_j + delta_ij*u^2)/u,  kd = rho*Cd*A/(2m)
 * At u=0 the drag force has a genuine kink (as in 2D), so the drag block is
 * left at zero there.
 */
function spatialGravityQuadraticDragJacobian(
  hasQuadraticDrag: boolean,
  t: number,
  y: Float64Array,
  ctx: EvalContext,
  out: Float64Array,
): void {
  out.fill(0);
  out[X * DIM + VX] = 1;
  out[Y * DIM + VY] = 1;
  out[Z * DIM + VZ] = 1;
  if (!hasQuadraticDrag) return;

  ctx.environment.sample(t, y[X]!, y[Y]!, ctx.env);
  const ux = y[VX]! - ctx.env.wx;
  const uy = y[VY]! - ctx.env.wy;
  const uz = y[VZ]!; // no lateral wind (wz) modeled yet
  const u = Math.hypot(ux, uy, uz);
  if (u < JACOBIAN_SPEED_EPS) return;

  const re = (ctx.env.rho * u * (2 * ctx.params.radius)) / ctx.env.eta;
  const mach = ctx.env.c > 0 ? u / ctx.env.c : 0;
  const cd = ctx.params.dragCoefficient.cd(re, mach);
  const kd = (ctx.env.rho * cd * ctx.params.area) / (2 * ctx.params.mass);

  const comps = [ux, uy, uz];
  const idx = [VX, VY, VZ];
  const uu = u * u;
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      const delta = i === j ? 1 : 0;
      out[idx[i]! * DIM + idx[j]!] = (-kd * (comps[i]! * comps[j]! + delta * uu)) / u;
    }
  }
}

function createEnergyInvariant(): InvariantSpec {
  return {
    name: "energy",
    evaluate: (_t: number, y: Float64Array, ctx: EvalContext) => spatialMechanicalEnergy(y, ctx),
  };
}

const MOMENTUM_X_INVARIANT: InvariantSpec = {
  name: "momentum-x",
  evaluate: (_t: number, y: Float64Array, ctx: EvalContext) => spatialMomentumX(y, ctx),
};

const MOMENTUM_Z_INVARIANT: InvariantSpec = {
  name: "momentum-z",
  evaluate: (_t: number, y: Float64Array, ctx: EvalContext) => spatialMomentumZ(y, ctx),
};

/** Apex event: root of v_y, falling direction only -- identical to the 2D model. */
const APEX_EVENT: EventSpec = {
  name: "apex",
  g: (_t: number, y: Float64Array) => y[VY]!,
  direction: "falling",
  terminal: false,
};

/**
 * Ground-impact event: root of g_gnd = y - h(x) (terrain is still a function
 * of x only -- 2D terrain, unaffected by z, per the existing `Terrain`
 * interface). Falling direction, always terminal; when `restitution` is
 * given, its action reflects vx/vy only (via the existing
 * `restitutionBounceAction`, which writes `out.set(y)` first and then
 * overwrites just those two indices) -- vz and z pass through untouched.
 */
function createGroundImpactEvent(terrain: Terrain, restitution?: RestitutionParams): EventSpec {
  return {
    name: "ground-impact",
    g: (_t: number, y: Float64Array) => y[Y]! - terrain.height(y[X]!),
    direction: "falling",
    terminal: true,
    ...(restitution ? { action: restitutionBounceAction(VX, VY, restitution) } : {}),
  };
}

/**
 * Builds the dim-6 spatial (3D) projectile `Model` (P4.23 groundwork):
 * gravity/buoyancy/quadratic-drag/linear-drag generalized directly to 3D
 * (not by calling into `composeForces`/`forces.ts`'s `ForceModel.accumulate`,
 * which are inherently 2D). `forces` is used only to select which physics is
 * active (by id) -- the actual 3D force math lives in this file. Any
 * unsupported force id (in particular "magnus": full 3D Magnus is P4.24)
 * throws at construction time rather than silently integrating wrong
 * physics.
 *
 * With z0=vz0=0 and no lateral wind, this model's rhs reduces exactly to
 * `createPlanarProjectileModel`'s for the shared (x, y, vx, vy) channels --
 * same accumulation order (forces applied in the same id-sorted registry
 * order as `composeForces`), same `speedRel`/`re`/`mach` values (`Math.hypot`
 * with a zero third argument is bit-identical to the 2-argument form) -- so
 * a 2D scenario integrated through both models is bit-for-bit identical on
 * those four channels (verified in spatial-projectile-model.test.ts).
 */
export function createSpatialProjectileModel(
  forces: readonly ForceModel[],
  terrain: Terrain = new FlatTerrain(),
  restitution?: RestitutionParams,
): Model {
  const registry = createForceRegistry(forces);
  for (const f of registry) {
    if (!SUPPORTED_FORCE_IDS.has(f.id)) {
      throw new Error(
        `createSpatialProjectileModel does not support force "${f.id}" yet -- full 3D Magnus ` +
          `(and any other force needing a genuine 3D vector law beyond gravity/buoyancy/drag) ` +
          `is P4.24, not this task's scope.`,
      );
    }
  }
  const hasQuadraticDrag = registry.some((f) => f.id === "drag-quadratic");
  const supportsAnalyticJacobian = registry.every((f) => ANALYTIC_JACOBIAN_FORCE_IDS.has(f.id));

  return {
    dim: DIM,
    channels: SPATIAL_CHANNELS,
    invariants: [createEnergyInvariant(), MOMENTUM_X_INVARIANT, MOMENTUM_Z_INVARIANT],
    events: [createGroundImpactEvent(terrain, restitution), APEX_EVENT],
    partitions: { q: [X, Y, Z], p: [VX, VY, VZ] },
    rhs(t: number, y: Float64Array, out: Float64Array, ctx: EvalContext): void {
      const x = y[X]!;
      const yPos = y[Y]!;
      const vx = y[VX]!;
      const vy = y[VY]!;
      const vz = y[VZ]!;

      // Environment sampling stays 2D-only (no z argument): lateral position
      // doesn't affect atmosphere sampling yet, out of this task's scope.
      ctx.environment.sample(t, x, yPos, ctx.env);

      const ux = vx - ctx.env.wx;
      const uy = vy - ctx.env.wy;
      const uz = vz; // no lateral wind (wz) modeled yet -- always 0
      const speedRel = Math.hypot(ux, uy, uz);
      ctx.speedRel = speedRel;
      ctx.re = (ctx.env.rho * speedRel * (2 * ctx.params.radius)) / ctx.env.eta;
      ctx.mach = ctx.env.c > 0 ? speedRel / ctx.env.c : 0;

      // Accumulated in the same id-sorted order `composeForces` uses, so the
      // x/y channels match `createPlanarProjectileModel`'s rhs bit-for-bit
      // when z/vz/wz are all 0 (registry is already sorted by
      // `createForceRegistry`).
      let fx = 0;
      let fy = 0;
      let fz = 0;
      for (const f of registry) {
        switch (f.id) {
          case "buoyancy":
            fy += ctx.env.rho * ctx.params.volume * ctx.env.g;
            break;
          case "drag-linear": {
            const b = 6 * Math.PI * ctx.env.eta * ctx.params.radius;
            fx += -b * ux;
            fy += -b * uy;
            fz += -b * uz;
            break;
          }
          case "drag-quadratic": {
            const cd = ctx.params.dragCoefficient.cd(ctx.re, ctx.mach);
            const k = 0.5 * ctx.env.rho * cd * ctx.params.area * speedRel;
            fx += -k * ux;
            fy += -k * uy;
            fz += -k * uz;
            break;
          }
          case "gravity":
            fy += -ctx.params.mass * ctx.env.g;
            break;
          default:
            // unreachable: validated against SUPPORTED_FORCE_IDS at construction time
            break;
        }
      }

      out[X] = vx;
      out[Y] = vy;
      out[Z] = vz;
      out[VX] = fx / ctx.params.mass;
      out[VY] = fy / ctx.params.mass;
      out[VZ] = fz / ctx.params.mass;
    },
    ...(supportsAnalyticJacobian
      ? {
          jacobian(t: number, y: Float64Array, ctx: EvalContext, out: Float64Array): void {
            spatialGravityQuadraticDragJacobian(hasQuadraticDrag, t, y, ctx, out);
          },
        }
      : {}),
  };
}
