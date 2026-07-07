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
   * Adds this force's contribution to d(F)/dy — row-major 4x4, planar state
   * (x, y, vx, vy) — into the VX/VY rows of `outJ` (rows 2 and 3). Mirrors
   * `accumulate`'s add-only contract; NOT yet divided by mass (the model
   * divides once after composing every force, eq. 3.18). A force that can't
   * express an exact analytic derivative (Magnus: C_L(S) is a fit, not a
   * closed form) simply omits this method; `composeForceJacobians` detects
   * the gap so the caller knows to fall back to finite differences (P1.23).
   */
  jacobian?(t: number, y: Float64Array, ctx: EvalContext, outJ: Float64Array): void;
}

const VX = 2;
const VY = 3;
const STATE_DIM = 4;
const DRAG_JACOBIAN_SPEED_EPS = 1e-9;

/** F_g = -mg*ŷ (§3.2). */
export class GravityForce implements ForceModel {
  readonly id = "gravity";

  accumulate(_t: number, _y: Float64Array, ctx: EvalContext, outForce: MutVec2): void {
    outForce[1] += -ctx.params.mass * ctx.env.g;
  }

  energyPower(_t: number, y: Float64Array, ctx: EvalContext): number {
    return -ctx.params.mass * ctx.env.g * y[VY]!;
  }

  /**
   * Zero contribution: F_g doesn't depend on (x, y, vx, vy). Assumes uniform
   * (non-altitude-dependent) gravity, matching `UniformGravity`'s default
   * (P1.22 scope) — the altitude-dependent mode (P4.02) would need a nonzero
   * d(F_gy)/dy term this doesn't provide.
   */
  jacobian(_t: number, _y: Float64Array, _ctx: EvalContext, _outJ: Float64Array): void {
    // no-op: present only so composeForceJacobians sees every force covered.
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
   * d(F)/d(vx,vy) for F = -k*u*u_rel, k = 0.5*rho*Cd*A held fixed at its
   * value for the current (Re, Mach) — i.e. this omits the dCd/dRe slope
   * term, which is exact for `ConstantCd` and an approximation for any
   * speed-dependent Cd model (P1.22 scope: "gravity+quadratic-drag", the
   * eq. 3.18 k_d treated as constant; P1.23's finite-difference Jacobian is
   * the generic fallback that captures the dCd/dRe term too). d(F)/d(x,y) is
   * exactly zero since rho is position-independent for `ConstantAtmosphere`
   * and wind never depends on velocity.
   *
   * F = -k*u*u, with u = |u_rel|: d(F_i)/d(v_j) = -k*(delta_ij*u + u_i*u_j/u),
   * which vanishes in the limit u->0 (each term is O(u)) since F is C1 (not
   * C2) at v_rel=0 (§3.8) — the eps guard below returns that exact limit
   * rather than evaluating a 0/0.
   */
  jacobian(_t: number, _y: Float64Array, ctx: EvalContext, outJ: Float64Array): void {
    const u = ctx.speedRel;
    if (u < DRAG_JACOBIAN_SPEED_EPS) return;
    const cd = ctx.params.dragCoefficient.cd(ctx.re, ctx.mach);
    const k = 0.5 * ctx.env.rho * cd * ctx.params.area;
    const ux = ctx.vRel[0];
    const uy = ctx.vRel[1];
    const dFxDvx = -k * (u + (ux * ux) / u);
    const dFxDvy = -k * ((ux * uy) / u);
    const dFyDvx = dFxDvy;
    const dFyDvy = -k * (u + (uy * uy) / u);
    outJ[VX * STATE_DIM + VX] = outJ[VX * STATE_DIM + VX]! + dFxDvx;
    outJ[VX * STATE_DIM + VY] = outJ[VX * STATE_DIM + VY]! + dFxDvy;
    outJ[VY * STATE_DIM + VX] = outJ[VY * STATE_DIM + VX]! + dFyDvx;
    outJ[VY * STATE_DIM + VY] = outJ[VY * STATE_DIM + VY]! + dFyDvy;
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

/**
 * Zeroes `outJ` (row-major 4x4) then accumulates every force's `jacobian`
 * contribution, in registry order (P1.22). Returns false if any force in
 * `forces` doesn't implement `jacobian` — e.g. Magnus — meaning `outJ` is
 * incomplete and the caller must not treat it as the true analytic
 * Jacobian (fall back to finite differences instead, P1.23).
 */
export function composeForceJacobians(
  forces: readonly ForceModel[],
  t: number,
  y: Float64Array,
  ctx: EvalContext,
  outJ: Float64Array,
): boolean {
  outJ.fill(0);
  let complete = true;
  for (const force of forces) {
    if (!force.jacobian) {
      complete = false;
      continue;
    }
    force.jacobian(t, y, ctx, outJ);
  }
  return complete;
}

/** True iff every force in `forces` implements `jacobian` (P1.22). */
export function hasAnalyticJacobian(forces: readonly ForceModel[]): boolean {
  return forces.every((f) => typeof f.jacobian === "function");
}
