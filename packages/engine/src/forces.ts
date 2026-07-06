import type { EvalContext } from "./eval-context.js";
import type { MutVec2 } from "./vec2.js";

/**
 * One term of the force composition (3.2). `accumulate` *adds* into
 * `outForce` — it never zeroes or overwrites it — so composeForces can sum
 * an arbitrary set of forces into one preallocated buffer (§2.4a).
 */
export interface ForceModel {
  readonly id: string;
  accumulate(t: number, y: Float64Array, ctx: EvalContext, outForce: MutVec2): void;
  /** Instantaneous power this force delivers, F.v using the true velocity (eq. 3.19). */
  energyPower?(t: number, y: Float64Array, ctx: EvalContext): number;
  /**
   * Analytic ∂F/∂y contribution, *added* into `outJ` — a preallocated 2x4
   * row-major block (row 0 = ∂Fx/∂(x,y,vx,vy), row 1 = ∂Fy/∂(x,y,vx,vy),
   * matching the planar state layout X=0,Y=1,VX=2,VY=3). Optional: forces
   * without a closed-form derivative (e.g. Magnus) simply omit this, and
   * `allForcesHaveJacobian` tells callers to fall back to finite differences
   * (P1.23) rather than silently compose an incomplete Jacobian.
   */
  jacobian?(t: number, y: Float64Array, ctx: EvalContext, outJ: Float64Array): void;
}

const VX = 2;
const VY = 3;

/** F_g = -mg*ŷ (§3.2). */
export class GravityForce implements ForceModel {
  readonly id = "gravity";

  accumulate(_t: number, _y: Float64Array, ctx: EvalContext, outForce: MutVec2): void {
    outForce[1] += -ctx.params.mass * ctx.env.g;
  }

  energyPower(_t: number, y: Float64Array, ctx: EvalContext): number {
    return -ctx.params.mass * ctx.env.g * y[VY]!;
  }

  // F_g is constant in y (uniform gravity) -> zero Jacobian contribution.
  jacobian(_t: number, _y: Float64Array, _ctx: EvalContext, _outJ: Float64Array): void {}
}

/** Stokes drag F = -b*v_rel, b = 6*pi*eta*R, valid for Re << 1 (eq. 3.5). */
export class LinearDragForce implements ForceModel {
  readonly id = "drag-linear";

  accumulate(_t: number, _y: Float64Array, ctx: EvalContext, outForce: MutVec2): void {
    const b = 6 * Math.PI * ctx.env.eta * ctx.params.radius;
    outForce[0] += -b * ctx.vRel[0];
    outForce[1] += -b * ctx.vRel[1];
  }

  energyPower(_t: number, y: Float64Array, ctx: EvalContext): number {
    const b = 6 * Math.PI * ctx.env.eta * ctx.params.radius;
    return -b * (ctx.vRel[0] * y[VX]! + ctx.vRel[1] * y[VY]!);
  }
}

/**
 * Quadratic (Newtonian) drag F = -0.5*rho*Cd*A*|v_rel|*v_rel (eq. 3.8).
 * At v_rel = 0 this evaluates to exactly zero — no division, so no NaN guard
 * is needed beyond ensuring the Cd model itself stays finite at Re=0 (P1.09).
 */
export class QuadraticDragForce implements ForceModel {
  readonly id = "drag-quadratic";

  accumulate(_t: number, _y: Float64Array, ctx: EvalContext, outForce: MutVec2): void {
    const cd = ctx.params.dragCoefficient.cd(ctx.re, ctx.mach);
    const k = 0.5 * ctx.env.rho * cd * ctx.params.area * ctx.speedRel;
    outForce[0] += -k * ctx.vRel[0];
    outForce[1] += -k * ctx.vRel[1];
  }

  energyPower(_t: number, y: Float64Array, ctx: EvalContext): number {
    const cd = ctx.params.dragCoefficient.cd(ctx.re, ctx.mach);
    const k = 0.5 * ctx.env.rho * cd * ctx.params.area * ctx.speedRel;
    return -k * (ctx.vRel[0] * y[VX]! + ctx.vRel[1] * y[VY]!);
  }

  /**
   * Analytic Jacobian of F = -k*u*u_rel (k treated as locally constant in
   * u, exact for `ConstantCd`) w.r.t. (vx, vy):
   *   dFx/dvx = -k*(u^2+ux^2)/u,  dFx/dvy = dFy/dvx = -k*ux*uy/u,
   *   dFy/dvy = -k*(u^2+uy^2)/u
   * Position columns are zero: rho and the wind fields currently wired
   * (ZeroWind/UniformSteadyWind) don't vary with position. As u -> 0 each
   * term -> 0 (ux, uy = O(u)), so below the epsilon guard the contribution
   * is left at zero rather than evaluating the removable 0/0 singularity.
   */
  jacobian(_t: number, _y: Float64Array, ctx: EvalContext, outJ: Float64Array): void {
    const u = ctx.speedRel;
    if (u < QUADRATIC_DRAG_JACOBIAN_SPEED_EPS) return;

    const cd = ctx.params.dragCoefficient.cd(ctx.re, ctx.mach);
    const kOverU = (0.5 * ctx.env.rho * cd * ctx.params.area) / u;
    const ux = ctx.vRel[0];
    const uy = ctx.vRel[1];
    const u2 = u * u;

    outJ[2] = outJ[2]! - kOverU * (u2 + ux * ux); // dFx/dvx
    outJ[3] = outJ[3]! - kOverU * ux * uy; // dFx/dvy
    outJ[6] = outJ[6]! - kOverU * ux * uy; // dFy/dvx
    outJ[7] = outJ[7]! - kOverU * (u2 + uy * uy); // dFy/dvy
  }
}

const QUADRATIC_DRAG_JACOBIAN_SPEED_EPS = 1e-9;
const MAGNUS_SPEED_EPS = 1e-9;

/**
 * Magnus lift force (eq. 3.15, 2D-specialized form). Spin is a constant
 * scalar on `params.spin`; the spin-ratio S = |omega|*R/|v_rel| is clamped
 * to 0 as |v_rel| -> 0 (P1.15) rather than left to divide by zero — the
 * force already vanishes there via the |v_rel| factor, so the clamp only
 * prevents a spurious 0/0 = NaN when both spin and speed are exactly zero.
 */
export class MagnusForce implements ForceModel {
  readonly id = "magnus";

  accumulate(_t: number, _y: Float64Array, ctx: EvalContext, outForce: MutVec2): void {
    const omega = ctx.params.spin;
    const liftModel = ctx.params.liftCoefficient;
    if (!omega || !liftModel) return;

    const spinRatio =
      ctx.speedRel < MAGNUS_SPEED_EPS ? 0 : (Math.abs(omega) * ctx.params.radius) / ctx.speedRel;
    const cl = liftModel.cl(spinRatio);
    const k = 0.5 * ctx.env.rho * cl * ctx.params.area * ctx.speedRel * Math.sign(omega);
    // ê_z x v_rel = (-v_rel_y, v_rel_x)
    outForce[0] += -k * ctx.vRel[1];
    outForce[1] += k * ctx.vRel[0];
  }

  energyPower(_t: number, y: Float64Array, ctx: EvalContext): number {
    const omega = ctx.params.spin;
    const liftModel = ctx.params.liftCoefficient;
    if (!omega || !liftModel) return 0;

    const spinRatio =
      ctx.speedRel < MAGNUS_SPEED_EPS ? 0 : (Math.abs(omega) * ctx.params.radius) / ctx.speedRel;
    const cl = liftModel.cl(spinRatio);
    const k = 0.5 * ctx.env.rho * cl * ctx.params.area * ctx.speedRel * Math.sign(omega);
    const fx = -k * ctx.vRel[1];
    const fy = k * ctx.vRel[0];
    return fx * y[VX]! + fy * y[VY]!;
  }
}

/** F_b = rho*V*g upward (§3.4); typically ~1% of weight, toggled per-scenario. */
export class BuoyancyForce implements ForceModel {
  readonly id = "buoyancy";

  accumulate(_t: number, _y: Float64Array, ctx: EvalContext, outForce: MutVec2): void {
    outForce[1] += ctx.env.rho * ctx.params.volume * ctx.env.g;
  }

  energyPower(_t: number, y: Float64Array, ctx: EvalContext): number {
    return ctx.env.rho * ctx.params.volume * ctx.env.g * y[VY]!;
  }
}

/**
 * Sorts forces by id for deterministic accumulation order, independent of
 * registration order (P1.17). Floating-point addition is order-dependent at
 * the ULP level, so fixing the order is what makes rhs bit-reproducible.
 */
export function createForceRegistry(forces: readonly ForceModel[]): readonly ForceModel[] {
  return [...forces].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** Zeroes `outForce` then accumulates every force in `forces`, in registry order. */
export function composeForces(
  forces: readonly ForceModel[],
  t: number,
  y: Float64Array,
  ctx: EvalContext,
  outForce: MutVec2,
): void {
  outForce[0] = 0;
  outForce[1] = 0;
  for (const force of forces) {
    force.accumulate(t, y, ctx, outForce);
  }
}

/**
 * Sums every wired force's instantaneous power (F.v, eq. 3.19), in registry
 * order; forces without `energyPower` (none currently) contribute 0. This is
 * dKE/dt exactly — combined with d(PE)/dt = m*g*vy it gives the mechanical
 * energy invariant's dE/dt (`createEnergyInvariant`, P1.24).
 */
export function composeEnergyPower(
  forces: readonly ForceModel[],
  t: number,
  y: Float64Array,
  ctx: EvalContext,
): number {
  let power = 0;
  for (const force of forces) {
    power += force.energyPower?.(t, y, ctx) ?? 0;
  }
  return power;
}

/** True iff every force in the set has a closed-form Jacobian (P1.22/P1.23). */
export function allForcesHaveJacobian(forces: readonly ForceModel[]): boolean {
  return forces.every((force) => typeof force.jacobian === "function");
}

/** Zeroes `outJ` then accumulates every force's analytic ∂F/∂y, in registry order. */
export function composeJacobian(
  forces: readonly ForceModel[],
  t: number,
  y: Float64Array,
  ctx: EvalContext,
  outJ: Float64Array,
): void {
  outJ.fill(0);
  for (const force of forces) {
    force.jacobian?.(t, y, ctx, outJ);
  }
}
