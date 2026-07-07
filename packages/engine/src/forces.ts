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
   * Adds this force's contribution to d(F)/d(v) into `outJv`, a row-major 2x2
   * block [dFx/dvx, dFx/dvy, dFy/dvx, dFy/dvy] (P1.22). Environment scalars
   * (rho, Cd, ...) are treated as frozen at the current state, matching the
   * eigenvalue analysis of blueprint §4.4 — not a full chain rule through
   * Cd(Re) or position-dependent fields. Forces without a tractable analytic
   * linearization (Magnus, whose clamp introduces a kink) omit this method;
   * `forcesSupportJacobian` lets a Model detect that and fall back to FD.
   */
  jacobian?(t: number, y: Float64Array, ctx: EvalContext, outJv: Float64Array): void;
}

const VX = 2;
const VY = 3;

/** Below this relative speed, velocity-dependent-force Jacobian blocks are treated as zero (P1.22/P1.15). */
const JACOBIAN_SPEED_EPS = 1e-9;

/** F_g = -mg*ŷ (§3.2). */
export class GravityForce implements ForceModel {
  readonly id = "gravity";

  accumulate(_t: number, _y: Float64Array, ctx: EvalContext, outForce: MutVec2): void {
    outForce[1] += -ctx.params.mass * ctx.env.g;
  }

  energyPower(_t: number, y: Float64Array, ctx: EvalContext): number {
    return -ctx.params.mass * ctx.env.g * y[VY]!;
  }

  /** Constant in v: contributes nothing to d(F)/d(v). */
  jacobian(_t: number, _y: Float64Array, _ctx: EvalContext, _outJv: Float64Array): void {}
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

  /** F = -b*v_rel is linear in v: d(F)/d(v) = -b*I. */
  jacobian(_t: number, _y: Float64Array, ctx: EvalContext, outJv: Float64Array): void {
    const b = 6 * Math.PI * ctx.env.eta * ctx.params.radius;
    outJv[0]! += -b;
    outJv[3]! += -b;
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
   * F = -k*u*u_vec, k = 0.5*rho*Cd*A frozen at the current state (Cd(Re) is
   * not differentiated — see the ForceModel.jacobian doc). With u = |u_vec|:
   *   dFx/dvx = -k*(u^2+ux^2)/u,  dFx/dvy = dFy/dvx = -k*ux*uy/u,  dFy/dvy = -k*(u^2+uy^2)/u
   * Each term's limit as u -> 0 is 0 (F is C^1 there, blueprint §4.4), so the
   * guard returns the analytic limit instead of evaluating a 0/0 division.
   */
  jacobian(_t: number, _y: Float64Array, ctx: EvalContext, outJv: Float64Array): void {
    const u = ctx.speedRel;
    if (u < JACOBIAN_SPEED_EPS) return;

    const cd = ctx.params.dragCoefficient.cd(ctx.re, ctx.mach);
    const k = 0.5 * ctx.env.rho * cd * ctx.params.area;
    const ux = ctx.vRel[0];
    const uy = ctx.vRel[1];
    outJv[0]! += (-k * (u * u + ux * ux)) / u;
    outJv[1]! += (-k * (ux * uy)) / u;
    outJv[2]! += (-k * (ux * uy)) / u;
    outJv[3]! += (-k * (u * u + uy * uy)) / u;
  }
}

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
      ctx.speedRel < JACOBIAN_SPEED_EPS ? 0 : (Math.abs(omega) * ctx.params.radius) / ctx.speedRel;
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
      ctx.speedRel < JACOBIAN_SPEED_EPS ? 0 : (Math.abs(omega) * ctx.params.radius) / ctx.speedRel;
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

  /** Constant in v: contributes nothing to d(F)/d(v). */
  jacobian(_t: number, _y: Float64Array, _ctx: EvalContext, _outJv: Float64Array): void {}
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

/** True iff every force in `forces` implements an analytic `jacobian` (P1.22). */
export function forcesSupportJacobian(forces: readonly ForceModel[]): boolean {
  return forces.every((force) => typeof force.jacobian === "function");
}

/**
 * Zeroes `outJv` then accumulates every force's d(F)/d(v) block into it, in
 * registry order (mirrors composeForces). Only call when
 * `forcesSupportJacobian(forces)` is true.
 */
export function composeVelocityJacobian(
  forces: readonly ForceModel[],
  t: number,
  y: Float64Array,
  ctx: EvalContext,
  outJv: Float64Array,
): void {
  outJv[0] = 0;
  outJv[1] = 0;
  outJv[2] = 0;
  outJv[3] = 0;
  for (const force of forces) {
    force.jacobian!(t, y, ctx, outJv);
  }
}
