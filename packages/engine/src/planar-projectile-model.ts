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

const DIM = 4;
const X = 0;
const Y = 1;
const VX = 2;
const VY = 3;

/** Refreshes ctx's relative-velocity/Re/Mach scratch fields at (t, x, y); shared by rhs and jacobian so they can never disagree on the underlying flow state. */
function refreshFlowState(
  t: number,
  x: number,
  yPos: number,
  vx: number,
  vy: number,
  ctx: EvalContext,
): void {
  ctx.environment.sample(t, x, yPos, ctx.env);
  ctx.vRel[0] = vx - ctx.env.wx;
  ctx.vRel[1] = vy - ctx.env.wy;
  ctx.speedRel = norm(ctx.vRel);
  ctx.re = (ctx.env.rho * ctx.speedRel * (2 * ctx.params.radius)) / ctx.env.eta;
  ctx.mach = ctx.env.c > 0 ? ctx.speedRel / ctx.env.c : 0;
}

/** Force ids for which `gravityQuadraticDragJacobian` is exact, in registry (sorted-id) order. */
const GRAVITY_QUADRATIC_DRAG_IDS = ["drag-quadratic", "gravity"];

const DRAG_JACOBIAN_SPEED_EPS = 1e-9;

/**
 * Analytic J = ∂f/∂y for gravity + quadratic drag only (eq. 3.18 without the
 * Magnus term). Two simplifying assumptions, both exactly true for every
 * environment currently implemented (ConstantAtmosphere, non-altitude
 * UniformGravity, ZeroWind — none of which vary with position): (1) rho and
 * g are locally uniform, so d/dx = d/dy = 0 throughout; (2) the drag
 * coefficient is treated as state-independent, exact for ConstantCd and an
 * approximation (dropping d(Cd)/d(Re)) for TabulatedReynoldsCd. A future
 * position-dependent environment (P1.27/P1.30/P1.33) would invalidate
 * assumption (1) and must revisit this function.
 *
 * At v_rel = 0 the drag force is only C1 (§3.8): u*u_rel is homogeneous of
 * degree 2, so its gradient is homogeneous of degree 1 and its limit at 0 is
 * 0 from every direction, which is what the epsilon guard below returns.
 */
function gravityQuadraticDragJacobian(
  t: number,
  y: Float64Array,
  out: Float64Array,
  ctx: EvalContext,
): void {
  const x = y[X]!;
  const yPos = y[Y]!;
  const vx = y[VX]!;
  const vy = y[VY]!;

  refreshFlowState(t, x, yPos, vx, vy, ctx);

  out.fill(0);
  out[X * DIM + VX] = 1;
  out[Y * DIM + VY] = 1;

  const u = ctx.speedRel;
  if (u < DRAG_JACOBIAN_SPEED_EPS) return;

  const ux = ctx.vRel[0];
  const uy = ctx.vRel[1];
  const cd = ctx.params.dragCoefficient.cd(ctx.re, ctx.mach);
  const c = (0.5 * ctx.env.rho * cd * ctx.params.area) / ctx.params.mass;
  const cross = -c * ((ux * uy) / u);

  out[VX * DIM + VX] = -c * (u + (ux * ux) / u);
  out[VX * DIM + VY] = cross;
  out[VY * DIM + VX] = cross;
  out[VY * DIM + VY] = -c * (u + (uy * uy) / u);
}

/**
 * E = (1/2)m|v|^2 + mgy, the mechanical energy of §3.8. This is the only
 * potential term folded in — gravity is the sole force whose work is already
 * accounted for by a term in E, which is what makes `planarAeroPower` below
 * exactly equal to dE/dt (eq. 3.19).
 */
export function planarMechanicalEnergy(t: number, y: Float64Array, ctx: EvalContext): number {
  const vx = y[VX]!;
  const vy = y[VY]!;
  ctx.environment.sample(t, y[X]!, y[Y]!, ctx.env);
  return 0.5 * ctx.params.mass * (vx * vx + vy * vy) + ctx.params.mass * ctx.env.g * y[Y]!;
}

/**
 * F_aero . v (eq. 3.19): sum of every registered force's `energyPower`
 * except gravity's. Gravity is excluded because its work is already the mgy
 * term in `planarMechanicalEnergy` — including it here would double-count
 * and yield d(KE)/dt instead of dE/dt. With aero forces off this is exactly
 * 0 (E conserved); with drag on in still air it is <= 0 (E dissipates); with
 * only an ideal Magnus force it is exactly 0 (F_M is always ⊥ v_rel).
 */
export function planarAeroPower(
  forces: readonly ForceModel[],
  t: number,
  y: Float64Array,
  ctx: EvalContext,
): number {
  refreshFlowState(t, y[X]!, y[Y]!, y[VX]!, y[VY]!, ctx);
  let power = 0;
  for (const force of forces) {
    if (force.id === "gravity" || !force.energyPower) continue;
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
  const hasAnalyticJacobian =
    registry.length === GRAVITY_QUADRATIC_DRAG_IDS.length &&
    registry.every((force, i) => force.id === GRAVITY_QUADRATIC_DRAG_IDS[i]);
  const hasGravity = registry.some((force) => force.id === "gravity");

  return {
    dim: 4,
    channels: PLANAR_CHANNELS,
    rhs(t: number, y: Float64Array, out: Float64Array, ctx: EvalContext): void {
      const x = y[X]!;
      const yPos = y[Y]!;
      const vx = y[VX]!;
      const vy = y[VY]!;

      refreshFlowState(t, x, yPos, vx, vy, ctx);

      composeForces(registry, t, y, ctx, ctx.forceAccum);

      out[X] = vx;
      out[Y] = vy;
      out[VX] = ctx.forceAccum[0] / ctx.params.mass;
      out[VY] = ctx.forceAccum[1] / ctx.params.mass;
    },
    ...(hasGravity ? { invariants: [{ name: "energy", evaluate: planarMechanicalEnergy }] } : {}),
    ...(hasAnalyticJacobian ? { jacobian: gravityQuadraticDragJacobian } : {}),
  };
}
