import type { EvalContext } from "./eval-context.js";
import type { MutMat2, MutVec2 } from "./vec2.js";

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
   * Analytic ∂(Fx,Fy)/∂(vx,vy), *added* into `outJvv` like `accumulate` adds
   * into `outForce` (P1.22). Only implemented where the force's coefficients
   * are constant in state — e.g. gravity under a non-altitude-dependent
   * GravityModel, quadratic drag under a Cd model that doesn't depend on
   * Re/Mach. A force that can't provide this exactly (Magnus, tabulated
   * Cd(Re)) simply omits it; `createPlanarProjectileModel` only attaches an
   * analytic `Model.jacobian` when every registered force implements it,
   * falling back to finite differences otherwise (P1.23).
   */
  jacobianV?(t: number, y: Float64Array, ctx: EvalContext, outJvv: MutMat2): void;
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

  /** F_g doesn't depend on v at all, so ∂F_g/∂v = 0 — nothing to accumulate. */
  jacobianV(_t: number, _y: Float64Array, _ctx: EvalContext, _outJvv: MutMat2): void {
    // no-op: zero contribution
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
const QUADRATIC_DRAG_JACOBIAN_SPEED_EPS = 1e-12;

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
   * F = -k*u*u_vec (u = |vRel|, k = 0.5*rho*Cd*A held constant in state, i.e.
   * this is exact for a Cd model that doesn't depend on Re/Mach). Writing
   * ux, uy for vRel's components:
   *   dFx/dvx = -k*(u + ux^2/u),  dFx/dvy = dFy/dvx = -k*ux*uy/u,  dFy/dvy = -k*(u + uy^2/u)
   * As u -> 0 this whole matrix -> 0 (F = -k*u*u_vec is O(u^2), so it's
   * differentiable at u=0 with zero Jacobian even though it's not C^2 there
   * per §3.8) — guarded explicitly since the formula above is a 0/0 there.
   */
  jacobianV(_t: number, _y: Float64Array, ctx: EvalContext, outJvv: MutMat2): void {
    const u = ctx.speedRel;
    if (u < QUADRATIC_DRAG_JACOBIAN_SPEED_EPS) return;

    const cd = ctx.params.dragCoefficient.cd(ctx.re, ctx.mach);
    const k = 0.5 * ctx.env.rho * cd * ctx.params.area;
    const ux = ctx.vRel[0];
    const uy = ctx.vRel[1];
    const cross = -k * ((ux * uy) / u);

    outJvv[0] += -k * (u + (ux * ux) / u);
    outJvv[1] += cross;
    outJvv[2] += cross;
    outJvv[3] += -k * (u + (uy * uy) / u);
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

/** True only when every force in `forces` implements `jacobianV` (P1.22/P1.23). */
export function hasAnalyticJacobianV(forces: readonly ForceModel[]): boolean {
  return forces.every((force) => typeof force.jacobianV === "function");
}

/**
 * Zeroes `outJvv` then accumulates every force's `jacobianV` in registry
 * order (§2.4a fixed ordering, same as composeForces). Caller must have
 * checked `hasAnalyticJacobianV` first — this doesn't guard for missing
 * `jacobianV` since it's only meant to run once availability is known.
 */
export function composeJacobianV(
  forces: readonly ForceModel[],
  t: number,
  y: Float64Array,
  ctx: EvalContext,
  outJvv: MutMat2,
): void {
  outJvv[0] = 0;
  outJvv[1] = 0;
  outJvv[2] = 0;
  outJvv[3] = 0;
  for (const force of forces) {
    force.jacobianV!(t, y, ctx, outJvv);
  }
}
