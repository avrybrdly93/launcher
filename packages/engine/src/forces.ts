import type { EvalContext } from "./eval-context.js";
import type { MutVec2 } from "./vec2.js";

/**
 * Row-major 2x4 block ∂F/∂y for one force's contribution to the accumulator
 * (P1.22): indices 0-3 are ∂Fx/∂(x,y,vx,vy), indices 4-7 are ∂Fy/∂(x,y,vx,vy).
 */
export type MutForceJacobian = [number, number, number, number, number, number, number, number];

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
   * Analytic ∂F/∂y, *adding* into `outJ` (same accumulate-not-overwrite contract
   * as `accumulate`). Optional: a force that omits it makes any model
   * composed from it fall back to a finite-difference Jacobian (P1.23) rather
   * than silently omitting its contribution.
   */
  jacobian?(t: number, y: Float64Array, ctx: EvalContext, outJ: MutForceJacobian): void;
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

  /** F_g is position/velocity-independent under uniform gravity (§3.2 default): ∂F/∂y = 0. */
  jacobian(_t: number, _y: Float64Array, _ctx: EvalContext, _outJ: MutForceJacobian): void {
    // no-op: contributes nothing to accumulate
  }
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
   * Analytic ∂F/∂y for F = -k*|u|*u, u = v_rel (P1.22). Treats k = 0.5*rho*Cd*A
   * as locally frozen w.r.t. y — exact for a position/speed-independent Cd
   * model (ConstantCd, the P1.08 default) with wind that doesn't vary with
   * position (ZeroWind/uniform wind, so ∂u/∂r = 0); a Cd(Re,Mach) or
   * position-dependent wind model reintroduces terms this omits, which is why
   * P1.23's finite-difference Jacobian exists as the general-case fallback.
   * Singular at u = 0 (the same C1-not-C2 kink noted in §3.8); left as 0
   * there, matching how the force itself vanishes smoothly.
   */
  jacobian(_t: number, _y: Float64Array, ctx: EvalContext, outJ: MutForceJacobian): void {
    const s = ctx.speedRel;
    if (s < 1e-9) return;
    const cd = ctx.params.dragCoefficient.cd(ctx.re, ctx.mach);
    const k = 0.5 * ctx.env.rho * cd * ctx.params.area;
    const ux = ctx.vRel[0];
    const uy = ctx.vRel[1];
    // d/dvx, d/dvy of Fx = -k*s*ux and Fy = -k*s*uy; d/dx, d/dy are 0.
    outJ[2] += -k * (s + (ux * ux) / s);
    outJ[3] += -k * ((ux * uy) / s);
    outJ[6] += -k * ((uy * ux) / s);
    outJ[7] += -k * (s + (uy * uy) / s);
  }
}

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

/** True only when every force in `forces` declares an analytic jacobian (P1.22). */
export function forcesSupportJacobian(forces: readonly ForceModel[]): boolean {
  return forces.every((force) => typeof force.jacobian === "function");
}

/** Zeroes `outJ` then accumulates every force's jacobian, in registry order. */
export function composeForceJacobian(
  forces: readonly ForceModel[],
  t: number,
  y: Float64Array,
  ctx: EvalContext,
  outJ: MutForceJacobian,
): void {
  for (let i = 0; i < 8; i++) outJ[i] = 0;
  for (const force of forces) {
    force.jacobian!(t, y, ctx, outJ);
  }
}
