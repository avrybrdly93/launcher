import type { EvalContext } from "./eval-context.js";
import { composeForces, createForceRegistry, type ForceModel } from "./forces.js";
import type { EventSpec, InvariantSpec, Model } from "./model.js";
import type { ChannelMeta } from "./schema.js";
import { FlatTerrain, type Terrain } from "./terrain.js";
import { norm } from "./vec2.js";

/** State-channel metadata for {@link createPlanarProjectileModel}: [x, y, vx, vy]. */
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

/**
 * Force ids whose contribution to df/dy the analytic jacobian below accounts
 * for: gravity and buoyancy are position/velocity-independent (zero
 * contribution) under the default state-independent environment (constant
 * atmosphere, non-altitude-dependent gravity, zero/uniform wind), and
 * quadratic drag's contribution is the closed form derived from (3.18). Any
 * other force present (Magnus, linear drag, ...) makes the model's jacobian
 * incomplete, so createPlanarProjectileModel omits it rather than return a
 * silently-wrong matrix; P1.23's finite-difference fallback covers those.
 */
const ANALYTIC_JACOBIAN_FORCE_IDS = new Set(["gravity", "buoyancy", "drag-quadratic"]);
const JACOBIAN_SPEED_EPS = 1e-9;

/**
 * Mechanical energy E = (1/2)m|v|^2 + mgy (§3.8). Reads ctx.env.g, which is
 * only meaningful once the environment has been sampled at this (t, x, y) —
 * true immediately after rhs() runs for this state, which is how invariant
 * evaluation is used in practice (re-evaluated against the state ctx was
 * just computed for).
 */
export function mechanicalEnergy(y: Float64Array, ctx: EvalContext): number {
  const vx = y[VX]!;
  const vy = y[VY]!;
  return 0.5 * ctx.params.mass * (vx * vx + vy * vy) + ctx.params.mass * ctx.env.g * y[Y]!;
}

/**
 * Horizontal momentum p_x = m*v_x -- a teaching-case invariant (§3.8): it is
 * conserved only when no horizontal force acts (no drag, no wind, no
 * Magnus), which most wired force sets violate. Declared unconditionally so
 * a caller can see it break as soon as a horizontal force is added, rather
 * than only appearing once forces happen to be horizontal-free.
 */
export function momentumX(y: Float64Array, ctx: EvalContext): number {
  return ctx.params.mass * y[VX]!;
}

/**
 * Analytic df/dy for gravity + quadratic drag (eq. 3.18, no Magnus): with
 * u = v - w treated locally state-independent (w constant in x, y, t) and Cd
 * treated as state-independent (exact for ConstantCd; a frozen-coefficient
 * approximation otherwise), only the velocity block is nonzero:
 *   d(vx')/dvx = -kd*(ux^2+u^2)/u,  d(vx')/dvy = -kd*ux*uy/u
 *   d(vy')/dvx = -kd*ux*uy/u,       d(vy')/dvy = -kd*(uy^2+u^2)/u
 * where kd = rho*Cd*A/(2m). At u=0 the drag force has a genuine kink (P1.09
 * guards the value, not the slope), so the drag block is left at zero there.
 */
function planarGravityQuadraticDragJacobian(
  hasQuadraticDrag: boolean,
  t: number,
  y: Float64Array,
  ctx: EvalContext,
  out: Float64Array,
): void {
  out.fill(0);
  out[X * DIM + VX] = 1;
  out[Y * DIM + VY] = 1;
  if (!hasQuadraticDrag) return;

  ctx.environment.sample(t, y[X]!, y[Y]!, ctx.env);
  const ux = y[VX]! - ctx.env.wx;
  const uy = y[VY]! - ctx.env.wy;
  const u = Math.hypot(ux, uy);
  if (u < JACOBIAN_SPEED_EPS) return;

  const re = (ctx.env.rho * u * (2 * ctx.params.radius)) / ctx.env.eta;
  const mach = ctx.env.c > 0 ? u / ctx.env.c : 0;
  const cd = ctx.params.dragCoefficient.cd(re, mach);
  const kd = (ctx.env.rho * cd * ctx.params.area) / (2 * ctx.params.mass);

  out[VX * DIM + VX] = (-kd * (ux * ux + u * u)) / u;
  out[VX * DIM + VY] = (-kd * ux * uy) / u;
  out[VY * DIM + VX] = (-kd * ux * uy) / u;
  out[VY * DIM + VY] = (-kd * (uy * uy + u * u)) / u;
}

/**
 * The workhorse planar projectile model (dim 4, eq. 3.17-3.18): wires
 * gravity/drag/Magnus/buoyancy force composition into a single rhs. This is
 * the first Model SolverKit will integrate — deliberately just a Model, with
 * no special status in the engine (§1.4).
 */
const ENERGY_INVARIANT: InvariantSpec = {
  name: "energy",
  evaluate: (_t: number, y: Float64Array, ctx: EvalContext) => mechanicalEnergy(y, ctx),
};

const MOMENTUM_X_INVARIANT: InvariantSpec = {
  name: "momentum-x",
  evaluate: (_t: number, y: Float64Array, ctx: EvalContext) => momentumX(y, ctx),
};

/**
 * Apex event: root of v_y, falling direction only (ascending v_y=0 at launch
 * from the ground doesn't count as an apex). Non-terminal -- the trajectory
 * keeps integrating past it (§3.9 "Well-posedness of events").
 */
const APEX_EVENT: EventSpec = {
  name: "apex",
  g: (_t: number, y: Float64Array) => y[VY]!,
  direction: "falling",
  terminal: false,
};

/**
 * Ground-impact event: root of g_gnd = y - h(x) (§3.9), falling direction
 * (the projectile descending onto terrain, not departing from it).
 * Terminal -- integration stops once the projectile hits the ground.
 */
function createGroundImpactEvent(terrain: Terrain): EventSpec {
  return {
    name: "ground-impact",
    g: (_t: number, y: Float64Array) => y[Y]! - terrain.height(y[X]!),
    direction: "falling",
    terminal: true,
  };
}

/**
 * Builds the planar (2D) projectile `Model` from a set of forces and an
 * optional terrain. Declares the energy and momentum-x invariants and the
 * apex/ground-impact events unconditionally, and attaches an analytic
 * jacobian only when every wired force is one the closed-form jacobian
 * accounts for exactly (gravity, buoyancy, quadratic drag). Declares
 * `partitions: { q: [x, y], p: [vx, vy] }` (paired by index: dq_0/dt is
 * exactly the p_0 channel's value, and likewise for the second pair) for
 * P2.15's semi-implicit Euler and later Verlet-family steppers.
 */
export function createPlanarProjectileModel(
  forces: readonly ForceModel[],
  terrain: Terrain = new FlatTerrain(),
): Model {
  const registry = createForceRegistry(forces);
  const supportsAnalyticJacobian = registry.every((f) => ANALYTIC_JACOBIAN_FORCE_IDS.has(f.id));
  const hasQuadraticDrag = registry.some((f) => f.id === "drag-quadratic");

  return {
    dim: DIM,
    channels: PLANAR_CHANNELS,
    invariants: [ENERGY_INVARIANT, MOMENTUM_X_INVARIANT],
    events: [createGroundImpactEvent(terrain), APEX_EVENT],
    partitions: { q: [X, Y], p: [VX, VY] },
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
    ...(supportsAnalyticJacobian
      ? {
          jacobian(t: number, y: Float64Array, ctx: EvalContext, out: Float64Array): void {
            planarGravityQuadraticDragJacobian(hasQuadraticDrag, t, y, ctx, out);
          },
        }
      : {}),
  };
}
