import { spinParameter } from "./characteristic-scales.js";
import type { EvalContext } from "./eval-context.js";
import type { MutVec2 } from "./vec2.js";

/**
 * One term of the force composition (3.2). `accumulate` *adds* into
 * `outForce` — it never zeroes or overwrites it — so composeForces can sum
 * an arbitrary set of forces into one preallocated buffer (§2.4a).
 */
export interface ForceModel {
  readonly id: string;
  /** Adds this force's contribution at (t, y) into `outForce` (does not zero it first). */
  accumulate(t: number, y: Float64Array, ctx: EvalContext, outForce: MutVec2): void;
  /** Instantaneous power this force delivers, F.v using the true velocity (eq. 3.19). */
  energyPower?(t: number, y: Float64Array, ctx: EvalContext): number;
}

const VX = 2;
const VY = 3;

/** F_g = -mg*ŷ (§3.2). */
export class GravityForce implements ForceModel {
  readonly id = "gravity";

  /** @inheritDoc */
  accumulate(_t: number, _y: Float64Array, ctx: EvalContext, outForce: MutVec2): void {
    outForce[1] += -ctx.params.mass * ctx.env.g;
  }

  energyPower(_t: number, y: Float64Array, ctx: EvalContext): number {
    return -ctx.params.mass * ctx.env.g * y[VY]!;
  }
}

/** Stokes drag F = -b*v_rel, b = 6*pi*eta*R, valid for Re << 1 (eq. 3.5). */
export class LinearDragForce implements ForceModel {
  readonly id = "drag-linear";

  /** @inheritDoc */
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

  /** @inheritDoc */
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
}

/**
 * Magnus lift force (eq. 3.15, 2D-specialized form). Spin is a constant
 * scalar on `params.spin`; the spin-ratio S = |omega|*R/|v_rel| ({@link
 * spinParameter}) is clamped to 0 as |v_rel| -> 0 (P1.15) rather than left
 * to divide by zero — the force already vanishes there via the |v_rel|
 * factor, so the clamp only prevents a spurious 0/0 = NaN when both spin
 * and speed are exactly zero.
 */
export class MagnusForce implements ForceModel {
  readonly id = "magnus";

  /** @inheritDoc */
  accumulate(_t: number, _y: Float64Array, ctx: EvalContext, outForce: MutVec2): void {
    const omega = ctx.params.spin;
    const liftModel = ctx.params.liftCoefficient;
    if (!omega || !liftModel) return;

    const spinRatio = spinParameter(omega, ctx.params.radius, ctx.speedRel);
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

    const spinRatio = spinParameter(omega, ctx.params.radius, ctx.speedRel);
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

  /** @inheritDoc */
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

/**
 * Sums each force's declared power F_i . v_true (0 for a force with no
 * `energyPower`), in registry order — the per-force half of the energy
 * bookkeeping (3.19). Combined with gravity's own -mg*v_y term this
 * reconstructs dE/dt for the mechanical energy E = (1/2)m|v|^2 + mgy: the
 * two cancel exactly whenever gravity is in `forces`, leaving only the
 * remaining (aero) forces' contribution.
 */
export function totalForcePower(
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
