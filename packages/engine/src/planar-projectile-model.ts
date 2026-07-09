import type { EvalContext } from "./eval-context.js";
import { composeForces, createForceRegistry, type ForceModel } from "./forces.js";
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
 * Force-id set for which {@link gravityQuadraticDragJacobian} is exact
 * (pre-sorted to match `createForceRegistry`'s deterministic ordering).
 */
const ANALYTIC_JACOBIAN_FORCE_IDS = ["drag-quadratic", "gravity"] as const;

function matchesForceIds(registry: readonly ForceModel[], ids: readonly string[]): boolean {
  return registry.length === ids.length && registry.every((f, i) => f.id === ids[i]);
}

/**
 * Analytic Jacobian $\partial f/\partial y$ (row-major, `out[4i+j]` =
 * $\partial f_i/\partial y_j$) for the gravity + quadratic-drag composition,
 * eq. (3.18) with the Magnus terms dropped. `rho`, wind, and `Cd` are
 * sampled once at the input state and then held frozen — not
 * re-differentiated w.r.t. position, nor through `Cd(Re)` — which is exact
 * for the platform-default `ConstantCd` and gravity model (uniform, not
 * altitude-dependent); it is the same practical freezing used for
 * Newton-iteration Jacobians elsewhere in the platform (P2.38). At
 * $\lVert v_{rel}\rVert = 0$ the removable $1/u$ singularity is resolved to
 * its limit, zero, consistent with the $u\mathbf u$ term being $C^1$ but not
 * $C^2$ there (§3.8).
 */
export function gravityQuadraticDragJacobian(
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
  const kd = (ctx.env.rho * cd * ctx.params.area) / (2 * ctx.params.mass);

  out.fill(0);
  out[2] = 1; // d(dx/dt)/d(vx)
  out[7] = 1; // d(dy/dt)/d(vy)

  if (u > 0) {
    out[10] = -kd * ((ux * ux) / u + u); // d(dvx/dt)/d(vx)
    out[11] = -kd * ((ux * uy) / u); // d(dvx/dt)/d(vy)
    out[14] = -kd * ((ux * uy) / u); // d(dvy/dt)/d(vx)
    out[15] = -kd * ((uy * uy) / u + u); // d(dvy/dt)/d(vy)
  }
}

/**
 * Mechanical energy $E = \tfrac12 m\lVert v\rVert^2 + mgy$ (eq. 3.19,
 * preceding paragraph). Gravity's work is exactly the $mgy$ term here, which
 * is why {@link aeroEnergyPower} in forces.ts excludes gravity when summing
 * $dE/dt$ — including it would double-count it.
 */
function mechanicalEnergy(y: Float64Array, ctx: EvalContext): number {
  const vx = y[VX]!;
  const vy = y[VY]!;
  return 0.5 * ctx.params.mass * (vx * vx + vy * vy) + ctx.params.mass * ctx.env.g * y[Y]!;
}

/** The model's energy invariant (eq. 3.19): $E(t,y)$, tracked as a diagnostic by the Recorder (§3.8). */
const ENERGY_INVARIANT: InvariantSpec = {
  name: "energy",
  evaluate(t: number, y: Float64Array, ctx: EvalContext): number {
    ctx.environment.sample(t, y[X]!, y[Y]!, ctx.env);
    return mechanicalEnergy(y, ctx);
  },
};

/**
 * The workhorse planar projectile model (dim 4, eq. 3.17-3.18): wires
 * gravity/drag/Magnus/buoyancy force composition into a single rhs. This is
 * the first Model SolverKit will integrate — deliberately just a Model, with
 * no special status in the engine (§1.4).
 *
 * `jacobian` is attached only when `forces` is exactly gravity +
 * quadratic-drag, the composition {@link gravityQuadraticDragJacobian} is
 * analytically exact for; other compositions leave it undefined for a
 * finite-difference fallback (P1.23) to handle.
 */
export function createPlanarProjectileModel(forces: readonly ForceModel[]): Model {
  const registry = createForceRegistry(forces);

  return {
    dim: 4,
    channels: PLANAR_CHANNELS,
    invariants: [ENERGY_INVARIANT],
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
    ...(matchesForceIds(registry, ANALYTIC_JACOBIAN_FORCE_IDS)
      ? { jacobian: gravityQuadraticDragJacobian }
      : {}),
  };
}
